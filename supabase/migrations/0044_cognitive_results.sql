-- Cognitive PokéIQ test results (src/lib/server/cognitive-results.ts): one
-- row per finished test with the four raw section scores and the composite,
-- and nothing else — no name, account, IP or device — so the seeded norms
-- (src/data/cognitive-norms.json, scripts/cognitive-norms.ts) can be
-- re-fitted on real trainers later. `version` says which test plan and
-- norms produced the row.
--
-- Written only by the server (POST /api/iq-test/result, service role).
-- Until this runs, nothing is logged and scoring carries on from the seeded
-- norms. RLS is on with NO policies and no grants for anon or authenticated.

create table if not exists public.cognitive_results (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  fluid_raw    integer not null check (fluid_raw between 0 and 200),
  memory_raw   integer not null check (memory_raw between 0 and 200),
  speed_raw    integer not null check (speed_raw between 0 and 400),
  spatial_raw  integer not null check (spatial_raw between 0 and 200),
  composite    integer not null check (composite between 40 and 160),
  version      integer not null default 1 check (version between 1 and 100)
);

create index if not exists cognitive_results_version_idx on public.cognitive_results (version, created_at);

alter table public.cognitive_results enable row level security;

revoke all on public.cognitive_results from anon, authenticated;
revoke all on sequence public.cognitive_results_id_seq from anon, authenticated;

-- Raw-score distributions per version (what a re-fit reads).
create or replace view public.cognitive_result_stats
with (security_invoker = true) as
  select version, count(*)::integer as tests,
         avg(fluid_raw)::real as fluid_avg, avg(memory_raw)::real as memory_avg,
         avg(speed_raw)::real as speed_avg, avg(spatial_raw)::real as spatial_avg,
         avg(composite)::real as composite_avg
  from public.cognitive_results
  group by version;

revoke all on public.cognitive_result_stats from anon, authenticated;
