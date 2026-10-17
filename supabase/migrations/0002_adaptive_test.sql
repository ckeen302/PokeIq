-- Adds the adaptive PokéIQ Test format.
alter table public.runs drop constraint if exists runs_format_check;
alter table public.runs
  add constraint runs_format_check check (format in ('classic', 'survival', 'blitz', 'adaptive'));

create index if not exists runs_iq_board_idx
  on public.runs (pokeiq desc, score desc)
  where format = 'adaptive';
