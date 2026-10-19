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
