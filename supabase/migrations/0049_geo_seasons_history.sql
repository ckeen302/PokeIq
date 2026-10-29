-- Ranked PokéGuessr seasons, and PokéGuessr duel history with replays.
--
-- SEASONS (src/lib/geo-seasons.ts, src/lib/server/geo-ranked.ts). Ranked
-- runs in eight-week seasons starting on fixed UTC dates (the app's config).
-- `geo_ranked.season` is the season a rating belongs to (null: the season
-- the row was made in). Nothing runs on a schedule: the first ranked action
-- after a boundary calls geo_ranked_season_roll, which in one transaction
-- (under an advisory lock, and idempotent) archives each trainer's finished
-- season in `geo_ranked_seasons` (games, record, final and peak Elo, peak
-- division; only if they played in it) and softly resets their rating
-- (geo_ranked_season_reset, the same maths as geoSeasonReset in
-- src/lib/geo-seasons.ts). Season stats are read from geo_ranked_matches.
-- Rewards are derived in the app from the peak division (geoSeasonRewards).
--
-- DUEL HISTORY (src/lib/server/geo-duel-history.ts). One row per finished
-- PokéGuessr duel with at least one identified trainer: their keys (HMACs,
-- the same as geo_ranked's player_key; never shown), the public summary
-- (names, mode, result, HP, Elo change) and every revealed round (the
-- screenshot, both pins, the true place, scores, damage and HP) for the
-- replay. Only the two trainers can read a row, unless one of them made it
-- public.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes. The app works without this migration: seasons are then a
-- name and a countdown only, and the history page says it's not available.

alter table public.geo_ranked add column if not exists season integer;

create table if not exists public.geo_ranked_seasons (
  player_key    text        not null references public.geo_ranked (player_key) on delete cascade,
  season        integer     not null check (season >= 1),
  name          text        not null check (char_length(name) between 1 and 24),
  games         integer     not null default 0 check (games >= 0),
  wins          integer     not null default 0 check (wins >= 0),
  losses        integer     not null default 0 check (losses >= 0),
  draws         integer     not null default 0 check (draws >= 0),
  final_elo     integer     not null,
  peak_elo      integer     not null,
  peak_division text        not null check (peak_division ~ '^[a-z]{1,16}$'),
  created_at    timestamptz not null default now(),
  primary key (player_key, season)
);

create index if not exists geo_ranked_matches_played_a_idx on public.geo_ranked_matches (player_a, played_on);
create index if not exists geo_ranked_matches_played_b_idx on public.geo_ranked_matches (player_b, played_on) where player_b is not null;

alter table public.geo_ranked_seasons enable row level security;
revoke all on public.geo_ranked_seasons from anon, authenticated;

-- The season a day falls in, given every season's start date in order (0 before the first).
create or replace function public.geo_ranked_season_of(p_day date, p_starts date[])
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce(max(i), 0)::integer from generate_subscripts(p_starts, 1) as i where p_starts[i] <= p_day;
$$;

-- A rating after its season: halfway (p_keep) toward the first floor, never
-- below the floor of the division under the one it's in, never raised.
-- p_floors are the divisions' floors, lowest first.
create or replace function public.geo_ranked_season_reset(p_elo integer, p_keep numeric, p_floors integer[])
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  idx   integer := 1;
  below integer;
  c     integer;
begin
  for i in 1 .. array_length(p_floors, 1) loop
    if p_elo >= p_floors[i] then idx := i; end if;
  end loop;
  below := p_floors[greatest(1, idx - 1)];
  c := p_floors[1] + round(greatest(0, p_elo - p_floors[1]) * p_keep)::integer;
  return least(p_elo, greatest(c, below));
end;
$$;

-- A trainer's ranked duels between two days (from inclusive, to exclusive):
-- { games, wins, losses, draws, peak } (peak: the best Elo after a duel, or null).
create or replace function public.geo_ranked_season_stats(p_key text, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'games',  count(*),
    'wins',   count(*) filter (where m.s = 1),
    'losses', count(*) filter (where m.s = 0),
    'draws',  count(*) filter (where m.s = 0.5),
    'peak',   max(m.e)
  )
  from (
    select score_a as s, after_a as e from public.geo_ranked_matches where player_a = p_key and played_on >= p_from and played_on < p_to
    union all
    select score_b, after_b from public.geo_ranked_matches where player_b = p_key and played_on >= p_from and played_on < p_to
  ) m;
$$;

-- Rolls every rating into p_season (see above). p_starts holds every
-- season's start date from the first through p_season + 1; p_floors and
-- p_divisions the divisions' floors and ids, lowest first. Returns how many
-- ratings were reset (0 when already rolled).
create or replace function public.geo_ranked_season_roll(
  p_season    integer,
  p_starts    date[],
  p_today     date,
  p_keep      numeric,
  p_floors    integer[],
  p_divisions text[]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r     record;
  st    jsonb;
  peak  integer;
  pdiv  text;
  n     integer := 0;
begin
  if p_season < 1 or array_length(p_starts, 1) < p_season + 1 then
    raise exception 'season starts must cover the season and the next one';
  end if;
  perform pg_advisory_xact_lock(hashtext('geo_ranked_season_roll'));

  -- Rows from before this season was known: the season they were made in.
  update public.geo_ranked set season = least(p_season, public.geo_ranked_season_of((created_at at time zone 'utc')::date, p_starts))
  where season is null;

  for r in select * from public.geo_ranked where season < p_season order by player_key for update loop
    if r.season >= 1 then
      st := public.geo_ranked_season_stats(r.player_key, p_starts[r.season], p_starts[r.season + 1]);
      if (st ->> 'games')::integer > 0 then
        peak := (st ->> 'peak')::integer;
        pdiv := p_divisions[1];
        for i in 1 .. array_length(p_floors, 1) loop
          if peak >= p_floors[i] then pdiv := p_divisions[i]; end if;
        end loop;
        insert into public.geo_ranked_seasons (player_key, season, name, games, wins, losses, draws, final_elo, peak_elo, peak_division)
        values (
          r.player_key, r.season, r.name,
          (st ->> 'games')::integer, (st ->> 'wins')::integer, (st ->> 'losses')::integer, (st ->> 'draws')::integer,
          public.geo_ranked_decayed(r.elo, r.day, r.games_today, p_starts[r.season + 1]),
          peak, pdiv
        )
        on conflict (player_key, season) do nothing;
      end if;
    end if;
    update public.geo_ranked set
      elo         = public.geo_ranked_season_reset(public.geo_ranked_decayed(r.elo, r.day, r.games_today, p_today), p_keep, p_floors),
      day         = null,
      games_today = 0,
      season      = p_season,
      decayed_at  = now(),
      updated_at  = now()
    where player_key = r.player_key;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.geo_ranked_season_of(date, date[]) from public, anon, authenticated;
revoke all on function public.geo_ranked_season_reset(integer, numeric, integer[]) from public, anon, authenticated;
revoke all on function public.geo_ranked_season_stats(text, date, date) from public, anon, authenticated;
revoke all on function public.geo_ranked_season_roll(integer, date[], date, numeric, integer[], text[]) from public, anon, authenticated;
grant execute on function public.geo_ranked_season_of(date, date[]) to service_role;
grant execute on function public.geo_ranked_season_reset(integer, numeric, integer[]) to service_role;
grant execute on function public.geo_ranked_season_stats(text, date, date) to service_role;
grant execute on function public.geo_ranked_season_roll(integer, date[], date, numeric, integer[], text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Duel history
-- ---------------------------------------------------------------------------

create table if not exists public.geo_duel_history (
  code       text        primary key check (code ~ '^[a-z0-9]{4,16}$'),
  key_a      text        check (key_a ~ '^[A-Za-z0-9_-]{16,64}$'),
  key_b      text        check (key_b ~ '^[A-Za-z0-9_-]{16,64}$'),
  ranked     boolean     not null default false,
  ended_at   timestamptz not null,
  summary    jsonb       not null,
  rounds     jsonb       not null,
  public     boolean     not null default false,
  created_at timestamptz not null default now(),
  check (key_a is not null or key_b is not null),
  check (octet_length(rounds::text) < 200000)
);

create index if not exists geo_duel_history_a_idx on public.geo_duel_history (key_a, ended_at desc) where key_a is not null;
create index if not exists geo_duel_history_b_idx on public.geo_duel_history (key_b, ended_at desc) where key_b is not null;

alter table public.geo_duel_history enable row level security;
revoke all on public.geo_duel_history from anon, authenticated;
