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

-- ---------------------------------------------------------------------------
-- Chat rooms
-- ---------------------------------------------------------------------------
--
-- The official rooms are defined in the code (src/lib/rooms.ts); each keeps
-- its last 100 messages (older ones are deleted as new ones arrive). Text is
-- stored as the server let it through: link-free, swears masked. user_id is
-- for moderators only and is never sent to browsers. room_settings holds
-- each room's slow mode.

create table if not exists public.room_messages (
  id          bigserial   primary key,
  room        text        not null check (room ~ '^[a-z]{2,20}$'),
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  name        text        not null check (char_length(name) between 1 and 40),
  text        text        not null check (char_length(text) between 1 and 400),
  created_at  timestamptz not null default now()
);

create index if not exists room_messages_room_idx on public.room_messages (room, id desc);
create index if not exists room_messages_user_idx on public.room_messages (room, user_id, id desc);

create table if not exists public.room_settings (
  room          text        primary key check (room ~ '^[a-z]{2,20}$'),
  slow_seconds  integer     not null default 0 check (slow_seconds between 0 and 600),
  updated_at    timestamptz not null default now()
);

alter table public.room_messages enable row level security;
alter table public.room_settings enable row level security;
revoke all on public.room_messages from anon, authenticated;
revoke all on public.room_settings from anon, authenticated;
revoke all on sequence public.room_messages_id_seq from anon, authenticated;

-- Who's in a room comes from presence (0019): a heartbeat from a room page
-- carries {"room": "<id>"} in its activity.
create index if not exists user_presence_room_idx on public.user_presence ((activity ->> 'room'), expires_at) where activity ? 'room';

-- ---------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------
--
-- user_sanctions: one row per trainer a moderator has acted on. A mute
-- (until muted_until; 9999-12-31 is "permanent") stops chat and room
-- posting; a ban stops PvP, posting, tournaments and friend requests. The
-- server checks both at every one of those doors.
-- mod_actions: the audit log of every moderator action. Moderators are the
-- usernames in the POKEIQ_ADMINS environment variable, never a table, so
-- nothing here can make anyone an admin.

create table if not exists public.user_sanctions (
  user_id      uuid        primary key references public.profiles (id) on delete cascade,
  username     text        not null,
  muted_until  timestamptz,
  banned       boolean     not null default false,
  ban_reason   text        check (char_length(ban_reason) <= 200),
  updated_at   timestamptz not null default now(),
  updated_by   text        not null
);

create table if not exists public.mod_actions (
  id          bigserial   primary key,
  created_at  timestamptz not null default now(),
  admin       text        not null,
  action      text        not null check (char_length(action) <= 40),
  target      text        not null check (char_length(target) <= 80),
  detail      text        check (char_length(detail) <= 300)
);

create index if not exists mod_actions_created_idx on public.mod_actions (id desc);

alter table public.user_sanctions enable row level security;
alter table public.mod_actions enable row level security;
revoke all on public.user_sanctions from anon, authenticated;
revoke all on public.mod_actions from anon, authenticated;
revoke all on sequence public.mod_actions_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports and feedback (0012's table)
-- ---------------------------------------------------------------------------
--
-- Chat reports become their own kind; feedback says whether it's an idea, a
-- bug or something else, and which part of the site it's about; reports
-- remember who sent them (signed-in trainers) and when a moderator resolved
-- them.

alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check check (kind in ('error', 'feedback', 'chat'));
alter table public.reports add column if not exists category text check (category in ('idea', 'bug', 'other'));
alter table public.reports add column if not exists mode text check (char_length(mode) <= 20);
alter table public.reports add column if not exists reporter text check (char_length(reporter) <= 40);
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists resolved_by text check (char_length(resolved_by) <= 40);

create index if not exists reports_open_idx on public.reports (id desc) where resolved_at is null;
