-- Admin-only product metrics for the Firebase dashboard.

create table if not exists public.site_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.site_admins enable row level security;

create or replace function public.claim_site_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if v_email = '' then
    raise exception 'not_authenticated';
  end if;

  if exists (select 1 from public.site_admins) then
    return exists (select 1 from public.site_admins where email = v_email);
  end if;

  insert into public.site_admins (email) values (v_email);
  return true;
end;
$$;

create or replace function public.get_admin_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_out jsonb;
begin
  if v_email = '' or not exists (select 1 from public.site_admins where email = v_email) then
    raise exception 'not_admin';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'admin', v_email,
    'totals', jsonb_build_object(
      'users', (select count(*)::int from public.beta_users),
      'devices', (select count(*)::int from public.beta_devices),
      'requests', (select count(*)::int from public.beta_usage_events),
      'tokens', (select coalesce(sum(total_charged), 0)::bigint from public.beta_usage_events),
      'prompt_tokens', (select coalesce(sum(prompt_tokens), 0)::bigint from public.beta_usage_events),
      'completion_tokens', (select coalesce(sum(completion_tokens), 0)::bigint from public.beta_usage_events),
      'leads', (select count(*)::int from public.site_leads)
    ),
    'last_24h', jsonb_build_object(
      'users', (select count(*)::int from public.beta_users where last_seen_at > now() - interval '24 hours'),
      'requests', (select count(*)::int from public.beta_usage_events where created_at > now() - interval '24 hours'),
      'tokens', (select coalesce(sum(total_charged), 0)::bigint from public.beta_usage_events where created_at > now() - interval '24 hours')
    ),
    'last_7d', jsonb_build_object(
      'users', (select count(*)::int from public.beta_users where last_seen_at > now() - interval '7 days'),
      'requests', (select count(*)::int from public.beta_usage_events where created_at > now() - interval '7 days'),
      'tokens', (select coalesce(sum(total_charged), 0)::bigint from public.beta_usage_events where created_at > now() - interval '7 days')
    ),
    'daily', coalesce((
      select jsonb_agg(row_to_json(d) order by d.day)
      from (
        select
          to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
          count(*)::int as requests,
          coalesce(sum(total_charged), 0)::bigint as tokens,
          count(distinct email)::int as users
        from public.beta_usage_events
        where created_at > now() - interval '30 days'
        group by 1
      ) d
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(row_to_json(m) order by m.tokens desc)
      from (
        select
          coalesce(nullif(model, ''), '(unknown)') as model,
          count(*)::int as requests,
          coalesce(sum(total_charged), 0)::bigint as tokens
        from public.beta_usage_events
        group by 1
        order by 3 desc
        limit 20
      ) m
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(row_to_json(u) order by u.last_seen_at desc)
      from (
        select
          b.email,
          b.tokens_used::bigint as tokens,
          b.created_at,
          b.last_seen_at,
          (select count(*)::int from public.beta_devices d where d.email = b.email) as devices,
          (select count(*)::int from public.beta_usage_events e where e.email = b.email) as requests
        from public.beta_users b
        order by b.last_seen_at desc
        limit 200
      ) u
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(row_to_json(r) order by r.created_at desc)
      from (
        select email, device_id, model, total_charged, prompt_tokens, completion_tokens, created_at
        from public.beta_usage_events
        order by created_at desc
        limit 40
      ) r
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on table public.site_admins from anon, authenticated;
grant execute on function public.claim_site_admin() to authenticated;
grant execute on function public.get_admin_dashboard() to authenticated;
