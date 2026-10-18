-- PokéGuessr maps beyond Kanto: board keys like "sinnoh:classic:streak"
-- are longer than the original 20-character limit.
alter table public.geo_runs drop constraint if exists geo_runs_mode_check;
alter table public.geo_runs add constraint geo_runs_mode_check check (char_length(mode) between 1 and 40);
