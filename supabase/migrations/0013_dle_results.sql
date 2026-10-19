-- Pokédle community stats: how everyone did on the day's puzzle.
--
-- One row per daily puzzle and trainer, written by the server once a
-- trainer finishes, after it has played their guesses again (a result can be
-- replayed but never made up). The first result per trainer and day is the
-- one kept. `player_key` is an HMAC of a random browser id (or the trainer's
-- account id), never the id itself. Practice and archive games are never
-- recorded.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes it, through the two functions below. Every query is for
-- one day, so everything is indexed by date first.
create table if not exists public.dle_results (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- Order of arrival: "you were the #N trainer to solve today".
  seq          bigint      generated always as identity,
  guesses      smallint    not null check (guesses between 1 and 12),
  solved       boolean     not null,
  hard         boolean     not null default false,
  -- Hints opened (category, silhouette).
  hints        smallint    not null default 0 check (hints between 0 and 2),
  first_guess  smallint    not null check (first_guess > 0),
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key)
);

create index if not exists dle_results_day_seq_idx on public.dle_results (puzzle_date, seq);
create index if not exists dle_results_day_opener_idx on public.dle_results (puzzle_date, first_guess);

alter table public.dle_results enable row level security;

revoke all on public.dle_results from anon, authenticated;

-- Records a finished daily (keeping the first result per trainer and day)
-- and returns the row kept with where it stands: how many trainers had
-- finished by then (`position`), how many had solved (`rank`, if this one
-- did) and how many opened with the same Pokémon.
create or replace function public.dle_record_result(
  p_date    date,
  p_player  text,
  p_guesses smallint,
  p_solved  boolean,
  p_hard    boolean,
  p_hints   smallint,
  p_first   smallint
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
  insert into public.dle_results (puzzle_date, player_key, guesses, solved, hard, hints, first_guess)
  values (p_date, p_player, p_guesses, p_solved, p_hard, p_hints, p_first)
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
    'position',    (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.seq <= mine.seq),
    'rank',        case when mine.solved then
                     (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.solved and r.seq <= mine.seq)
                   end,
    'same_opener', (select count(*) from public.dle_results r where r.puzzle_date = p_date and r.first_guess = mine.first_guess)
  );
end;
$$;

-- The day's totals, the same for every trainer (the API caches it for 30
-- seconds): trainers, solves, solves by guess count and the top openers.
create or replace function public.dle_day_summary(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with day as (
    select guesses, solved, first_guess from public.dle_results where puzzle_date = p_date
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

revoke all on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint) from public, anon, authenticated;
revoke all on function public.dle_day_summary(date) from public, anon, authenticated;
grant execute on function public.dle_record_result(date, text, smallint, boolean, boolean, smallint, smallint) to service_role;
grant execute on function public.dle_day_summary(date) to service_role;
