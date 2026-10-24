-- PokéIQ profile "About me": a trainer's Pokémon picks and favourite parts of
-- the games, shown on their public profile.
--
-- data holds { pokemon: { <slot>: { id, shiny } }, games: { <slot>: <choice> } }.
-- The server checks every pick (a real Pokémon or form that fits the slot;
-- game choices from fixed lists) before writing it. Anyone can read a row;
-- nobody can write through the anon or authenticated roles. Accounts are the
-- site's own (not Supabase Auth), so the owner's edits go through the server
-- API, which checks the session and writes with the service-role key.

create table if not exists public.profile_about (
  user_id    uuid        primary key references public.profiles (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  updated_at timestamptz not null default now()
);

alter table public.profile_about enable row level security;

drop policy if exists "profile_about is public" on public.profile_about;
create policy "profile_about is public" on public.profile_about for select using (true);

revoke all on public.profile_about from anon, authenticated;
grant select on public.profile_about to anon, authenticated;
