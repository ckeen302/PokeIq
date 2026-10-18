-- PokéIQ: complete database setup for a fresh Supabase project.
-- Paste this whole file into Supabase → SQL Editor and click Run.
-- It is the files in migrations/ concatenated in order.

-- ==================================================================
-- 0001_pokeiq.sql
-- ==================================================================

-- PokéIQ schema. Run in the Supabase SQL editor or via `supabase db push`.
--
-- Security model: ALL writes go through the Next.js API using the service
-- role key, and only after server-side grading. The public anon key gets
-- read access to leaderboard data and nothing else, so nobody can insert a
-- score straight into Postgres.

-- ============================================================
-- runs: one row per completed, server-graded run
-- ============================================================
create table if not exists public.runs (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null,
  player_name  text not null check (char_length(player_name) between 1 and 24),
  module       text not null check (module in ('whos-that', 'cry', 'dex', 'types', 'higher-lower', 'mixed')),
  format       text not null check (format in ('classic', 'survival', 'blitz')),
  difficulty   text not null check (difficulty in ('easy', 'medium', 'hard')),
  gens         smallint[],
  daily_date   date,
  score        integer not null check (score >= 0),
  correct      integer not null check (correct >= 0),
  total        integer not null check (total >= 0 and correct <= total),
  best_streak  integer not null default 0,
  pokeiq       smallint not null check (pokeiq between 40 and 200),
  duration_ms  integer not null check (duration_ms > 0),
  created_at   timestamptz not null default now(),
  constraint runs_session_id_key unique (session_id)
);

-- One entry per trainer name per daily puzzle (first submission wins).
create unique index if not exists runs_daily_name_idx
  on public.runs (daily_date, lower(player_name))
  where daily_date is not null;

create index if not exists runs_board_idx
  on public.runs (module, format, score desc, duration_ms asc)
  where daily_date is null;

create index if not exists runs_daily_board_idx
  on public.runs (daily_date, score desc, duration_ms asc)
  where daily_date is not null;

alter table public.runs enable row level security;

create policy "anyone can read runs"
  on public.runs for select
  to anon, authenticated
  using (true);
-- No insert/update/delete policies: only the service role (server) writes.

-- ============================================================
-- token_claims: single-use keys for the replay guard
-- ============================================================
create table if not exists public.token_claims (
  key        text primary key,
  created_at timestamptz not null default now()
);
alter table public.token_claims enable row level security;
-- No policies: service role only.

-- Housekeeping: claims are only needed while a session token is valid (2h).
-- Schedule with pg_cron, e.g. hourly:
--   select cron.schedule('prune-claims', '0 * * * *',
--     $$delete from public.token_claims where created_at < now() - interval '6 hours'$$);

-- ============================================================
-- question_attempts + item_calibration: adaptive difficulty
-- ============================================================
create table if not exists public.question_attempts (
  id            bigint generated always as identity primary key,
  item_key      text not null,
  correct       boolean not null,
  item_rating   smallint not null,
  player_rating smallint,
  created_at    timestamptz not null default now()
);
create index if not exists question_attempts_item_idx on public.question_attempts (item_key);
alter table public.question_attempts enable row level security;
-- No policies: service role only.

-- Empirical difficulty per item, on the same Elo scale as players.
--
-- For each attempt we know the player's rating R. If the item's true
-- difficulty is D, P(correct) = g + (1-g) / (1 + 10^((D-R)/400)) with a
-- guessing floor g = 1/options. Solving for D at the observed correct rate
-- around the mean player rating gives a closed-form estimate:
--     D ≈ avg(R) + 400 * log10((1-g)/(p-g) - 1)
-- p is smoothed toward the prior's implied rate with 10 pseudo-attempts, and
-- items need ≥ 30 real attempts before they're trusted.
create or replace view public.item_calibration as
with stats as (
  select
    item_key,
    -- Guessing floor: 2 options for Higher or Lower, 4 elsewhere.
    case when item_key like 'higher-lower:%' then 0.5 else 0.25 end as g,
    count(*)                                      as attempts,
    avg(correct::int)                             as raw_p,
    avg(coalesce(player_rating, 1200))            as mean_player,
    avg(item_rating)                              as prior
  from public.question_attempts
  group by item_key
  having count(*) >= 30
),
smoothed as (
  select
    item_key, g, attempts, mean_player,
    -- Clamp p into (g, 1) so the log stays finite.
    least(0.985, greatest(g + 0.015,
      (raw_p * attempts + (g + (1 - g) / (1 + power(10, (prior - mean_player) / 400.0))) * 10)
      / (attempts + 10)
    )) as p
  from stats
)
select
  item_key,
  attempts,
  round(p::numeric, 3) as p_correct,
  round(greatest(600, least(2200,
    mean_player + 400 * log(((1 - g) / (p - g)) - 1)
  )))::int as calibrated_rating
from smoothed;

comment on view public.item_calibration is
  'Empirical item difficulty (Elo scale) from logged attempts; consumed by src/lib/server/calibration.ts';

-- ==================================================================
-- 0002_adaptive_test.sql
-- ==================================================================

-- Adds the adaptive PokéIQ Test format.
alter table public.runs drop constraint if exists runs_format_check;
alter table public.runs
  add constraint runs_format_check check (format in ('classic', 'survival', 'blitz', 'adaptive'));

create index if not exists runs_iq_board_idx
  on public.runs (pokeiq desc, score desc)
  where format = 'adaptive';

-- ==================================================================
-- 0003_hardening.sql
-- ==================================================================

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

-- ==================================================================
-- 0004_accounts.sql
-- ==================================================================

-- PokéIQ accounts: trainer profiles, login sessions and synced progress.
--
-- These tables hold password, session and recovery-code hashes, so RLS is on
-- with NO policies: the anon key can't read or write them at all. The server
-- reaches them only through the service-role key.

create table if not exists public.profiles (
  id uuid primary key,
  username text not null check (char_length(username) between 3 and 20),
  username_lower text not null unique,
  password_hash text not null,
  -- SHA-256 of the current one-time recovery code
  recovery_code_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.auth_sessions (
  -- SHA-256 of the session cookie value; the raw token is never stored
  token_hash text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists auth_sessions_user_idx on public.auth_sessions (user_id);
create index if not exists auth_sessions_expires_idx on public.auth_sessions (expires_at);

-- The player's whole progress record (XP, badges, streaks, rating, skills),
-- synced from the browser so it follows the trainer across devices.
create table if not exists public.user_progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  progress jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.user_progress enable row level security;

revoke all on public.profiles, public.auth_sessions, public.user_progress from anon, authenticated;

-- ==================================================================
-- 0005_pokeguessr.sql
-- ==================================================================

-- PokéGuessr: one row per finished, server-graded game.
create table if not exists public.geo_runs (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null unique,
  player_name  text not null check (char_length(player_name) between 1 and 24),
  mode         text not null check (char_length(mode) between 1 and 20),
  daily_date   date,
  score        integer not null check (score between 0 and 25000),
  duration_ms  integer not null check (duration_ms > 0),
  created_at   timestamptz not null default now()
);

-- One entry per trainer name per daily game (first submission wins).
create unique index if not exists geo_runs_daily_name_idx
  on public.geo_runs (daily_date, lower(player_name))
  where daily_date is not null;

create index if not exists geo_runs_board_idx
  on public.geo_runs (mode, score desc, duration_ms asc)
  where daily_date is null;

create index if not exists geo_runs_daily_board_idx
  on public.geo_runs (daily_date, score desc, duration_ms asc)
  where daily_date is not null;

alter table public.geo_runs enable row level security;

drop policy if exists "anyone can read geo runs" on public.geo_runs;
create policy "anyone can read geo runs"
  on public.geo_runs for select
  to anon, authenticated
  using (true);
-- No write policies: only the server (service role) inserts, after grading.

-- ==================================================================
-- 0006_pokeguessr_maps.sql
-- ==================================================================

-- PokéGuessr maps beyond Kanto: board keys like "sinnoh:classic:streak"
-- are longer than the original 20-character limit.
alter table public.geo_runs drop constraint if exists geo_runs_mode_check;
alter table public.geo_runs add constraint geo_runs_mode_check check (char_length(mode) between 1 and 40);
