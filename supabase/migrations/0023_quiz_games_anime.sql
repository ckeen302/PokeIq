-- Mainline Games and Pokémon Anime quiz modes: let their runs onto the leaderboard.
alter table public.runs drop constraint if exists runs_module_check;
alter table public.runs add constraint runs_module_check
  check (module in ('whos-that', 'cry', 'dex', 'types', 'higher-lower', 'games', 'anime', 'mixed'));
