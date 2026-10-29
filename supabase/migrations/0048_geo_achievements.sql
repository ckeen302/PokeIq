-- PokéGuessr achievements and the Weekly Challenge.
--
-- 1. geo_achievements: the achievements each trainer has earned and when,
--    keyed by the same HMAC as their logged rounds (geo_round_scores.player_key:
--    their account, or their device when signed out), never an id itself.
--    The server works them out from the rounds, streaks, ranked rating and
--    weekly boards (src/lib/server/geo-progress.ts) and records each one the
--    first time it is met, so it stays earned (a rating can decay, old rounds
--    age out of what's read). Without this table achievements are still shown,
--    worked out afresh each time.
--
-- 2. geo_runs: one Weekly Challenge entry per name per week (mode
--    'weekly:YYYY-MM-DD', the week's Monday). The server checks this too.
--
-- Idempotent. RLS on with NO policies and no grants for anon or
-- authenticated: only the service role reads or writes.

create table if not exists public.geo_achievements (
  player_key      text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  achievement_id  text        not null check (achievement_id ~ '^[a-z0-9-]{3,40}$'),
  earned_at       timestamptz not null default now(),
  primary key (player_key, achievement_id)
);

alter table public.geo_achievements enable row level security;
revoke all on public.geo_achievements from anon, authenticated;

create unique index if not exists geo_runs_weekly_name_idx
  on public.geo_runs (mode, lower(player_name))
  where mode like 'weekly:%';
