-- Restrict Singularity beta access to corporate email domain (@zansoc.com).

create or replace function public.assert_allowed_singularity_email(p_email text)
returns void
language plpgsql
immutable
as $$
declare
  v_email text := lower(trim(p_email));
  v_domain text := lower(coalesce(current_setting('app.singularity_allowed_email_domain', true), 'zansoc.com'));
begin
  if v_email is null or v_email = '' then
    raise exception 'email required';
  end if;
  if not (v_email like '%@' || v_domain) or length(v_email) <= length(v_domain) + 1 then
    raise exception 'email domain not allowed: %', v_domain;
  end if;
end;
$$;

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
  perform public.assert_allowed_singularity_email(v_email);

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
  perform public.assert_allowed_singularity_email(v_email);

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
