-- PokéIQ leaderboard.
-- Public read + public insert (anon key); scores are capped and typed by CHECKs.

create table if not exists public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 20),
  category text not null check (
    category in ('whos-that', 'type-detective', 'move-master', 'stat-showdown', 'daily')
  ),
  score integer not null check (score between 0 and 10000),
  streak integer not null default 0 check (streak between 0 and 100),
  difficulty text not null default 'mixed' check (
    difficulty in ('easy', 'medium', 'hard', 'mixed', 'survival')
  ),
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_category_score_idx
  on public.leaderboard (category, score desc);

alter table public.leaderboard enable row level security;

drop policy if exists "leaderboard public read" on public.leaderboard;
create policy "leaderboard public read"
  on public.leaderboard for select
  using (true);

drop policy if exists "leaderboard public insert" on public.leaderboard;
create policy "leaderboard public insert"
  on public.leaderboard for insert
  with check (true);
