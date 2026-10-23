-- Pikadoku: the recorded answers (each cell's rarity) and the daily board.
--
-- Written by the server only, after it has played a finished game again:
-- `pikadoku_answers` holds one row per trainer, day, difficulty and cell (the
-- Pokémon locked there); the uniqueness score is computed from these rows.
-- `pikadoku_board` holds the ranked entries of named trainers. `player_key` is
-- an HMAC of a random browser id or the trainer's account id, never the id.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes them. The game works without these tables (rarity and the
-- board are simply hidden) until this is applied.
create table if not exists public.pikadoku_answers (
  puzzle_date date     not null,
  difficulty  text     not null check (difficulty in ('easy', 'normal', 'expert')),
  player_key  text     not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  cell        smallint not null check (cell between 0 and 8),
  pokemon_id  integer  not null check (pokemon_id > 0),
  created_at  timestamptz not null default now(),
  primary key (puzzle_date, difficulty, player_key, cell)
);

create index if not exists pikadoku_answers_cell_idx
  on public.pikadoku_answers (puzzle_date, difficulty, cell, pokemon_id);

create table if not exists public.pikadoku_board (
  puzzle_date date     not null,
  difficulty  text     not null check (difficulty in ('easy', 'normal', 'expert')),
  player_key  text     not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  player_name text     not null check (char_length(player_name) between 1 and 24),
  solved      smallint not null check (solved between 0 and 9),
  score       numeric(6, 1) not null check (score between 0 and 900),
  duration_ms integer  not null check (duration_ms > 0),
  created_at  timestamptz not null default now(),
  primary key (puzzle_date, difficulty, player_key)
);

create index if not exists pikadoku_board_rank_idx
  on public.pikadoku_board (puzzle_date, difficulty, solved desc, score, duration_ms);

alter table public.pikadoku_answers enable row level security;
alter table public.pikadoku_board enable row level security;

revoke all on public.pikadoku_answers from anon, authenticated;
revoke all on public.pikadoku_board from anon, authenticated;
