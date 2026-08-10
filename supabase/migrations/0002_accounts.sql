-- PokéIQ accounts: profiles, sessions, per-user stats.
--
-- These tables hold password + session hashes, so RLS denies ALL access to
-- the anon key; the server talks to them exclusively through the
-- service-role key (SUPABASE_SERVICE_ROLE_KEY), which bypasses RLS.

create table if not exists public.profiles (
  id uuid primary key,
  username text not null check (char_length(username) between 3 and 20),
  username_lower text not null unique,
  password_hash text not null,
  -- SHA-256 of the one-time recovery code (null on legacy accounts)
  recovery_code_hash text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token_hash text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists sessions_user_idx on public.sessions (user_id);

create table if not exists public.user_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  games_played integer not null default 0,
  total_correct integer not null default 0,
  total_answered integer not null default 0,
  best_streak integer not null default 0,
  survival_best integer not null default 0,
  total_score integer not null default 0,
  best_scores jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists user_stats_score_idx
  on public.user_stats (total_score desc);

-- Lock everything to the service role: RLS on, no policies for anon.
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.user_stats enable row level security;
