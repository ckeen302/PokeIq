-- Pokémon Hunt: the Daily Hunt's leaderboard.
--
-- One row per finished Daily Hunt a player chose to put on the board. Written
-- only by the server (src/app/api/geo/hunt/leaderboard), and only from a
-- result the server signed after grading every round itself: the score, each
-- round's points and the time come from that, never from the browser.
--
-- Guards, as geo_runs's: one row per game (daily_date, session_id) and one per
-- name a day (daily_date, lower(player_name)), on top of the server's own
-- (a few entries per address a day, a Daily played again on one device never
-- signed for the board, a believable time).
--
-- Small on purpose, for the free tier: a few integers and a name a row, and
-- the board reads only one day's top rows through its index. Until this runs
-- the site hides the board and the game plays as before.
--
-- RLS on with NO policies and no grants for anon or authenticated (0056's
-- lockdown): only the service role reads or writes. Additive and safe to run
-- more than once.

create table if not exists public.hunt_daily_scores (
  id           uuid        primary key default gen_random_uuid(),
  daily_date   date        not null,
  session_id   text        not null check (char_length(session_id) between 8 and 64),
  player_name  text        not null check (char_length(player_name) between 1 and 24),
  score        integer     not null check (score between 0 and 25000),
  rounds       integer[]   not null check (cardinality(rounds) = 5),
  duration_ms  integer     not null check (duration_ms >= 0),
  created_at   timestamptz not null default now()
);

create unique index if not exists hunt_daily_scores_game_idx on public.hunt_daily_scores (daily_date, session_id);
create unique index if not exists hunt_daily_scores_name_idx on public.hunt_daily_scores (daily_date, lower(player_name));
-- The board: a day's best, the faster first on a tie.
create index if not exists hunt_daily_scores_board_idx on public.hunt_daily_scores (daily_date, score desc, duration_ms asc);

alter table public.hunt_daily_scores enable row level security;
revoke all on public.hunt_daily_scores from anon, authenticated;
