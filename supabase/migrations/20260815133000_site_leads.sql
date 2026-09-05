-- Marketing site waitlist / work-mode interest. Anon may insert via RPC only.

create table if not exists public.site_leads (
  email text primary key,
  work_mode text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.site_leads enable row level security;

create or replace function public.submit_site_lead(
  p_email text,
  p_work_mode text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_mode text := nullif(trim(coalesce(p_work_mode, '')), '');
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  insert into public.site_leads (email, work_mode)
  values (v_email, v_mode)
  on conflict (email) do update
    set work_mode = coalesce(excluded.work_mode, public.site_leads.work_mode),
        last_seen_at = now();
end;
$$;

revoke all on table public.site_leads from anon, authenticated;
grant execute on function public.submit_site_lead(text, text) to anon, authenticated;
