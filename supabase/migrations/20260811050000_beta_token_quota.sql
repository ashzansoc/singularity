-- Beta token quota: 10M per email + 10M per device

create extension if not exists pgcrypto;

create table if not exists public.beta_users (
  email text primary key,
  user_id uuid references auth.users (id) on delete set null,
  tokens_used bigint not null default 0 check (tokens_used >= 0),
  token_limit bigint not null default 10000000 check (token_limit > 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.beta_devices (
  device_id text primary key,
  email text not null references public.beta_users (email) on delete cascade,
  tokens_used bigint not null default 0 check (tokens_used >= 0),
  token_limit bigint not null default 10000000 check (token_limit > 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists beta_devices_email_idx on public.beta_devices (email);

create table if not exists public.beta_usage_events (
  id bigserial primary key,
  email text not null,
  device_id text not null,
  prompt_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  total_charged bigint not null default 0,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists beta_usage_events_email_idx on public.beta_usage_events (email);
create index if not exists beta_usage_events_device_idx on public.beta_usage_events (device_id);

alter table public.beta_users enable row level security;
alter table public.beta_devices enable row level security;
alter table public.beta_usage_events enable row level security;

-- Clients cannot read/write quota tables directly (service role / edge function only).
-- Authenticated users may read their own remaining quota via a SECURITY DEFINER view/function.

create or replace function public.ensure_beta_identity(
  p_email text,
  p_user_id uuid,
  p_device_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' or p_device_id is null or p_device_id = '' then
    raise exception 'email and device_id required';
  end if;

  insert into public.beta_users (email, user_id)
  values (v_email, p_user_id)
  on conflict (email) do update
    set user_id = coalesce(excluded.user_id, public.beta_users.user_id),
        last_seen_at = now();

  insert into public.beta_devices (device_id, email)
  values (p_device_id, v_email)
  on conflict (device_id) do update
    set email = excluded.email,
        last_seen_at = now();
end;
$$;

create or replace function public.get_beta_quota(
  p_email text,
  p_device_id text
) returns table (
  email text,
  device_id text,
  email_used bigint,
  email_limit bigint,
  email_remaining bigint,
  device_used bigint,
  device_limit bigint,
  device_remaining bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  u public.beta_users%rowtype;
  d public.beta_devices%rowtype;
begin
  select * into u from public.beta_users where beta_users.email = v_email;
  select * into d from public.beta_devices where beta_devices.device_id = p_device_id;

  if not found or u.email is null then
    raise exception 'unknown beta user';
  end if;

  return query select
    v_email,
    p_device_id,
    coalesce(u.tokens_used, 0),
    coalesce(u.token_limit, 10000000),
    greatest(coalesce(u.token_limit, 10000000) - coalesce(u.tokens_used, 0), 0),
    coalesce(d.tokens_used, 0),
    coalesce(d.token_limit, 10000000),
    greatest(coalesce(d.token_limit, 10000000) - coalesce(d.tokens_used, 0), 0);
end;
$$;

create or replace function public.charge_beta_tokens(
  p_email text,
  p_device_id text,
  p_prompt_tokens bigint,
  p_completion_tokens bigint,
  p_cached_tokens bigint,
  p_model text default null
) returns table (
  email_used bigint,
  email_remaining bigint,
  device_used bigint,
  device_remaining bigint,
  total_charged bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_prompt bigint := greatest(coalesce(p_prompt_tokens, 0), 0);
  v_completion bigint := greatest(coalesce(p_completion_tokens, 0), 0);
  v_cached bigint := greatest(coalesce(p_cached_tokens, 0), 0);
  -- Combined charge: input + output. Cache tokens are a subset of prompt and
  -- are logged via p_cached_tokens but not double-counted.
  v_charge bigint := v_prompt + v_completion;
  u public.beta_users%rowtype;
  d public.beta_devices%rowtype;
begin
  if v_email is null or v_email = '' or p_device_id is null or p_device_id = '' then
    raise exception 'email and device_id required';
  end if;

  if v_charge <= 0 then
    select * into u from public.beta_users where beta_users.email = v_email for update;
    select * into d from public.beta_devices where beta_devices.device_id = p_device_id for update;
    return query select
      u.tokens_used,
      greatest(u.token_limit - u.tokens_used, 0),
      d.tokens_used,
      greatest(d.token_limit - d.tokens_used, 0),
      0::bigint;
    return;
  end if;

  select * into u from public.beta_users where beta_users.email = v_email for update;
  if not found then
    raise exception 'unknown beta user';
  end if;

  select * into d from public.beta_devices where beta_devices.device_id = p_device_id for update;
  if not found then
    raise exception 'unknown beta device';
  end if;

  if u.tokens_used + v_charge > u.token_limit then
    raise exception 'quota_exceeded_email';
  end if;
  if d.tokens_used + v_charge > d.token_limit then
    raise exception 'quota_exceeded_device';
  end if;

  update public.beta_users
    set tokens_used = tokens_used + v_charge,
        last_seen_at = now()
    where email = v_email
    returning * into u;

  update public.beta_devices
    set tokens_used = tokens_used + v_charge,
        last_seen_at = now()
    where device_id = p_device_id
    returning * into d;

  insert into public.beta_usage_events (
    email, device_id, prompt_tokens, completion_tokens, cached_tokens, total_charged, model
  ) values (
    v_email, p_device_id, v_prompt, v_completion, v_cached, v_charge, p_model
  );

  return query select
    u.tokens_used,
    greatest(u.token_limit - u.tokens_used, 0),
    d.tokens_used,
    greatest(d.token_limit - d.tokens_used, 0),
    v_charge;
end;
$$;

revoke all on table public.beta_users from anon, authenticated;
revoke all on table public.beta_devices from anon, authenticated;
revoke all on table public.beta_usage_events from anon, authenticated;

grant execute on function public.ensure_beta_identity(text, uuid, text) to service_role;
grant execute on function public.get_beta_quota(text, text) to service_role;
grant execute on function public.charge_beta_tokens(text, text, bigint, bigint, bigint, text) to service_role;
