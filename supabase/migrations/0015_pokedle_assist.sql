-- Pokédle's Pokédex assist levels: each daily result keeps the level it was
-- played at (off, notebook, field, full) and the points that level scored,
-- so a result played with the Full Pokédex can't later be claimed as a
-- Notebook one (the first result per trainer and day is the one kept).
--
-- Results recorded before this migration count as the Notebook (the only
-- level there was). The server works with or without this migration: until
-- it's applied, results are recorded without the level.
alter table public.dle_results
  add column if not exists assist text not null default 'notebook'
    check (assist in ('off', 'notebook', 'field', 'full')),
  add column if not exists score smallint
    check (score between 0 and 2000);

create index if not exists dle_results_day_assist_idx on public.dle_results (puzzle_date, assist);

-- The same as 0013's, plus the level and points (both optional, so a call
-- without them still works) and both echoed back for the row kept.
drop function if exists public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint);

create or replace function public.dle_record_result(
  p_date    date,
  p_player  text,
  p_guesses smallint,
  p_solved  boolean,
  p_hard    boolean,
  p_hints   smallint,
  p_first   smallint,
  p_assist  text     default 'notebook',
  p_score   smallint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  mine public.dle_results;
  fresh boolean;
begin
  insert into public.dle_results (puzzle_date, player_key, guesses, solved, hard, hints, first_guess, assist, score)
  values (p_date, p_player, p_guesses, p_solved, p_hard, p_hints, p_first, coalesce(p_assist, 'notebook'), p_score)
  on conflict (puzzle_date, player_key) do nothing
  returning * into mine;
  fresh := found;
  if not fresh then
    select * into mine from public.dle_results where puzzle_date = p_date and player_key = p_player;
  end if;

  return jsonb_build_object(
    'recorded',    fresh,
    'guesses',     mine.guesses,
    'solved',      mine.solved,
    'first_guess', mine.first_guess,
    'assist',      mine.assist,
    'score',       mine.score,
    'position',    (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.seq <= mine.seq),
    'rank',        case when mine.solved then
                     (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.solved and r.seq <= mine.seq)
                   end,
    'same_opener', (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.first_guess = mine.first_guess)
  );
end;
$$;

revoke all on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint, text, smallint) from public, anon, authenticated;
grant execute on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint, text, smallint) to service_role;
