-- Name 'em All: ranked boards and races.
--
-- `name_em_all_board` holds each trainer's best entry per scope (a category
-- id like 'gen-1', or 'daily:YYYY-MM-DD') and board ('clear': the fastest
-- full clear; 'count': most named inside the standard time). Written by the
-- server only, after checking the run against its own start token.
-- `player_key` is an HMAC of a random browser id or the trainer's account
-- id, never the id itself.
--
-- `name_em_all_races` holds races in play (2 to 8 trainers from a share
-- link), like the other duel tables: one jsonb state per code, changed by
-- compare-and-swap on `version`, removed a few hours after the last change.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes them. The game works without these tables (the boards
-- are simply hidden, races run in memory locally) until this is applied.

create table if not exists public.name_em_all_board (
  scope       text     not null check (char_length(scope) between 1 and 40),
  board       text     not null check (board in ('clear', 'count')),
  player_key  text     not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  player_name text     not null check (char_length(player_name) between 1 and 24),
  named       smallint not null check (named between 0 and 2000),
  total       smallint not null check (total between 1 and 2000),
  duration_ms integer  not null check (duration_ms >= 0),
  created_at  timestamptz not null default now(),
  primary key (scope, board, player_key)
);

create index if not exists name_em_all_board_rank_idx
  on public.name_em_all_board (scope, board, named desc, duration_ms);

create table if not exists public.name_em_all_races (
  code        text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  version     integer not null default 0 check (version >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists name_em_all_races_expires_idx on public.name_em_all_races (expires_at);

alter table public.name_em_all_board enable row level security;
alter table public.name_em_all_races enable row level security;

revoke all on public.name_em_all_board from anon, authenticated;
revoke all on public.name_em_all_races from anon, authenticated;
