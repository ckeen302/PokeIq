-- Whose Team Is This? quiz mode: let its runs onto the leaderboard.
-- Keeps every module the constraint already allows (Zoom Reveal's 0051 included, whichever order they run in)
-- and adds 'whose-team' and 'zoom-reveal'. Safe to run more than once.
do $$
declare
  current_def text;
  allowed text[];
begin
  select pg_get_constraintdef(c.oid) into current_def
  from pg_constraint c
  where c.conname = 'runs_module_check' and c.conrelid = 'public.runs'::regclass;

  select array_agg(distinct v) into allowed
  from (
    select (regexp_matches(coalesce(current_def, ''), '''([^'']+)''', 'g'))[1] as v
    union
    select unnest(array['whos-that', 'cry', 'dex', 'types', 'higher-lower', 'games', 'anime', 'competitive', 'shiny', 'mixed', 'zoom-reveal', 'whose-team'])
  ) s;

  alter table public.runs drop constraint if exists runs_module_check;
  execute format(
    'alter table public.runs add constraint runs_module_check check (module in (%s))',
    (select string_agg(quote_literal(v), ', ' order by v) from unnest(allowed) v)
  );
end $$;
