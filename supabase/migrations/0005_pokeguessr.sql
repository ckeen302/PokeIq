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
