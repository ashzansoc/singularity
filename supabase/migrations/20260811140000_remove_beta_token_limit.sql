-- Remove the 10M beta token hard limit. Usage is still tracked; requests are not blocked.

-- Effectively unlimited for bigint accounting (~9e15).
alter table public.beta_users
  alter column token_limit set default 9007199254740991;

alter table public.beta_devices
  alter column token_limit set default 9007199254740991;

update public.beta_users
  set token_limit = 9007199254740991
  where token_limit <= 10000000;

update public.beta_devices
  set token_limit = 9007199254740991
  where token_limit <= 10000000;

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
  v_limit bigint := 9007199254740991;
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
    coalesce(nullif(u.token_limit, 0), v_limit),
    greatest(coalesce(nullif(u.token_limit, 0), v_limit) - coalesce(u.tokens_used, 0), 0),
    coalesce(d.tokens_used, 0),
    coalesce(nullif(d.token_limit, 0), v_limit),
    greatest(coalesce(nullif(d.token_limit, 0), v_limit) - coalesce(d.tokens_used, 0), 0);
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
  v_charge bigint := v_prompt + v_completion;
  v_limit bigint := 9007199254740991;
  u public.beta_users%rowtype;
  d public.beta_devices%rowtype;
begin
  if v_email is null or v_email = '' or p_device_id is null or p_device_id = '' then
    raise exception 'email and device_id required';
  end if;

  select * into u from public.beta_users where beta_users.email = v_email for update;
  if not found then
    raise exception 'unknown beta user';
  end if;

  select * into d from public.beta_devices where beta_devices.device_id = p_device_id for update;
  if not found then
    raise exception 'unknown beta device';
  end if;

  -- Soft caps only: never raise quota_exceeded. Always allow the charge.
  if v_charge > 0 then
    update public.beta_users
      set tokens_used = tokens_used + v_charge,
          token_limit = greatest(token_limit, v_limit),
          last_seen_at = now()
      where email = v_email
      returning * into u;

    update public.beta_devices
      set tokens_used = tokens_used + v_charge,
          token_limit = greatest(token_limit, v_limit),
          last_seen_at = now()
      where device_id = p_device_id
      returning * into d;

    insert into public.beta_usage_events (
      email, device_id, prompt_tokens, completion_tokens, cached_tokens, total_charged, model
    ) values (
      v_email, p_device_id, v_prompt, v_completion, v_cached, v_charge, p_model
    );
  end if;

  return query select
    u.tokens_used,
    greatest(coalesce(nullif(u.token_limit, 0), v_limit) - u.tokens_used, 0),
    d.tokens_used,
    greatest(coalesce(nullif(d.token_limit, 0), v_limit) - d.tokens_used, 0),
    v_charge;
end;
$$;
