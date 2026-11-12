-- Launch lockdown: the public roles (anon, authenticated) get nothing in the
-- public schema. Every read and write goes through the Next.js API with the
-- service role key; no page or script queries Postgres with the anon key
-- (it is only used, when set, to subscribe to signed Realtime broadcast
-- channels, which touch no table). Additive and safe to run more than once.
--
-- 1. RLS on for every table in public, including any made outside these
--    migrations (the service role bypasses RLS, so the site is unaffected).
-- 2. Drop the three read-everything policies (runs, geo_runs, profile_about)
--    and take every table, view and sequence away from anon/authenticated.
--    runs and geo_runs carried each run's internal session id; nothing on
--    the site reads them through PostgREST, and an open table invites
--    unbounded scrapes and expensive filters against the database.
-- 3. Functions: no EXECUTE for PUBLIC/anon/authenticated on any function of
--    ours (two in 0041 were never revoked); the service role keeps it.
-- 4. Default privileges: tables, sequences and functions created from now on
--    start out without grants to the public roles, so a future migration
--    that forgets its revoke doesn't open a table.
-- 5. prune_token_claims keeps the per-day/per-week claims (board slots and
--    confirmation-email slots) for 8 days instead of 6 hours, so an
--    address's daily allowance really lasts the day.

-- 1. RLS everywhere ----------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end
$$;

-- 2. No direct table access for the public roles -----------------------------
drop policy if exists "anyone can read runs" on public.runs;
drop policy if exists "anyone can read geo runs" on public.geo_runs;
drop policy if exists "profile_about is public" on public.profile_about;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 3. Functions: service role only --------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      -- Leave functions that belong to an extension installed in public alone.
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end
$$;

-- 4. Future objects start closed ---------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- 5. Claims that span a day or a week outlive the 6-hour prune ----------------
create or replace function public.prune_token_claims()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.token_claims
    where created_at < now() - interval '6 hours'
      and (
        (key not like 'board:%' and key not like 'email-confirm:%')
        or created_at < now() - interval '8 days'
      )
    returning 1
  )
  select count(*)::int from deleted;
$$;

revoke all on function public.prune_token_claims() from public, anon, authenticated;
grant execute on function public.prune_token_claims() to service_role;
