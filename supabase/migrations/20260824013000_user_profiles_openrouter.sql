-- User profiles, subscriptions, and per-user OpenRouter API keys.
-- Keys are encrypted at rest (pgcrypto). Only service_role / edge functions may read them.

create extension if not exists pgcrypto;

-- Full user record synced on every login / register.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  github_username text,
  github_id text,
  display_name text,
  avatar_url text,
  auth_provider text not null default 'email',
  subscription_plan text not null default 'monthly_unlimited'
    check (subscription_plan in ('monthly_unlimited', 'trial', 'free', 'cancelled')),
  subscription_status text not null default 'active'
    check (subscription_status in ('active', 'past_due', 'cancelled', 'paused')),
  subscription_started_at timestamptz not null default now(),
  subscription_renews_at timestamptz,
  subscription_cancelled_at timestamptz,
  billing_notes text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_profiles_email_idx on public.user_profiles (lower(email));
create index if not exists user_profiles_github_username_idx on public.user_profiles (github_username)
  where github_username is not null;

-- One active OpenRouter key per user. Plaintext key is write-only at creation time.
create table if not exists public.user_openrouter_keys (
  user_id uuid primary key references public.user_profiles (user_id) on delete cascade,
  key_name text not null,
  key_hash text,
  key_ciphertext bytea not null,
  openrouter_limit_usd numeric,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_used_at timestamptz
);

create index if not exists user_openrouter_keys_key_name_idx on public.user_openrouter_keys (key_name);

alter table public.user_profiles enable row level security;
alter table public.user_openrouter_keys enable row level security;

-- Users may read their own profile (no API keys).
create policy user_profiles_select_own on public.user_profiles
  for select to authenticated
  using (auth.uid() = user_id);

-- Sync profile from auth.users metadata on login/register.
create or replace function public.upsert_user_profile(
  p_user_id uuid,
  p_email text,
  p_github_username text default null,
  p_github_id text default null,
  p_display_name text default null,
  p_avatar_url text default null,
  p_auth_provider text default 'email'
) returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_row public.user_profiles;
begin
  if p_user_id is null or v_email is null or v_email = '' then
    raise exception 'user_id and email required';
  end if;

  insert into public.user_profiles (
    user_id,
    email,
    github_username,
    github_id,
    display_name,
    avatar_url,
    auth_provider,
    subscription_started_at,
    last_login_at,
    updated_at
  ) values (
    p_user_id,
    v_email,
    nullif(trim(p_github_username), ''),
    nullif(trim(p_github_id), ''),
    nullif(trim(p_display_name), ''),
    nullif(trim(p_avatar_url), ''),
    coalesce(nullif(trim(p_auth_provider), ''), 'email'),
    now(),
    now(),
    now()
  )
  on conflict (user_id) do update set
    email = excluded.email,
    github_username = coalesce(excluded.github_username, public.user_profiles.github_username),
    github_id = coalesce(excluded.github_id, public.user_profiles.github_id),
    display_name = coalesce(excluded.display_name, public.user_profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.user_profiles.avatar_url),
    auth_provider = coalesce(excluded.auth_provider, public.user_profiles.auth_provider),
    last_login_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Store encrypted OpenRouter key (service_role / edge function only).
create or replace function public.store_user_openrouter_key(
  p_user_id uuid,
  p_key_name text,
  p_key_hash text,
  p_key_plaintext text,
  p_encryption_secret text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_key_plaintext is null or p_key_plaintext = '' then
    raise exception 'user_id and key required';
  end if;
  if p_encryption_secret is null or p_encryption_secret = '' then
    raise exception 'encryption secret required';
  end if;

  insert into public.user_openrouter_keys (
    user_id,
    key_name,
    key_hash,
    key_ciphertext,
    openrouter_limit_usd,
    disabled,
    created_at,
    rotated_at
  ) values (
    p_user_id,
    coalesce(nullif(trim(p_key_name), ''), 'singularity-user'),
    nullif(trim(p_key_hash), ''),
    extensions.pgp_sym_encrypt(p_key_plaintext, p_encryption_secret),
    null,
    false,
    now(),
    now()
  )
  on conflict (user_id) do update set
    key_name = excluded.key_name,
    key_hash = coalesce(excluded.key_hash, public.user_openrouter_keys.key_hash),
    key_ciphertext = excluded.key_ciphertext,
    disabled = false,
    rotated_at = now();
end;
$$;

-- Decrypt key for edge function upstream routing (service_role only).
create or replace function public.get_user_openrouter_key_plaintext(
  p_user_id uuid,
  p_encryption_secret text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cipher bytea;
  v_disabled boolean;
  v_status text;
begin
  select subscription_status into v_status
  from public.user_profiles
  where user_id = p_user_id;

  if v_status is distinct from 'active' then
    return null;
  end if;

  select key_ciphertext, disabled into v_cipher, v_disabled
  from public.user_openrouter_keys
  where user_id = p_user_id;

  if v_cipher is null or v_disabled then
    return null;
  end if;

  return extensions.pgp_sym_decrypt(v_cipher, p_encryption_secret);
exception
  when others then
    return null;
end;
$$;

-- Subscription gate for the proxy (active monthly plan = unlimited usage in-app).
create or replace function public.user_has_active_subscription(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = p_user_id
      and subscription_status = 'active'
      and subscription_plan in ('monthly_unlimited', 'trial')
  );
$$;

revoke all on table public.user_profiles from anon;
revoke all on table public.user_openrouter_keys from anon, authenticated;

grant select on table public.user_profiles to authenticated;
grant execute on function public.upsert_user_profile(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.store_user_openrouter_key(uuid, text, text, text, text) to service_role;
grant execute on function public.get_user_openrouter_key_plaintext(uuid, text) to service_role;
grant execute on function public.user_has_active_subscription(uuid) to service_role;
