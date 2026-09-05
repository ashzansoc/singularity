-- Extend admin dashboard with user_profiles + OpenRouter key names (not plaintext keys).

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
      'profiles', (select count(*)::int from public.user_profiles),
      'openrouter_keys', (select count(*)::int from public.user_openrouter_keys where disabled = false),
      'devices', (select count(*)::int from public.beta_devices),
      'requests', (select count(*)::int from public.beta_usage_events),
      'tokens', (select coalesce(sum(total_charged), 0)::bigint from public.beta_usage_events),
      'prompt_tokens', (select coalesce(sum(prompt_tokens), 0)::bigint from public.beta_usage_events),
      'completion_tokens', (select coalesce(sum(completion_tokens), 0)::bigint from public.beta_usage_events),
      'leads', (select count(*)::int from public.site_leads)
    ),
    'last_24h', jsonb_build_object(
      'users', (select count(*)::int from public.beta_users where last_seen_at > now() - interval '24 hours'),
      'profiles', (select count(*)::int from public.user_profiles where last_login_at > now() - interval '24 hours'),
      'requests', (select count(*)::int from public.beta_usage_events where created_at > now() - interval '24 hours'),
      'tokens', (select coalesce(sum(total_charged), 0)::bigint from public.beta_usage_events where created_at > now() - interval '24 hours')
    ),
    'last_7d', jsonb_build_object(
      'users', (select count(*)::int from public.beta_users where last_seen_at > now() - interval '7 days'),
      'profiles', (select count(*)::int from public.user_profiles where last_login_at > now() - interval '7 days'),
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
    'recent_profiles', coalesce((
      select jsonb_agg(row_to_json(p) order by p.last_login_at desc)
      from (
        select
          up.email,
          up.github_username,
          up.subscription_plan,
          up.subscription_status,
          up.subscription_started_at,
          up.last_login_at,
          uok.key_name as openrouter_key_name
        from public.user_profiles up
        left join public.user_openrouter_keys uok on uok.user_id = up.user_id
        order by up.last_login_at desc
        limit 50
      ) p
    ), '[]'::jsonb),
    'top_users', coalesce((
      select jsonb_agg(row_to_json(t) order by t.tokens desc)
      from (
        select
          email,
          count(*)::int as requests,
          coalesce(sum(total_charged), 0)::bigint as tokens
        from public.beta_usage_events
        where created_at > now() - interval '30 days'
        group by 1
        order by 3 desc
        limit 20
      ) t
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

grant execute on function public.get_admin_dashboard() to authenticated;
