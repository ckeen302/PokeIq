-- PokéConnections' daily leaderboard: fewest mistakes, then fastest time.
--
-- One row per daily puzzle and trainer (and one per name a day), written by
-- the server only after it has played the trainer's guesses again: the
-- mistakes come from that replay, and the time from the server's own clock
-- (when it dealt the tiles, to when the finished game reached it). Only
-- solved games by signed-in or named trainers are ranked. `player_key` is
-- an HMAC of a random browser id or the trainer's account id, never the id.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes it; the board reaches players through /api/connections/
-- leaderboard. The game works without this table (no board) until it's applied.
create table if not exists public.connections_board (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  player_name  text        not null check (char_length(player_name) between 1 and 24),
  mistakes     smallint    not null check (mistakes between 0 and 3),
  duration_ms  integer     not null check (duration_ms > 0),
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key)
);

-- One entry per name per daily (first come, first served).
create unique index if not exists connections_board_name_idx
  on public.connections_board (puzzle_date, lower(player_name));

create index if not exists connections_board_rank_idx
  on public.connections_board (puzzle_date, mistakes, duration_ms);

alter table public.connections_board enable row level security;

revoke all on public.connections_board from anon, authenticated;
