-- Team insights across a trainer's battles (src/lib/server/battle-engine/insights.ts):
-- their most common leads, win rate per Pokémon, the foes that beat them
-- most, and their rating (and GXE) over time. Builds on 0018 and 0037.
--
-- battle_player_summaries: one row per trainer (ladder key, an HMAC) per
-- battle, worked out by the server from the battle's saved replay the first
-- time the trainer's insights are asked for (never while a battle is being
-- played), and kept so it's never worked out twice. A battle with no replay
-- gets a row too (has_replay false), so it isn't looked for again.
--
-- battle_rating_history: each trainer's rating, RD and GXE after every
-- ranked game, written by a trigger whenever battle_ratings moves on (so
-- the battle server itself does nothing new). Battles before this
-- migration have only their rating, from battle_results.
--
-- battle_insights(): the aggregates, computed in the database over a
-- trainer's latest summaries in one format (or all), so the page never
-- pulls more than a few dozen rows.
--
-- RLS on, no policies, no grants: only the service role reads or writes.

create table if not exists public.battle_player_summaries (
  battle_code  text        not null check (battle_code ~ '^[a-hjkmnp-z2-9]{8}$'),
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  format       text        not null check (char_length(format) between 1 and 60),
  ranked       boolean     not null default false,
  result       text        not null check (result in ('win', 'loss', 'draw')),
  has_replay   boolean     not null default true,
  -- Species, as the replay showed them.
  lead         text        check (lead is null or char_length(lead) <= 40),
  team         text[]      not null default '{}' check (cardinality(team) <= 24),
  foes         text[]      not null default '{}' check (cardinality(foes) <= 24),
  -- The foe credited with each KO on this trainer's Pokémon (one entry per KO).
  ko_by        text[]      not null default '{}' check (cardinality(ko_by) <= 24),
  played_at    timestamptz not null,
  created_at   timestamptz not null default now(),
  primary key (battle_code, player_key)
);

create index if not exists battle_player_summaries_player_idx on public.battle_player_summaries (player_key, format, played_at desc);

alter table public.battle_player_summaries enable row level security;
revoke all on public.battle_player_summaries from anon, authenticated;

create table if not exists public.battle_rating_history (
  id           bigint generated always as identity primary key,
  player_key   text             not null,
  format       text             not null,
  games        integer          not null,
  rating       integer          not null,
  rd           double precision,
  gxe          double precision,
  created_at   timestamptz      not null default now()
);

create index if not exists battle_rating_history_player_idx on public.battle_rating_history (player_key, format, created_at);

alter table public.battle_rating_history enable row level security;
revoke all on public.battle_rating_history from anon, authenticated;

create or replace function public.battle_rating_history_log()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.games > 0 and (tg_op = 'INSERT' or new.games <> old.games) then
    insert into public.battle_rating_history (player_key, format, games, rating, rd, gxe)
    values (new.player_key, new.format, new.games, new.rating, new.rd, new.gxe);
  end if;
  return new;
end;
$$;

drop trigger if exists battle_rating_history_log on public.battle_ratings;
create trigger battle_rating_history_log
  after insert or update on public.battle_ratings
  for each row execute function public.battle_rating_history_log();

-- A trainer's insights over their latest `p_limit` battles with a replay
-- (in `p_format`, or every format when it's null).
create or replace function public.battle_insights(p_key text, p_format text, p_limit integer)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recent as (
    select * from public.battle_player_summaries
    where player_key = p_key and has_replay and (p_format is null or format = p_format)
    order by played_at desc
    limit least(greatest(p_limit, 1), 500)
  )
  select jsonb_build_object(
    'battles', (select count(*) from recent),
    'wins',    (select count(*) from recent where result = 'win'),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object('species', lead, 'games', games, 'wins', wins) order by games desc, wins desc, lead)
      from (
        select lead, count(*) as games, count(*) filter (where result = 'win') as wins
        from recent where lead is not null group by lead order by count(*) desc, lead limit 6
      ) l
    ), '[]'::jsonb),
    'mons', coalesce((
      select jsonb_agg(jsonb_build_object('species', species, 'games', games, 'wins', wins) order by games desc, wins desc, species)
      from (
        select m.species, count(*) as games, count(*) filter (where r.result = 'win') as wins
        from recent r cross join lateral (select distinct unnest(r.team) as species) m
        group by m.species order by count(*) desc, m.species limit 24
      ) t
    ), '[]'::jsonb),
    'threats', coalesce((
      select jsonb_agg(jsonb_build_object('species', species, 'games', games, 'losses', losses, 'kos', kos) order by kos desc, losses desc, species)
      from (
        select f.species, count(*) as games, count(*) filter (where r.result = 'loss') as losses,
               coalesce(sum((select count(*) from unnest(r.ko_by) k where k = f.species)), 0) as kos
        from recent r cross join lateral (select distinct unnest(r.foes) as species) f
        group by f.species
        having coalesce(sum((select count(*) from unnest(r.ko_by) k where k = f.species)), 0) > 0
            or count(*) filter (where r.result = 'loss') > 0
        order by 4 desc, 3 desc, f.species limit 8
      ) x
    ), '[]'::jsonb)
  );
$$;
