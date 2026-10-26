-- PokéGuessr round scores: one row per graded round (solo, daily or
-- challenge; not streak misses that timed out), so each screenshot's
-- difficulty can follow how players really do on it. The server reads the
-- per-shot averages (geo_shot_score_stats) every few minutes; a shot with
-- enough rounds moves from the audit's heuristic rating toward its players'.
--
-- Written and read only by the server (POST /api/geo/guess, service role).
-- Until this runs, nothing is logged and the heuristic ratings are used: the
-- game plays exactly as before. RLS is on with NO policies and no grants for
-- anon or authenticated.

create table if not exists public.geo_round_scores (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  shot_id     text not null check (shot_id ~ '^[A-Za-z0-9_-]{8,24}$'),
  score       integer not null check (score between 0 and 5000),
  mode        text not null check (mode in ('solo', 'daily', 'challenge'))
);

create index if not exists geo_round_scores_shot_idx on public.geo_round_scores (shot_id);

alter table public.geo_round_scores enable row level security;

revoke all on public.geo_round_scores from anon, authenticated;
revoke all on sequence public.geo_round_scores_id_seq from anon, authenticated;

-- Each shot's rounds and average score (what the server reads).
create or replace view public.geo_shot_score_stats
with (security_invoker = true) as
  select shot_id, count(*)::integer as rounds, avg(score)::real as avg_score
  from public.geo_round_scores
  group by shot_id;

revoke all on public.geo_shot_score_stats from anon, authenticated;
