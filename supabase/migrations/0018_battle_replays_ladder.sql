-- Battle replays (and, below, the battle ladder).
--
-- A replay is one finished battle's public log: the spectator channel, the
-- very lines Pokémon Showdown shows its spectators. It never holds a
-- player's own channel, a request, the input log or the seed, so it can't
-- reveal a set or a move the battle didn't. `player_keys` are HMACs of the
-- trainers' accounts or signed anonymous ids (never the ids themselves), for
-- "My replays".
--
-- The id is the battle's code: one replay per battle, and saving it again
-- changes nothing. `public` replays (ranked and spectator-open battles) are
-- listed in recent replays; the rest are unlisted, for anyone with the link.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes.

create table if not exists public.battle_replays (
  id           text        primary key check (id ~ '^[a-hjkmnp-z2-9]{8}$'),
  format       text        not null check (char_length(format) between 1 and 60),
  format_name  text        not null check (char_length(format_name) between 1 and 80),
  players      text[]      not null check (array_length(players, 1) = 2),
  -- Ranked: each trainer's rating before the battle.
  ratings      integer[]   check (ratings is null or array_length(ratings, 1) = 2),
  winner       smallint    check (winner in (0, 1)),
  end_reason   text        not null default 'normal' check (end_reason in ('normal', 'forfeit', 'timeout', 'left', 'nocontest')),
  turns        integer     not null default 0 check (turns >= 0),
  ranked       boolean     not null default false,
  public       boolean     not null default false,
  -- The spectator channel, newline-joined (a long battle is ~50 KB; TOAST-compressed).
  log          text        not null check (char_length(log) <= 2000000),
  player_keys  text[]      not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists battle_replays_recent_idx on public.battle_replays (created_at desc) where public;
create index if not exists battle_replays_format_idx on public.battle_replays (format, created_at desc) where public;
create index if not exists battle_replays_players_idx on public.battle_replays using gin (player_keys);

alter table public.battle_replays enable row level security;
revoke all on public.battle_replays from anon, authenticated;
