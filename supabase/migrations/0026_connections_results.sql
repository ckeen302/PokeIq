-- PokéConnections daily stats: "71% of trainers solved today's, 18% got it
-- perfect".
--
-- One row per daily puzzle and trainer, written by the server once a
-- trainer finishes, after it has played their guesses again (a result can
-- be replayed but never made up). The first result per trainer and day is
-- the one kept. `player_key` is an HMAC of a random browser id (or the
-- trainer's account id), never the id itself. Practice and archive games are
-- never recorded.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes it, through the function below. The game works without
-- this table (no stats panel) until the migration is applied.
create table if not exists public.connections_results (
  puzzle_date  date        not null,
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  solved       boolean     not null,
  mistakes     smallint    not null check (mistakes between 0 and 4),
  created_at   timestamptz not null default now(),
  primary key (puzzle_date, player_key)
);

alter table public.connections_results enable row level security;

revoke all on public.connections_results from anon, authenticated;

-- Records a finished daily (keeping the first result per trainer and day)
-- and returns the day's totals: trainers, solves and perfect solves.
create or replace function public.conn_record_result(
  p_date     date,
  p_player   text,
  p_solved   boolean,
  p_mistakes smallint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.connections_results (puzzle_date, player_key, solved, mistakes)
  values (p_date, p_player, p_solved, p_mistakes)
  on conflict (puzzle_date, player_key) do nothing;

  return (
    select jsonb_build_object(
      'players', count(*),
      'solved',  count(*) filter (where r.solved),
      'perfect', count(*) filter (where r.solved and r.mistakes = 0)
    )
    from public.connections_results r
    where r.puzzle_date = p_date
  );
end;
$$;

revoke all on function public.conn_record_result(date, text, boolean, smallint) from public, anon, authenticated;
grant execute on function public.conn_record_result(date, text, boolean, smallint) to service_role;
