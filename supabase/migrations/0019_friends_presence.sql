-- Friends, presence, challenges between friends, and finding a user.
--
-- * friendships: one row per pair of accounts (user_a < user_b), "pending"
--   while a request waits (requested_by says who asked) and "accepted" once
--   both are friends. Declining or removing deletes the row.
-- * user_blocks: who blocked whom. A block removes any friendship and stops
--   requests and challenges in both directions.
-- * user_presence: one row per account, rewritten by a heartbeat about once
--   a minute while a tab is visible. A trainer is online until expires_at
--   (the last heartbeat plus a short TTL). `invisible` is "appear offline".
--   `activity` is what the server worked out they're doing ({kind, label,
--   watch?}), shown to accepted friends only.
-- * friend_challenges: a challenge to a battle or a duel the challenger has
--   already opened (its code), waiting for the friend's answer for ten
--   minutes. Answered challenges are deleted once the challenger has seen
--   the answer.
-- * friend_encounters: "Add friend" after a battle or duel. Each signed-in
--   trainer registers their own seat (proved by their seat token), so the
--   other side can send a request without either name being revealed.
--   Kept for a few hours.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes, as in 0012-0018.

create table if not exists public.friendships (
  user_a        uuid        not null references public.profiles (id) on delete cascade,
  user_b        uuid        not null references public.profiles (id) on delete cascade,
  requested_by  uuid        not null,
  status        text        not null check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by = user_a or requested_by = user_b)
);

create index if not exists friendships_b_idx on public.friendships (user_b);

create table if not exists public.user_blocks (
  blocker     uuid        not null references public.profiles (id) on delete cascade,
  blocked     uuid        not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked);

create table if not exists public.user_presence (
  user_id     uuid        primary key references public.profiles (id) on delete cascade,
  last_seen   timestamptz not null default now(),
  expires_at  timestamptz not null default now(),
  invisible   boolean     not null default false,
  activity    jsonb       check (activity is null or pg_column_size(activity) <= 1000)
);

-- The live "trainers online" count reads only fresh, visible rows.
create index if not exists user_presence_live_idx on public.user_presence (expires_at) where not invisible;

create table if not exists public.friend_challenges (
  id          text        primary key check (id ~ '^[a-hjkmnp-z2-9]{12}$'),
  from_user   uuid        not null references public.profiles (id) on delete cascade,
  to_user     uuid        not null references public.profiles (id) on delete cascade,
  kind        text        not null check (kind in ('battle', 'pokedle', 'quiz', 'guessr')),
  code        text        not null check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  label       text        not null check (char_length(label) between 1 and 80),
  status      text        not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  check (from_user <> to_user)
);

create index if not exists friend_challenges_to_idx on public.friend_challenges (to_user, expires_at);
create index if not exists friend_challenges_from_idx on public.friend_challenges (from_user, expires_at);

create table if not exists public.friend_encounters (
  key         text        primary key check (char_length(key) between 10 and 80),
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  expires_at  timestamptz not null
);

create index if not exists friend_encounters_expires_idx on public.friend_encounters (expires_at);

-- Find a user: prefix search on the lowercased name.
create index if not exists profiles_username_prefix_idx on public.profiles (username_lower text_pattern_ops);

alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_presence enable row level security;
alter table public.friend_challenges enable row level security;
alter table public.friend_encounters enable row level security;
revoke all on public.friendships from anon, authenticated;
revoke all on public.user_blocks from anon, authenticated;
revoke all on public.user_presence from anon, authenticated;
revoke all on public.friend_challenges from anon, authenticated;
revoke all on public.friend_encounters from anon, authenticated;
