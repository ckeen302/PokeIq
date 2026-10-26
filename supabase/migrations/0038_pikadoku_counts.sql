-- Pikadoku: each cell's pick counts, added up in the database.
--
-- The server used to read every answer row of a day (and stopped at 90,000
-- rows, about 10,000 players, so a busy day's rarity was wrong). This returns
-- one row per cell and Pokémon instead: at most a few hundred rows however many
-- trainers played, served by pikadoku_answers_cell_idx.
--
-- Server only, like the table: no grants to anon or authenticated. The game
-- falls back to reading the rows until this is applied.
create or replace function public.pikadoku_counts(p_date date, p_difficulty text)
returns table (cell smallint, pokemon_id integer, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.cell, a.pokemon_id, count(*)::bigint as n
  from public.pikadoku_answers a
  where a.puzzle_date = p_date and a.difficulty = p_difficulty
  group by a.cell, a.pokemon_id
$$;

revoke all on function public.pikadoku_counts(date, text) from public;
revoke all on function public.pikadoku_counts(date, text) from anon, authenticated;
grant execute on function public.pikadoku_counts(date, text) to service_role;
