-- Zoom Reveal quiz mode: let its runs onto the leaderboard.
-- Keeps every module already allowed (another mode's migration may have added one) and adds 'zoom-reveal'.
do $$
declare
  allowed text[];
begin
  select coalesce(array_agg(distinct m[1]), array[]::text[])
    into allowed
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z-]+)''', 'g') as m
   where c.conrelid = 'public.runs'::regclass and c.conname = 'runs_module_check';
  allowed := array(select distinct unnest(allowed || array['whos-that', 'cry', 'dex', 'types', 'higher-lower', 'games', 'anime', 'competitive', 'shiny', 'zoom-reveal', 'mixed']));
  alter table public.runs drop constraint if exists runs_module_check;
  execute format('alter table public.runs add constraint runs_module_check check (module = any (%L::text[]))', allowed);
end $$;
