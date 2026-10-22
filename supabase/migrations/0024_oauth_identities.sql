-- Sign in with Discord / Google.
--
-- Each row ties one provider account (provider + the provider's user id) to
-- one PokéIQ profile. Supabase Auth only runs the OAuth handshake; the
-- PokéIQ session cookie and profile ids stay the source of truth, so friends,
-- ranked, avatars, progress and sanctions keep working unchanged.
--
-- `email` is the provider-verified address (nullable). It is private: never
-- shown publicly and only returned to the account's owner.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes this table.

create table if not exists public.auth_identities (
  provider text not null check (provider in ('discord', 'google')),
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 255),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  email text check (email is null or char_length(email) <= 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_user_id),
  -- One Discord and one Google account per trainer.
  unique (profile_id, provider)
);

alter table public.auth_identities enable row level security;
revoke all on public.auth_identities from anon, authenticated;
