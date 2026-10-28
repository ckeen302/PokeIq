-- PokéGuessr Region Streak and per-trainer stats.
--
-- 1. geo_streaks: each signed-in trainer's best region streak (one row per
--    trainer, keyed by an HMAC of their account id, never the id itself).
--    Written by the server after a finished run (src/lib/server/geo-streak.ts)
--    and read for profile pages. The leaderboard of runs stays in geo_runs
--    (mode 'world:region-streak').
--
-- 2. geo_round_scores grows the columns a profile's stats need: who played
--    the round (signed-in trainers only, as a key), the place's region, the
--    screenshot's game family, what was being played, which game it was part
--    of, and whether a streak pick was right. Region streak rounds carry
--    mode 'region-streak' and are left out of geo_shot_score_stats, since a
--    right/wrong region says nothing about how hard a pin is.
--
-- Everything is idempotent, and the server works without it: before it runs
-- nothing is stored for best streaks or stats, and rounds are logged the
-- old way. RLS stays on with NO policies and no grants for anon or
-- authenticated: only the service role reads or writes.

create table if not exists public.geo_streaks (
  player_key  text        primary key check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  best        integer     not null default 0 check (best >= 0),
  runs        integer     not null default 0 check (runs >= 0),
  last        integer     not null default 0 check (last >= 0),
  updated_at  timestamptz not null default now()
);

alter table public.geo_streaks enable row level security;
revoke all on public.geo_streaks from anon, authenticated;

create index if not exists geo_streaks_best_idx on public.geo_streaks (best desc) where best > 0;

-- geo_round_scores: the stats columns.
alter table public.geo_round_scores add column if not exists player_key text check (player_key is null or player_key ~ '^[A-Za-z0-9_-]{16,64}$');
alter table public.geo_round_scores add column if not exists region text check (region is null or char_length(region) between 1 and 40);
alter table public.geo_round_scores add column if not exists family text check (family is null or char_length(family) between 1 and 20);
alter table public.geo_round_scores add column if not exists kind text check (kind is null or kind in ('game', 'daily', 'challenge', 'streak', 'region-streak', 'duel'));
alter table public.geo_round_scores add column if not exists run_id text check (run_id is null or char_length(run_id) between 1 and 64);
alter table public.geo_round_scores add column if not exists hit boolean;

alter table public.geo_round_scores drop constraint if exists geo_round_scores_mode_check;
alter table public.geo_round_scores add constraint geo_round_scores_mode_check check (mode in ('solo', 'daily', 'challenge', 'region-streak'));

create index if not exists geo_round_scores_player_idx on public.geo_round_scores (player_key, created_at desc) where player_key is not null;

-- Pin rounds only: a region streak's right/wrong doesn't rate the screenshot.
create or replace view public.geo_shot_score_stats
with (security_invoker = true) as
  select shot_id, count(*)::integer as rounds, avg(score)::real as avg_score
  from public.geo_round_scores
  where mode in ('solo', 'daily', 'challenge')
  group by shot_id;

revoke all on public.geo_shot_score_stats from anon, authenticated;
