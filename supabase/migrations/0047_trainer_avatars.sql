-- PokéIQ 3D trainer avatars: each account's chibi trainer, shown live in 3D
-- on profiles and the creator, and as a small portrait next to their name.
--
-- profiles.trainer holds compact JSON of preset ids only (no free text):
-- { v, body, skin, eyes, hair, hairColor, hat, hatColor, top, topColor,
--   accent, bottoms, bottomsColor, shoes, shoesColor, gloves, pack,
--   packColor, ball, partner, shiny } (lib/trainer/config.ts). The server
-- checks every choice against the account's badges and ranked tiers before
-- writing it. Null: no trainer (the account shows its Pokémon avatar).
-- Until this runs nobody has a trainer and the creator can't save.
--
-- profiles keeps RLS on with no policies (0004): only the service-role key
-- on the server reads or writes it. Safe to run more than once.

alter table public.profiles add column if not exists trainer jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_trainer_shape') then
    alter table public.profiles add constraint profiles_trainer_shape
      check (trainer is null or (jsonb_typeof(trainer) = 'object' and pg_column_size(trainer) <= 1024));
  end if;
end $$;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
