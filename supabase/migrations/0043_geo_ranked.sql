-- Ranked PokéGuessr duels (src/lib/server/geo-ranked.ts): one Elo per
-- trainer, rated with Pokémon Showdown's curve (src/lib/rating/elo.ts), and
-- every ranked duel that has been counted.
--
-- `player_key` is an HMAC of the trainer's account id or of a signed
-- anonymous id, never the id itself. `name` is the trainer name they last
-- played a ranked duel under (checked by the server), shown on the ladder.
--
-- Decay is Showdown's, lazily: `day` is the UTC day of the trainer's last
-- ranked duel and `games_today` how many they played that day. Whenever a
-- rating is read it is decayed day by day up to today (geo_ranked_decayed:
-- above 1,400 only; nothing after six games in a day, a point per 100 above
-- 1,500 after one to five, a point per 50 above 1,400 after none), and a
-- standing read with p_write writes that back (`decayed_at`). Nothing runs
-- on a schedule.
--
-- The server works out each rating change and writes it with
-- geo_ranked_apply, which in one transaction:
--   * records the match under the duel's code: a second call for the same
--     duel changes nothing and returns the first call's numbers;
--   * locks both trainers' rows and checks their ratings (decayed to the
--     duel's day) and game counts are still the ones the change was
--     computed from; if either moved, nothing is written and the current
--     values come back for the server to compute again;
--   * moves both ratings on, with wins, losses, draws, the best score and
--     the day's game count.
-- A duel against the Gym Leader bot (player_b null, bot true) moves the
-- trainer only; the bot's Elo is kept on the match. The bot never has a row,
-- so it never appears on the ladder.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes, through the functions below. The game works without this
-- migration: ranked PokéGuessr stays off and casual duels carry on.

create table if not exists public.geo_ranked (
  player_key   text        primary key check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  name         text        not null check (char_length(name) between 1 and 24),
  elo          integer     not null default 1000 check (elo between 1000 and 10000),
  games        integer     not null default 0 check (games >= 0),
  wins         integer     not null default 0 check (wins >= 0),
  losses       integer     not null default 0 check (losses >= 0),
  draws        integer     not null default 0 check (draws >= 0),
  best_score   integer     not null default 0 check (best_score >= 0),
  day          date,
  games_today  integer     not null default 0 check (games_today >= 0),
  decayed_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists geo_ranked_ladder_idx on public.geo_ranked (elo desc, games desc) where games > 0;

create table if not exists public.geo_ranked_matches (
  match_code   text         primary key check (match_code ~ '^[a-z0-9]{4,16}$'),
  player_a     text         not null references public.geo_ranked (player_key) on delete cascade,
  player_b     text         references public.geo_ranked (player_key) on delete cascade,
  bot          boolean      not null default false,
  score_a      numeric(2,1) not null check (score_a in (0, 0.5, 1)),
  score_b      numeric(2,1) not null check (score_b in (0, 0.5, 1)),
  before_a     integer      not null,
  before_b     integer      not null,
  after_a      integer      not null,
  after_b      integer      not null,
  points_a     integer      not null default 0 check (points_a >= 0),
  points_b     integer      not null default 0 check (points_b >= 0),
  played_on    date         not null,
  created_at   timestamptz  not null default now(),
  check (player_a is distinct from player_b),
  check (bot = (player_b is null))
);

create index if not exists geo_ranked_matches_a_idx on public.geo_ranked_matches (player_a, created_at desc);
create index if not exists geo_ranked_matches_b_idx on public.geo_ranked_matches (player_b, created_at desc) where player_b is not null;

alter table public.geo_ranked enable row level security;
alter table public.geo_ranked_matches enable row level security;

revoke all on public.geo_ranked from anon, authenticated;
revoke all on public.geo_ranked_matches from anon, authenticated;

-- An Elo as it stands on p_today: every day since p_day decayed (p_day with
-- its games, the days after it with none). The same maths as
-- geoDecayedElo in src/lib/geo-ranked.ts.
create or replace function public.geo_ranked_decayed(p_elo integer, p_day date, p_games_today integer, p_today date)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  e integer := p_elo;
  d date := p_day;
  g integer := coalesce(p_games_today, 0);
begin
  if p_day is null or p_today is null or p_today <= p_day then
    return p_elo;
  end if;
  while d < p_today loop
    -- Below the decay line, or short of a point with no games left to count, nothing more can happen.
    exit when e <= 1400 or (g = 0 and e < 1450);
    if g >= 6 then
      null;
    elsif g > 0 then
      e := e - greatest(0, (e - 1500) / 100);
    else
      e := e - greatest(0, (e - 1400) / 50);
    end if;
    e := greatest(1000, e);
    d := d + 1;
    g := 0;
  end loop;
  return e;
end;
$$;

-- Counts one finished ranked duel (see above). Arrays are [seat 0, seat 1];
-- p_keys[2] is null for the Gym Leader bot, whose Elo is p_expect_elo[2].
-- Returns { status: "applied" | "done", keys, before, after } or
-- { status: "stale", elo, games } (the current values, in p_keys order).
create or replace function public.geo_ranked_apply(
  p_code         text,
  p_today        date,
  p_keys         text[],
  p_names        text[],
  p_expect_elo   integer[],
  p_expect_games integer[],
  p_after        integer[],
  p_scores       numeric[],
  p_points       integer[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  m      public.geo_ranked_matches;
  ra     public.geo_ranked;
  rb     public.geo_ranked;
  bot    boolean := p_keys[2] is null;
  cur_a  integer;
  cur_b  integer;
  games_b integer;
begin
  if array_length(p_keys, 1) <> 2 or p_keys[1] is null or p_keys[1] = p_keys[2] then
    raise exception 'a ranked match needs two different trainers';
  end if;

  -- Counted already: the first call's numbers.
  select * into m from public.geo_ranked_matches where match_code = p_code;
  if found then
    return jsonb_build_object(
      'status', 'done',
      'keys',   jsonb_build_array(m.player_a, m.player_b),
      'before', jsonb_build_array(m.before_a, m.before_b),
      'after',  jsonb_build_array(m.after_a, m.after_b)
    );
  end if;

  -- New trainers start at 1,000. Then lock both rows, always in the same
  -- order, so two duels counted at once can't deadlock.
  insert into public.geo_ranked (player_key, name) values (p_keys[1], p_names[1]) on conflict (player_key) do nothing;
  if not bot then
    insert into public.geo_ranked (player_key, name) values (p_keys[2], p_names[2]) on conflict (player_key) do nothing;
  end if;
  perform 1 from public.geo_ranked where player_key = any (array_remove(p_keys, null)) order by player_key for update;
  select * into ra from public.geo_ranked where player_key = p_keys[1];
  if not bot then
    select * into rb from public.geo_ranked where player_key = p_keys[2];
  end if;

  -- Locking may have waited for another call for this same duel.
  select * into m from public.geo_ranked_matches where match_code = p_code;
  if found then
    return jsonb_build_object(
      'status', 'done',
      'keys',   jsonb_build_array(m.player_a, m.player_b),
      'before', jsonb_build_array(m.before_a, m.before_b),
      'after',  jsonb_build_array(m.after_a, m.after_b)
    );
  end if;

  cur_a := public.geo_ranked_decayed(ra.elo, ra.day, ra.games_today, p_today);
  if bot then
    cur_b := p_expect_elo[2];
    games_b := 0;
  else
    cur_b := public.geo_ranked_decayed(rb.elo, rb.day, rb.games_today, p_today);
    games_b := rb.games;
  end if;

  if cur_a <> p_expect_elo[1] or ra.games <> p_expect_games[1]
     or cur_b <> p_expect_elo[2] or games_b <> p_expect_games[2] then
    return jsonb_build_object(
      'status', 'stale',
      'elo',    jsonb_build_array(cur_a, cur_b),
      'games',  jsonb_build_array(ra.games, games_b)
    );
  end if;

  insert into public.geo_ranked_matches (match_code, player_a, player_b, bot, score_a, score_b, before_a, before_b, after_a, after_b, points_a, points_b, played_on)
  values (p_code, p_keys[1], p_keys[2], bot, p_scores[1], p_scores[2], cur_a, cur_b, p_after[1], case when bot then cur_b else p_after[2] end, p_points[1], p_points[2], p_today);

  update public.geo_ranked set
    name        = p_names[1],
    elo         = p_after[1],
    games       = games + 1,
    wins        = wins + (p_scores[1] = 1)::int,
    draws       = draws + (p_scores[1] = 0.5)::int,
    losses      = losses + (p_scores[1] = 0)::int,
    best_score  = greatest(best_score, p_points[1]),
    games_today = case when day = p_today then games_today + 1 else 1 end,
    day         = p_today,
    decayed_at  = now(),
    updated_at  = now()
  where player_key = p_keys[1];

  if not bot then
    update public.geo_ranked set
      name        = p_names[2],
      elo         = p_after[2],
      games       = games + 1,
      wins        = wins + (p_scores[2] = 1)::int,
      draws       = draws + (p_scores[2] = 0.5)::int,
      losses      = losses + (p_scores[2] = 0)::int,
      best_score  = greatest(best_score, p_points[2]),
      games_today = case when day = p_today then games_today + 1 else 1 end,
      day         = p_today,
      decayed_at  = now(),
      updated_at  = now()
    where player_key = p_keys[2];
  end if;

  return jsonb_build_object(
    'status', 'applied',
    'keys',   jsonb_build_array(p_keys[1], p_keys[2]),
    'before', jsonb_build_array(cur_a, cur_b),
    'after',  jsonb_build_array(p_after[1], case when bot then cur_b else p_after[2] end)
  );
end;
$$;

-- One trainer's standing as of p_today: Elo (decayed), record, best score
-- and place on the ladder (null before their first game). Every field is
-- null for an unknown key. With p_write, the decay is written back first
-- (idempotent: a row already at p_today is left alone).
create or replace function public.geo_ranked_standing(p_key text, p_today date, p_write boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.geo_ranked;
begin
  if p_write then
    update public.geo_ranked set
      elo         = public.geo_ranked_decayed(elo, day, games_today, p_today),
      day         = p_today,
      games_today = 0,
      decayed_at  = now()
    where player_key = p_key and day is not null and day < p_today;
  end if;
  select * into r from public.geo_ranked where player_key = p_key;
  if not found then
    return jsonb_build_object('elo', null);
  end if;
  return jsonb_build_object(
    'elo',        public.geo_ranked_decayed(r.elo, r.day, r.games_today, p_today),
    'games',      r.games,
    'wins',       r.wins,
    'losses',     r.losses,
    'draws',      r.draws,
    'best_score', r.best_score,
    'position',   case when r.games > 0 then
                    (select count(*) + 1 from public.geo_ranked o
                     where o.games > 0 and o.player_key <> r.player_key
                       and public.geo_ranked_decayed(o.elo, o.day, o.games_today, p_today) > public.geo_ranked_decayed(r.elo, r.day, r.games_today, p_today))
                  end,
    'players',    (select count(*) from public.geo_ranked o where o.games > 0)
  );
end;
$$;

-- The top of the ladder as of p_today (at most 100), without keys.
create or replace function public.geo_ranked_top(p_limit integer, p_today date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', t.name, 'elo', t.elo, 'games', t.games, 'wins', t.wins, 'losses', t.losses
  ) order by t.elo desc, t.games desc, t.name), '[]'::jsonb)
  from (
    select name, public.geo_ranked_decayed(elo, day, games_today, p_today) as elo, games, wins, losses
    from public.geo_ranked
    where games > 0
    order by 2 desc, games desc, name
    limit least(greatest(p_limit, 1), 100)
  ) t;
$$;

revoke all on function public.geo_ranked_decayed(integer, date, integer, date) from public, anon, authenticated;
revoke all on function public.geo_ranked_apply(text, date, text[], text[], integer[], integer[], integer[], numeric[], integer[]) from public, anon, authenticated;
revoke all on function public.geo_ranked_standing(text, date, boolean) from public, anon, authenticated;
revoke all on function public.geo_ranked_top(integer, date) from public, anon, authenticated;
grant execute on function public.geo_ranked_decayed(integer, date, integer, date) to service_role;
grant execute on function public.geo_ranked_apply(text, date, text[], text[], integer[], integer[], integer[], numeric[], integer[]) to service_role;
grant execute on function public.geo_ranked_standing(text, date, boolean) to service_role;
grant execute on function public.geo_ranked_top(integer, date) to service_role;
