-- PokéIQ accounts: trainer profiles, login sessions and synced progress.
--
-- These tables hold password, session and recovery-code hashes, so RLS is on
-- with NO policies: the anon key can't read or write them at all. The server
-- reaches them only through the service-role key.

create table if not exists public.profiles (
  id uuid primary key,
  username text not null check (char_length(username) between 3 and 20),
  username_lower text not null unique,
  password_hash text not null,
  -- SHA-256 of the current one-time recovery code
  recovery_code_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.auth_sessions (
  -- SHA-256 of the session cookie value; the raw token is never stored
  token_hash text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists auth_sessions_user_idx on public.auth_sessions (user_id);
create index if not exists auth_sessions_expires_idx on public.auth_sessions (expires_at);

-- The player's whole progress record (XP, badges, streaks, rating, skills),
-- synced from the browser so it follows the trainer across devices.
create table if not exists public.user_progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  progress jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.user_progress enable row level security;

revoke all on public.profiles, public.auth_sessions, public.user_progress from anon, authenticated;
