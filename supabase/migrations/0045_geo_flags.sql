-- PokéGuessr behaviour flags (src/lib/server/geo-round-scores.ts): each
-- graded round also records who played it and how, and a flag level the
-- server works out when it grades the round:
--   2  the pin within a few pixels of the place under two seconds after the
--      round was dealt (the picture had to load in that time too);
--   1  a perfect score that fast (luck once; a pattern when it repeats);
--   0  nothing to note.
-- `player_key` is an HMAC of the trainer's account id or of a device id,
-- never the id itself; `player_name` is their trainer name when signed in.
-- Moderators read the counts per trainer (geo_flagged_players) on
-- /admin/geo-flags. Nothing is automatic: no bans, no score changes.
--
-- Before this runs, rounds are still logged without these columns (the
-- server notices and falls back), and the flags page says so.
-- Written and read only by the server (service role): RLS stays on with
-- no policies and no grants for anon or authenticated.

alter table public.geo_round_scores add column if not exists player_key text check (player_key is null or player_key ~ '^[A-Za-z0-9_-]{16,64}$');
alter table public.geo_round_scores add column if not exists player_name text check (player_name is null or char_length(player_name) between 1 and 24);
alter table public.geo_round_scores add column if not exists game_id text check (game_id is null or game_id ~ '^[A-Za-z0-9_-]{4,32}$');
alter table public.geo_round_scores add column if not exists elapsed_ms integer check (elapsed_ms is null or elapsed_ms >= 0);
alter table public.geo_round_scores add column if not exists flag smallint not null default 0 check (flag between 0 and 2);

-- Duel and ranked rounds can be logged too.
alter table public.geo_round_scores drop constraint if exists geo_round_scores_mode_check;
alter table public.geo_round_scores add constraint geo_round_scores_mode_check check (mode in ('solo', 'daily', 'challenge', 'duel', 'ranked'));

create index if not exists geo_round_scores_flag_idx on public.geo_round_scores (player_key, created_at desc) where flag > 0;

-- Each trainer's flagged play (what /admin/geo-flags lists): rounds at level
-- 2, rounds at level 1 or 2, games those were in, rounds in all, last flag.
create or replace view public.geo_flagged_players
with (security_invoker = true) as
  select
    player_key,
    (array_agg(player_name order by created_at desc) filter (where player_name is not null))[1] as player_name,
    count(*) filter (where flag >= 2)::integer as flagged,
    count(*) filter (where flag >= 1)::integer as fast,
    count(distinct game_id) filter (where flag >= 1)::integer as games,
    count(*)::integer as rounds,
    max(created_at) filter (where flag >= 1) as last_at
  from public.geo_round_scores
  where player_key is not null
  group by player_key
  having count(*) filter (where flag >= 1) > 0;

revoke all on public.geo_flagged_players from anon, authenticated;
