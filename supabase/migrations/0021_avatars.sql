-- PokéIQ avatars: each trainer's picked avatar, shown next to their name.
--
-- profiles.avatar holds { pokemonId, shiny, frame }. The server checks every
-- pick (a real Pokémon; shiny and frame unlocked by the account's level and
-- ranked tiers) before writing it. Null: the account's default Pokémon,
-- picked from its name. Until this runs, everyone shows that default.
--
-- profiles keeps RLS on with no policies (0004): only the service-role key
-- on the server reads or writes it.

alter table public.profiles add column if not exists avatar jsonb
  check (avatar is null or (jsonb_typeof(avatar) = 'object' and pg_column_size(avatar) <= 512));

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
