-- PokéConnections' puzzle creator: community puzzles and their votes.
--
-- A trainer builds sixteen Pokémon into four named, coloured groups and
-- publishes it; anyone with the short link (/connections/c/<id>) plays it
-- like a practice puzzle. The groups are the ANSWERS, so they live here
-- and are never sent to a player: the server checks every guess itself
-- (src/lib/server/connections-custom.ts) and only reveals a group once
-- it's found, or all four when the game is over.
--
-- `groups` is [{ "name": text, "level": 0-3, "members": [four ids] }],
-- easiest first, and `tiles` the sixteen ids in the grid's starting order.
-- Group names pass the profanity filter before they are stored.
-- `creator_key` is an HMAC of the trainer's account id or browser id (never
-- the id itself); `creator_name` is only set for a signed-in or named trainer.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes these tables. Without this migration the creator and the
-- community page say they're unavailable and everything else carries on.
create table if not exists public.connections_custom (
  id            text        primary key check (id ~ '^[a-z0-9]{8}$'),
  creator_key   text        not null check (creator_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  creator_name  text        check (creator_name is null or char_length(creator_name) between 1 and 24),
  title         text        check (title is null or char_length(title) between 1 and 40),
  groups        jsonb       not null check (jsonb_typeof(groups) = 'array' and jsonb_array_length(groups) = 4),
  tiles         jsonb       not null check (jsonb_typeof(tiles) = 'array' and jsonb_array_length(tiles) = 16),
  up            integer     not null default 0 check (up >= 0),
  down          integer     not null default 0 check (down >= 0),
  score         integer     generated always as (up - down) stored,
  created_at    timestamptz not null default now()
);

create index if not exists connections_custom_new_idx on public.connections_custom (created_at desc);
create index if not exists connections_custom_top_idx on public.connections_custom (score desc, created_at desc);
create index if not exists connections_custom_creator_idx on public.connections_custom (creator_key, created_at desc);

-- One vote per player and puzzle (a thumbs up or down; voting again changes it).
create table if not exists public.connections_custom_votes (
  puzzle_id   text        not null references public.connections_custom (id) on delete cascade,
  voter_key   text        not null check (voter_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  value       smallint    not null check (value in (-1, 1)),
  updated_at  timestamptz not null default now(),
  primary key (puzzle_id, voter_key)
);

alter table public.connections_custom enable row level security;
alter table public.connections_custom_votes enable row level security;

revoke all on public.connections_custom from anon, authenticated;
revoke all on public.connections_custom_votes from anon, authenticated;

-- Sets (1 up, -1 down) or clears (0) a player's vote and keeps the puzzle's
-- tallies in step; returns them, or null when there is no such puzzle.
create or replace function public.conn_custom_vote(
  p_id    text,
  p_voter text,
  p_value smallint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  tally jsonb;
begin
  perform 1 from public.connections_custom where id = p_id for update;
  if not found then
    return null;
  end if;

  if p_value = 0 then
    delete from public.connections_custom_votes where puzzle_id = p_id and voter_key = p_voter;
  else
    insert into public.connections_custom_votes (puzzle_id, voter_key, value)
    values (p_id, p_voter, p_value)
    on conflict (puzzle_id, voter_key) do update set value = excluded.value, updated_at = now();
  end if;

  update public.connections_custom c
     set up   = (select count(*) from public.connections_custom_votes v where v.puzzle_id = p_id and v.value = 1),
         down = (select count(*) from public.connections_custom_votes v where v.puzzle_id = p_id and v.value = -1)
   where c.id = p_id
  returning jsonb_build_object('up', c.up, 'down', c.down) into tally;

  return tally;
end;
$$;

revoke all on function public.conn_custom_vote(text, text, smallint) from public, anon, authenticated;
grant execute on function public.conn_custom_vote(text, text, smallint) to service_role;
