-- Who Am I? duels live in the shared `duels` table: let it take the new kind.
alter table public.duels drop constraint if exists duels_kind_check;
alter table public.duels add constraint duels_kind_check check (kind in ('pokedle', 'quiz', 'whoami'));
