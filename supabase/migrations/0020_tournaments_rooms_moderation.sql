-- Tournaments, chat rooms, moderation and feedback.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes, as in 0012-0019. The site works before this is applied:
-- tournaments and rooms say they open soon, nobody is muted or banned, and
-- feedback is stored the 0012 way.

-- ---------------------------------------------------------------------------
-- Tournaments
-- ---------------------------------------------------------------------------
--
-- One row per tournament; `data` holds all of it (players, bracket, matches,
-- each match's battles and seat ids), and every write is a compare-and-swap
-- on `version`. The other columns are copies for listing: open and running
-- tournaments, the latest finished, and the running ones a trainer plays in.
-- An official hourly tournament has the id "hourly-YYYYMMDDHH", so creating
-- it twice is a no-op.

create table if not exists public.tournaments (
  id              text        primary key check (id ~ '^[a-z0-9-]{8,24}$'),
  status          text        not null check (status in ('signup', 'running', 'finished', 'cancelled')),
  official        boolean     not null default false,
  player_ids      uuid[]      not null default '{}',
  data            jsonb       not null check (pg_column_size(data) <= 400000),
  version         integer     not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  signup_ends_at  timestamptz not null,
  ended_at        timestamptz
);

create index if not exists tournaments_active_idx on public.tournaments (created_at desc) where status in ('signup', 'running');
create index if not exists tournaments_ended_idx on public.tournaments (ended_at desc) where status in ('finished', 'cancelled');
create index if not exists tournaments_players_idx on public.tournaments using gin (player_ids) where status = 'running';

alter table public.tournaments enable row level security;
revoke all on public.tournaments from anon, authenticated;
