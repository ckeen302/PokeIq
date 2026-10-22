-- PokéConnections duels: races in the shared `duels` table (0008), and
-- friend challenges to them (0019). Both tables only allow the kinds they
-- knew about; this adds 'connections' to each.
--
-- Nothing else changes: the duel itself is the same JSON record as every
-- other kind (the server checks every guess; the groups never leave it until
-- the race is over), with the same RLS lock-down.

alter table public.duels drop constraint if exists duels_kind_check;
alter table public.duels add constraint duels_kind_check check (kind in ('pokedle', 'quiz', 'connections'));

alter table public.friend_challenges drop constraint if exists friend_challenges_kind_check;
alter table public.friend_challenges add constraint friend_challenges_kind_check check (kind in ('battle', 'pokedle', 'quiz', 'guessr', 'connections'));
