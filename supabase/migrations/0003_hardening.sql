-- Hardening: keep calibration data server-only and prune spent replay claims.
-- Safe to run more than once.

-- Views run with their owner's privileges by default, which would bypass the
-- row-level security on question_attempts. Make the view respect the caller's
-- permissions and take it away from the public roles entirely.
alter view public.item_calibration set (security_invoker = true);
revoke all on public.item_calibration from anon, authenticated;

-- Replay claims only matter while a session token is valid (2 hours).
create index if not exists token_claims_created_idx on public.token_claims (created_at);

create or replace function public.prune_token_claims()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.token_claims
    where created_at < now() - interval '6 hours'
    returning 1
  )
  select count(*)::int from deleted;
$$;

revoke all on function public.prune_token_claims() from public, anon, authenticated;

-- Schedule it hourly when pg_cron is enabled (Database -> Extensions -> pg_cron).
-- Without pg_cron this block does nothing; run `select public.prune_token_claims();`
-- occasionally instead.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'pokeiq-prune-claims';
    perform cron.schedule('pokeiq-prune-claims', '17 * * * *', 'select public.prune_token_claims()');
  end if;
end
$$;
