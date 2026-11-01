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
  module       text not null check (module in ('whos-that', 'cry', 'dex', 'types', 'higher-lower', 'games', 'anime', 'competitive', 'shiny', 'zoom-reveal', 'whose-team', 'mixed')),
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

-- ==================================================================
-- 0007_pokeguessr_duels.sql
-- ==================================================================

-- PokéGuessr duels: two trainers head to head on the same rounds.
--
-- One row per duel while it's played. `state` holds the whole duel (seats,
-- pins, scores, HP), including pins the opponent mustn't see before a round
-- is revealed, so RLS is on with NO policies: only the server (service role)
-- reads or writes it. Every update is a compare-and-swap on `version`.
create table if not exists public.geo_duels (
  code        text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  version     integer not null default 0 check (version >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists geo_duels_expires_idx on public.geo_duels (expires_at);

alter table public.geo_duels enable row level security;

revoke all on public.geo_duels from anon, authenticated;

-- ==================================================================
-- 0008_duels.sql
-- ==================================================================

-- Duels beyond PokéGuessr (Pokédle, quizzes): two trainers head to head
-- through a share link. One table for every kind; `kind` says which game.
--
-- One row per duel while it's played. `state` holds the whole duel (seats,
-- guesses, answers, scores), including secrets and picks the opponent
-- mustn't see before a round is revealed, so RLS is on with NO policies:
-- only the server (service role) reads or writes it. Every update is a
-- compare-and-swap on `version`.
create table if not exists public.duels (
  code        text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  kind        text not null check (kind in ('pokedle', 'quiz')),
  version     integer not null default 0 check (version >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists duels_expires_idx on public.duels (expires_at);

alter table public.duels enable row level security;

revoke all on public.duels from anon, authenticated;

-- ==================================================================
-- 0009_duel_queue.sql
-- ==================================================================

-- Matchmaking: trainers searching for the same game with the same settings
-- are paired into a duel.
--
-- One row per queue (a game and its settings, e.g. "geo:world",
-- "pokedle:all") while it's in use. `state` holds the trainer waiting, if
-- any, and the seats of trainers paired while they waited, so RLS is on with
-- NO policies: only the server (service role) reads or writes it. Every
-- update is a compare-and-swap on `version`, so a waiting trainer is paired
-- once at most.
create table if not exists public.duel_queue (
  key         text primary key check (key ~ '^[a-z0-9:-]{3,64}$'),
  version     integer not null default 0 check (version >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists duel_queue_expires_idx on public.duel_queue (expires_at);

alter table public.duel_queue enable row level security;

revoke all on public.duel_queue from anon, authenticated;

-- ==================================================================
-- 0010_battles.sql
-- ==================================================================

-- Pokémon battles on Pokémon Showdown's simulator: against the computer, or
-- live between two trainers through an invite link.
--
-- One row per battle while it's played. Nothing in it may reach a player
-- directly: `state` (the simulator snapshot) and `input_log` hold both full
-- teams and the RNG state, `meta` holds the seed, the pending requests and
-- seat secrets, and each `log_*` column is one viewer's channel. So RLS is on
-- with NO policies: only the server (service role) reads or writes it, and it
-- hands each player their own channel and request. Every update is a
-- compare-and-swap on `version`.
create table if not exists public.battles (
  code           text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  kind           text not null check (kind in ('cpu', 'pvp', 'tower', 'factory', 'sandbox')),
  format         text not null check (char_length(format) between 1 and 60),
  version        integer not null default 0 check (version >= 0),
  -- The @pkmn/sim version that wrote `state`; another version rebuilds from `input_log`.
  sim_version    text not null,
  meta           jsonb not null,
  -- JSON.stringify(Battle.toJSON()), kept as text so the bytes round-trip exactly (~55 KB, TOAST-compressed).
  state          text,
  -- The simulator's input log: the source of truth for rebuilds, replays and audits.
  input_log      jsonb not null default '[]'::jsonb,
  -- Each viewer's protocol channel, newline-joined (hidden information already split out).
  log_p1         text not null default '',
  log_p2         text not null default '',
  log_spectator  text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create index if not exists battles_expires_idx on public.battles (expires_at);

alter table public.battles enable row level security;

revoke all on public.battles from anon, authenticated;

-- ==================================================================
-- 0012_reports.sql
-- ==================================================================

-- Problem reports: what players send with "Report a problem" (feedback), and
-- errors their browsers catch (error).
--
-- Written only by the server (POST /api/report, service role) and read only
-- in the Supabase dashboard. Reports can hold a contact address, so RLS is
-- on with NO policies: the anon key can't read or write them at all.
create table if not exists public.reports (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('error', 'feedback')),
  message     text not null check (char_length(message) between 1 and 2000),
  -- The page it was sent from, e.g. /pokedle/duel/abcd2345.
  page        text check (char_length(page) <= 500),
  user_agent  text check (char_length(user_agent) <= 400),
  contact     text check (char_length(contact) <= 200),
  -- Errors: the stack, source and digest.
  extra       jsonb
);

create index if not exists reports_created_idx on public.reports (created_at desc);

alter table public.reports enable row level security;

revoke all on public.reports from anon, authenticated;
revoke all on sequence public.reports_id_seq from anon, authenticated;

-- ==================================================================
-- 0013_dle_results.sql
-- ==================================================================

-- Pokédle community stats: how everyone did on the day's puzzle.
--
-- One row per daily puzzle and trainer, written by the server once a
-- trainer finishes, after it has played their guesses again (a result can be
-- replayed but never made up). The first result per trainer and day is the
-- one kept. `player_key` is an HMAC of a random browser id (or the trainer's
-- account id), never the id itself. Practice and archive games are never
-- recorded.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes it, through the two functions below. Every query is for
-- one day, so everything is indexed by date first.
create table if not exists public.dle_results (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- Order of arrival: "you were the #N trainer to solve today".
  seq          bigint      generated always as identity,
  guesses      smallint    not null check (guesses between 1 and 12),
  solved       boolean     not null,
  hard         boolean     not null default false,
  -- Hints opened (category, silhouette).
  hints        smallint    not null default 0 check (hints between 0 and 2),
  first_guess  smallint    not null check (first_guess > 0),
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key)
);

create index if not exists dle_results_day_seq_idx on public.dle_results (puzzle_date, seq);
create index if not exists dle_results_day_opener_idx on public.dle_results (puzzle_date, first_guess);

alter table public.dle_results enable row level security;

revoke all on public.dle_results from anon, authenticated;

-- Records a finished daily (keeping the first result per trainer and day)
-- and returns the row kept with where it stands: how many trainers had
-- finished by then (`position`), how many had solved (`rank`, if this one
-- did) and how many opened with the same Pokémon.
create or replace function public.dle_record_result(
  p_date    date,
  p_player  text,
  p_guesses smallint,
  p_solved  boolean,
  p_hard    boolean,
  p_hints   smallint,
  p_first   smallint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  mine public.dle_results;
  fresh boolean;
begin
  insert into public.dle_results (puzzle_date, player_key, guesses, solved, hard, hints, first_guess)
  values (p_date, p_player, p_guesses, p_solved, p_hard, p_hints, p_first)
  on conflict (puzzle_date, player_key) do nothing
  returning * into mine;
  fresh := found;
  if not fresh then
    select * into mine from public.dle_results where puzzle_date = p_date and player_key = p_player;
  end if;

  return jsonb_build_object(
    'recorded',    fresh,
    'guesses',     mine.guesses,
    'solved',      mine.solved,
    'first_guess', mine.first_guess,
    'position',    (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.seq <= mine.seq),
    'rank',        case when mine.solved then
                     (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.solved and r.seq <= mine.seq)
                   end,
    'same_opener', (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.first_guess = mine.first_guess)
  );
end;
$$;

-- The day's totals, the same for every trainer (the API caches it for 30
-- seconds): trainers, solves, solves by guess count and the top openers.
create or replace function public.dle_day_summary(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with day as (
    select guesses, solved, first_guess from public.dle_results where puzzle_date = p_date
  ),
  solves as (
    select guesses, count(*) as n from day where solved group by guesses
  ),
  openers as (
    select first_guess, count(*) as n from day group by first_guess order by n desc, first_guess limit 5
  )
  select jsonb_build_object(
    'players', (select count(*) from day),
    'solved',  (select count(*) from day where solved),
    'solves',  coalesce((select jsonb_object_agg(guesses, n) from solves), '{}'::jsonb),
    'openers', coalesce((select jsonb_agg(jsonb_build_array(first_guess, n) order by n desc, first_guess) from openers), '[]'::jsonb)
  );
$$;

revoke all on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint) from public, anon, authenticated;
revoke all on function public.dle_day_summary(date) from public, anon, authenticated;
grant execute on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint) to service_role;
grant execute on function public.dle_day_summary(date) to service_role;

-- ==================================================================
-- 0036_profile_about.sql
-- ==================================================================
-- PokéIQ profile "About me": a trainer's Pokémon picks and favourite parts of
-- the games, shown on their public profile.
--
-- data holds { pokemon: { <slot>: { id, shiny } }, games: { <slot>: <choice> } }.
-- The server checks every pick (a real Pokémon or form that fits the slot;
-- game choices from fixed lists) before writing it. Anyone can read a row;
-- nobody can write through the anon or authenticated roles. Accounts are the
-- site's own (not Supabase Auth), so the owner's edits go through the server
-- API, which checks the session and writes with the service-role key.

create table if not exists public.profile_about (
  user_id    uuid        primary key references public.profiles (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  updated_at timestamptz not null default now()
);

alter table public.profile_about enable row level security;

drop policy if exists "profile_about is public" on public.profile_about;
create policy "profile_about is public" on public.profile_about for select using (true);

revoke all on public.profile_about from anon, authenticated;
grant select on public.profile_about to anon, authenticated;
