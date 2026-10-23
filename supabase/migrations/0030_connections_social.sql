-- PokéConnections' social layer: feedback and group reports, who found
-- which group, the one hint per puzzle, categories moderators switched off,
-- the Puzzle of the Day, and a `hinted` mark on the daily leaderboard.
--
-- Everything is written by the server only, after it has played the
-- trainer's guesses again (src/lib/server/connections-social.ts): a report
-- names a group by colour and the server looks its category up, group
-- results come from the replay, and a hint is recorded when the server
-- hands it out. `player_key` is an HMAC of a random browser id or the
-- trainer's account id, never the id itself.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes these tables. The game works without this migration: the
-- extras are simply off until it is applied.

-- One thumbs up (1) or down (-1) per player and puzzle.
create table if not exists public.connections_feedback (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  rating       smallint    not null check (rating in (-1, 1)),
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key)
);

-- One report per player, puzzle and group (0 yellow to 3 purple); `category`
-- is the generator's category id for that group, set by the server.
create table if not exists public.connections_reports (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  level        smallint    not null check (level between 0 and 3),
  category     text        not null check (char_length(category) between 1 and 80),
  reason       text        not null check (reason in ('wrong-fact', 'unfair', 'too-obscure')),
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key, level)
);
create index if not exists connections_reports_category_idx on public.connections_reports (category);

-- Which groups each player found on a daily (their first result): the
-- "only 12% found purple" numbers.
create table if not exists public.connections_group_results (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  l0           boolean     not null,
  l1           boolean     not null,
  l2           boolean     not null,
  l3           boolean     not null,
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key)
);

-- The one hint a player may take on a daily: the Pokémon revealed and its
-- group. The first row is kept, so asking again returns the same one.
create table if not exists public.connections_hints (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  pokemon_id   integer     not null check (pokemon_id > 0),
  level        smallint    not null check (level between 0 and 3),
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key)
);

-- Categories moderators switched off. Dailies dated after `after_date` skip
-- them; that date and every earlier daily, which players may have played,
-- stay exactly as they were.
create table if not exists public.connections_disabled (
  category     text        primary key check (char_length(category) between 1 and 80),
  after_date   date        not null,
  disabled_by  text        not null,
  created_at   timestamptz not null default now()
);

-- The Puzzle of the Day: one community puzzle a day, kept once picked so it
-- holds all day; `creator_key` backs the "Featured creator" badge.
create table if not exists public.connections_potd (
  puzzle_date  date        primary key,
  puzzle_id    text        not null check (puzzle_id ~ '^[a-z0-9]{8}$'),
  creator_key  text        not null check (creator_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at   timestamptz not null default now()
);
create index if not exists connections_potd_creator_idx on public.connections_potd (creator_key);

-- Hinted games rank below every hint-free game on the daily leaderboard.
alter table public.connections_board add column if not exists hinted boolean not null default false;
drop index if exists public.connections_board_rank_idx;
create index if not exists connections_board_rank_idx
  on public.connections_board (puzzle_date, hinted, mistakes, duration_ms);

alter table public.connections_feedback enable row level security;
alter table public.connections_reports enable row level security;
alter table public.connections_group_results enable row level security;
alter table public.connections_hints enable row level security;
alter table public.connections_disabled enable row level security;
alter table public.connections_potd enable row level security;

revoke all on public.connections_feedback from anon, authenticated;
revoke all on public.connections_reports from anon, authenticated;
revoke all on public.connections_group_results from anon, authenticated;
revoke all on public.connections_hints from anon, authenticated;
revoke all on public.connections_disabled from anon, authenticated;
revoke all on public.connections_potd from anon, authenticated;
