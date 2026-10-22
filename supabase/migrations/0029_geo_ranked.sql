-- Ranked PokéGuessr: head-to-head duels on the world map, rated like ranked
-- Pokédle (0014), on a ladder that starts again every month.
--
-- `season` is a calendar month in UTC ("2026-10"): each trainer has one row
-- per season they play in, starting at 1,000. A duel counts in the season it
-- was matched in. `player_key` is an HMAC of the trainer's account id or of a
-- signed anonymous id, never the id itself; `name` is the trainer name they
-- last played a ranked duel under (checked by the server), shown on the ladder.
--
-- The server works out each rating change and writes it with
-- geo_ranked_apply, which in one transaction records the match under the
-- duel's code (a second call for the same duel changes nothing and returns
-- the first call's numbers), locks both trainers' rows for the season and
-- checks their ratings and game counts are still the ones the change was
-- computed from (else nothing is written and the current values come back),
-- then moves both ratings on, with wins, losses, draws and the win streak.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes, through the functions below. The game works without this
-- migration: ranked PokéGuessr stays off and casual duels carry on.

create table if not exists public.geo_ratings (
  season       text        not null check (season ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  name         text        not null check (char_length(name) between 1 and 24),
  rating       integer     not null default 1000 check (rating between 0 and 10000),
  games        integer     not null default 0 check (games >= 0),
  wins         integer     not null default 0 check (wins >= 0),
  losses       integer     not null default 0 check (losses >= 0),
  draws        integer     not null default 0 check (draws >= 0),
  streak       integer     not null default 0 check (streak >= 0),
  best_streak  integer     not null default 0 check (best_streak >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (season, player_key)
);

-- A season's ladder: everyone with a ranked game, best first.
create index if not exists geo_ratings_ladder_idx on public.geo_ratings (season, rating desc, games desc) where games > 0;

create table if not exists public.geo_ranked_matches (
  match_code   text        primary key check (match_code ~ '^[a-z0-9]{4,16}$'),
  season       text        not null,
  player_a     text        not null,
  player_b     text        not null,
  score_a      numeric(2,1) not null check (score_a in (0, 0.5, 1)),
  score_b      numeric(2,1) not null check (score_b in (0, 0.5, 1)),
  before_a     integer     not null,
  before_b     integer     not null,
  after_a      integer     not null,
  after_b      integer     not null,
  created_at   timestamptz not null default now(),
  check (player_a <> player_b),
  foreign key (season, player_a) references public.geo_ratings (season, player_key) on delete cascade,
  foreign key (season, player_b) references public.geo_ratings (season, player_key) on delete cascade
);

create index if not exists geo_ranked_matches_a_idx on public.geo_ranked_matches (season, player_a, created_at desc);
create index if not exists geo_ranked_matches_b_idx on public.geo_ranked_matches (season, player_b, created_at desc);

alter table public.geo_ratings enable row level security;
alter table public.geo_ranked_matches enable row level security;

revoke all on public.geo_ratings from anon, authenticated;
revoke all on public.geo_ranked_matches from anon, authenticated;

-- Counts one finished ranked duel in a season (see above). Arrays are
-- [seat 0, seat 1]. Returns { status: "applied" | "done", keys, before,
-- after } or { status: "stale", rating, games } (current values, in p_keys order).
create or replace function public.geo_ranked_apply(
  p_season        text,
  p_code          text,
  p_keys          text[],
  p_names         text[],
  p_expect_rating integer[],
  p_expect_games  integer[],
  p_after         integer[],
  p_scores        numeric[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  m   public.geo_ranked_matches;
  ra  public.geo_ratings;
  rb  public.geo_ratings;
begin
  if array_length(p_keys, 1) <> 2 or p_keys[1] = p_keys[2] then
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

  -- New trainers start the season at 1,000. Then lock both rows, always in
  -- the same order, so two duels counted at once can't deadlock.
  insert into public.geo_ratings (season, player_key, name) values (p_season, p_keys[1], p_names[1]) on conflict (season, player_key) do nothing;
  insert into public.geo_ratings (season, player_key, name) values (p_season, p_keys[2], p_names[2]) on conflict (season, player_key) do nothing;
  perform 1 from public.geo_ratings where season = p_season and player_key = any (p_keys) order by player_key for update;
  select * into ra from public.geo_ratings where season = p_season and player_key = p_keys[1];
  select * into rb from public.geo_ratings where season = p_season and player_key = p_keys[2];

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

  if ra.rating <> p_expect_rating[1] or ra.games <> p_expect_games[1]
     or rb.rating <> p_expect_rating[2] or rb.games <> p_expect_games[2] then
    return jsonb_build_object(
      'status', 'stale',
      'rating', jsonb_build_array(ra.rating, rb.rating),
      'games',  jsonb_build_array(ra.games, rb.games)
    );
  end if;

  insert into public.geo_ranked_matches (match_code, season, player_a, player_b, score_a, score_b, before_a, before_b, after_a, after_b)
  values (p_code, p_season, p_keys[1], p_keys[2], p_scores[1], p_scores[2], ra.rating, rb.rating, p_after[1], p_after[2]);

  update public.geo_ratings set
    name        = p_names[1],
    rating      = p_after[1],
    games       = games + 1,
    wins        = wins + (p_scores[1] = 1)::int,
    draws       = draws + (p_scores[1] = 0.5)::int,
    losses      = losses + (p_scores[1] = 0)::int,
    streak      = case when p_scores[1] = 1 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when p_scores[1] = 1 then streak + 1 else 0 end),
    updated_at  = now()
  where season = p_season and player_key = p_keys[1];

  update public.geo_ratings set
    name        = p_names[2],
    rating      = p_after[2],
    games       = games + 1,
    wins        = wins + (p_scores[2] = 1)::int,
    draws       = draws + (p_scores[2] = 0.5)::int,
    losses      = losses + (p_scores[2] = 0)::int,
    streak      = case when p_scores[2] = 1 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when p_scores[2] = 1 then streak + 1 else 0 end),
    updated_at  = now()
  where season = p_season and player_key = p_keys[2];

  return jsonb_build_object(
    'status', 'applied',
    'keys',   jsonb_build_array(p_keys[1], p_keys[2]),
    'before', jsonb_build_array(ra.rating, rb.rating),
    'after',  jsonb_build_array(p_after[1], p_after[2])
  );
end;
$$;

-- One trainer's standing in a season: rating, record, streak and place on the
-- ladder (null before their first game). Every field is null for an unknown key.
create or replace function public.geo_ranked_standing(p_season text, p_key text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rating',      r.rating,
    'games',       r.games,
    'wins',        r.wins,
    'losses',      r.losses,
    'draws',       r.draws,
    'streak',      r.streak,
    'best_streak', r.best_streak,
    'position',    case when r.games > 0 then
                     (select count(*) + 1 from public.geo_ratings o where o.season = p_season and o.games > 0 and o.rating > r.rating)
                   end,
    'players',     (select count(*) from public.geo_ratings o where o.season = p_season and o.games > 0)
  )
  from (select 1) one
  left join public.geo_ratings r on r.season = p_season and r.player_key = p_key;
$$;

-- The top of a season's ladder (at most 100), without keys.
create or replace function public.geo_ranked_top(p_season text, p_limit integer)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', t.name, 'rating', t.rating, 'games', t.games, 'wins', t.wins, 'losses', t.losses
  ) order by t.rating desc, t.games desc, t.name), '[]'::jsonb)
  from (
    select name, rating, games, wins, losses from public.geo_ratings
    where season = p_season and games > 0
    order by rating desc, games desc, name
    limit least(greatest(p_limit, 1), 100)
  ) t;
$$;

revoke all on function public.geo_ranked_apply(text, text, text[], text[], integer[], integer[], integer[], numeric[]) from public, anon, authenticated;
revoke all on function public.geo_ranked_standing(text, text) from public, anon, authenticated;
revoke all on function public.geo_ranked_top(text, integer) from public, anon, authenticated;
grant execute on function public.geo_ranked_apply(text, text, text[], text[], integer[], integer[], integer[], numeric[]) to service_role;
grant execute on function public.geo_ranked_standing(text, text) to service_role;
grant execute on function public.geo_ranked_top(text, integer) to service_role;
