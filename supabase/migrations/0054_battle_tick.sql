-- The battle tick: live battles keep time even when nobody polls.
--
-- Every write of a battle row sets `next_deadline`: when that live battle
-- next has something due with nobody polling (a clock running out, a
-- trainer gone, the computer owing a choice), or null when nothing can come
-- due. The tick (POST /api/battle/tick) reads the battles whose moment has
-- passed through the partial index below and catches each one up through
-- the normal compare-and-swap path.
--
-- The site's host runs no per-minute cron on its plan, so the database calls
-- the tick once a minute (pg_cron + pg_net). The URL and the shared secret
-- are read at call time from database settings, never written here:
--
--   Vault (preferred):
--     select vault.create_secret('https://<site>/api/battle/tick', 'battle_tick_url');
--     select vault.create_secret('<same value as BATTLE_TICK_SECRET>', 'battle_tick_secret');
--   or custom settings:
--     alter database postgres set app.battle_tick_url = 'https://<site>/api/battle/tick';
--     alter database postgres set app.battle_tick_secret = '<same value as BATTLE_TICK_SECRET>';
--
-- Until both are set (or without pg_cron / pg_net) the scheduled call does
-- nothing, and polls catch battles up as before. Additive, safe to run more
-- than once.

alter table public.battles add column if not exists next_deadline timestamptz;

create index if not exists battles_next_deadline_idx
  on public.battles (next_deadline)
  where next_deadline is not null;

-- The scheduler's extensions, where the database allows them. A database
-- without them keeps the column and the index, and the tick stays unscheduled.
do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net is not available (%): the battle tick stays unscheduled.', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron is not available (%): the battle tick stays unscheduled.', sqlerrm;
  end;
end
$$;

-- One tick setting by name: the Vault secret of that name, else the custom
-- setting app.<name>, else null.
create or replace function public.battle_tick_setting(setting_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 order by created_at desc limit 1'
      into found using setting_name;
  end if;
  if found is null or found = '' then
    found := nullif(current_setting('app.' || setting_name, true), '');
  end if;
  return found;
end
$$;

revoke all on function public.battle_tick_setting(text) from public, anon, authenticated;

-- One scheduled call: POST the tick with the secret header, or nothing when
-- pg_net or either setting is missing. Returns pg_net's request id, or null.
-- The route sweeps for about 50 s, so the request may take up to a minute.
create or replace function public.battle_tick_fire()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  tick_url text := public.battle_tick_setting('battle_tick_url');
  tick_secret text := public.battle_tick_setting('battle_tick_secret');
  request_id bigint;
begin
  if tick_url is null or tick_secret is null then return null; end if;
  if to_regnamespace('net') is null then return null; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 60000)'
    into request_id
    using tick_url, jsonb_build_object('Content-Type', 'application/json', 'x-battle-tick-secret', tick_secret);
  return request_id;
end
$$;

revoke all on function public.battle_tick_fire() from public, anon, authenticated;

-- Every minute, when pg_cron is there (re-running replaces the job).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'pokeiq-battle-tick';
    perform cron.schedule('pokeiq-battle-tick', '* * * * *', 'select public.battle_tick_fire()');
  end if;
end
$$;
