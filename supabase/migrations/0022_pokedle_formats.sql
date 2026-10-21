-- Pokédle formats: the daily comes in Classic and Squirdle-style, each one
-- shared puzzle a day with its own answer, so each keeps its own results and
-- community stats. A trainer gets one result per day *and format*.
--
-- Results recorded before this migration are Classic (the only format there
-- was). The server works with or without this migration: until it's
-- applied, Classic's results and stats work as before (its calls never send
-- a format) and the Squirdle-style daily simply has no community stats.
--
-- Same lock-down as 0013: RLS on with no policies and no grants; only the
-- server (service role) reads or writes, through the functions below.
alter table public.dle_results
  add column if not exists format text not null default 'classic'
    check (format in ('classic', 'squirdle'));

-- One result per day, format and trainer.
alter table public.dle_results drop constraint if exists dle_results_pkey;
alter table public.dle_results add primary key (puzzle_date, format, player_key);

drop index if exists public.dle_results_day_seq_idx;
drop index if exists public.dle_results_day_opener_idx;
create index if not exists dle_results_day_format_seq_idx on public.dle_results (puzzle_date, format, seq);
create index if not exists dle_results_day_format_opener_idx on public.dle_results (puzzle_date, format, first_guess);

alter table public.dle_results enable row level security;
revoke all on public.dle_results from anon, authenticated;

-- 0015's function, plus the format (optional: a call without it is Classic).
drop function if exists public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint, text, smallint);

create or replace function public.dle_record_result(
  p_date    date,
  p_player  text,
  p_guesses smallint,
  p_solved  boolean,
  p_hard    boolean,
  p_hints   smallint,
  p_first   smallint,
  p_assist  text     default 'notebook',
  p_score   smallint default null,
  p_format  text     default 'classic'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  mine public.dle_results;
  fresh boolean;
  fmt text := coalesce(p_format, 'classic');
begin
  insert into public.dle_results (puzzle_date, format, player_key, guesses, solved, hard, hints, first_guess, assist, score)
  values (p_date, fmt, p_player, p_guesses, p_solved, p_hard, p_hints, p_first, coalesce(p_assist, 'notebook'), p_score)
  on conflict (puzzle_date, format, player_key) do nothing
  returning * into mine;
  fresh := found;
  if not fresh then
    select * into mine from public.dle_results where puzzle_date = p_date and format = fmt and player_key = p_player;
  end if;

  return jsonb_build_object(
    'recorded',    fresh,
    'guesses',     mine.guesses,
    'solved',      mine.solved,
    'first_guess', mine.first_guess,
    'assist',      mine.assist,
    'score',       mine.score,
    'position',    (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.format = fmt and r.seq <= mine.seq),
    'rank',        case when mine.solved then
                     (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.format = fmt and r.solved and r.seq <= mine.seq)
                   end,
    'same_opener', (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.format = fmt and r.first_guess = mine.first_guess)
  );
end;
$$;

-- 0013's day totals, for one format (Classic when none is given).
drop function if exists public.dle_day_summary(date);

create or replace function public.dle_day_summary(p_date date, p_format text default 'classic')
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with day as (
    select guesses, solved, first_guess from public.dle_results
    where puzzle_date = p_date and format = coalesce(p_format, 'classic')
  ),
  solves as (
    select guesses, count(*) as n from day where solved group by guesses
  ),
  openers as (
    select first_guess, count(*) as n from day group by first_guess order by n desc, first_guess limit 5
  )
  select jsonb_build_object(
    'players', (select count(*) from day),
    'solved',  (select count(*) from day where solved),
    'solves',  coalesce((select jsonb_object_agg(guesses, n) from solves), '{}'::jsonb),
    'openers', coalesce((select jsonb_agg(jsonb_build_array(first_guess, n) order by n desc, first_guess) from openers), '[]'::jsonb)
  );
$$;

revoke all on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint, text, smallint, text) from public, anon, authenticated;
revoke all on function public.dle_day_summary(date, text) from public, anon, authenticated;
grant execute on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint, text, smallint, text) to service_role;
grant execute on function public.dle_day_summary(date, text) to service_role;
