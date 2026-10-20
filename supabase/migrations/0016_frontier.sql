-- Battle Frontier: best Battle Factory / Battle Tower streaks for signed-in
-- trainers. One row per trainer and facility, written by the server after a
-- run's battle (the streak comes from a signed run the server played, never
-- from the browser's word). The app works without this table: bests are then
-- kept in the browser only.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes it.
create table if not exists public.frontier_streaks (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  facility   text        not null check (facility in ('factory', 'bssfactory', 'tower')),
  best       integer     not null default 0 check (best >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, facility)
);

alter table public.frontier_streaks enable row level security;

revoke all on public.frontier_streaks from anon, authenticated;

-- Keeps the better of the stored best and p_streak; returns the best.
create or replace function public.frontier_record_best(p_user uuid, p_facility text, p_streak integer)
returns integer
language sql
security invoker
set search_path = public
as $$
  insert into public.frontier_streaks as f (user_id, facility, best)
  values (p_user, p_facility, greatest(p_streak, 0))
  on conflict (user_id, facility)
  do update set best = greatest(f.best, excluded.best),
                updated_at = case when excluded.best > f.best then now() else f.updated_at end
  returning best;
$$;

revoke all on function public.frontier_record_best(uuid, text, integer) from public, anon, authenticated;
