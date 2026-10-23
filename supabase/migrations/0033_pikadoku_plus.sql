-- Pikadoku plus: hand-made Master dailies and the weekly grid's board.
--
-- `pikadoku_curated` holds the Master grids an admin schedules: on its date the
-- Normal daily uses these six categories instead of the generated grid. The
-- game works without it (the built-in seeds still apply; any other day uses the
-- generated grid). Written by the server only, after an admin check.
--
-- The weekly grid keeps its answers and board in the existing Pikadoku tables
-- under difficulty 'weekly' and puzzle_date = the week's Monday, so those
-- difficulty checks are widened. Before this migration the weekly grid is
-- playable but has no rarity or board.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes them.
create table if not exists public.pikadoku_curated (
  puzzle_date date primary key,
  rows        text[] not null check (array_length(rows, 1) = 3),
  cols        text[] not null check (array_length(cols, 1) = 3),
  author      text   not null check (char_length(author) between 1 and 40),
  created_at  timestamptz not null default now()
);

alter table public.pikadoku_curated enable row level security;
revoke all on public.pikadoku_curated from anon, authenticated;

alter table public.pikadoku_answers drop constraint if exists pikadoku_answers_difficulty_check;
alter table public.pikadoku_answers add constraint pikadoku_answers_difficulty_check check (difficulty in ('easy', 'normal', 'expert', 'weekly'));

alter table public.pikadoku_board drop constraint if exists pikadoku_board_difficulty_check;
alter table public.pikadoku_board add constraint pikadoku_board_difficulty_check check (difficulty in ('easy', 'normal', 'expert', 'weekly'));
