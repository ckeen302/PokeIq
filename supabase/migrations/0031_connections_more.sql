-- PokéConnections, more: a ranked duel ladder with monthly seasons, and party
-- mode (2 to 8 players racing one puzzle).
--
-- Ranked: the Pokédle ladder's rules (0014) kept apart, with one rating per
-- trainer per season ("2026-10"). `player_key` is an HMAC of the trainer's
-- account id or signed anonymous id, never the id itself. The server works
-- out each rating change (lib/ranked.ts) and writes it with
-- connections_ranked_apply, which in one transaction records the match under
-- the duel's code (a second call for the same duel changes nothing),
-- checks both ratings are still the ones the change was computed from (else
-- it asks for a fresh computation), and moves both ratings on.
--
-- Party: one row per party while it's played. `state` holds the whole party
-- (players, guesses, the seed behind the puzzle), so RLS is on with NO
-- policies: only the server (service role) reads or writes it, by
-- compare-and-swap on `version`.
--
-- RLS is on everywhere with no policies and no grants: server only.

create table if not exists public.connections_ratings (
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

create index if not exists connections_ratings_ladder_idx on public.connections_ratings (season, rating desc, games desc) where games > 0;

create table if not exists public.connections_ranked_matches (
  match_code   text        primary key check (match_code ~ '^[a-z0-9]{4,16}$'),
  season       text        not null check (season ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  player_a     text        not null,
  player_b     text        not null,
  score_a      numeric(2,1) not null check (score_a in (0, 0.5, 1)),
  score_b      numeric(2,1) not null check (score_b in (0, 0.5, 1)),
  before_a     integer     not null,
  before_b     integer     not null,
  after_a      integer     not null,
  after_b      integer     not null,
  created_at   timestamptz not null default now(),
  check (player_a <> player_b)
);

create table if not exists public.connections_parties (
  code        text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  version     integer not null default 0 check (version >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists connections_parties_expires_idx on public.connections_parties (expires_at);

alter table public.connections_ratings enable row level security;
alter table public.connections_ranked_matches enable row level security;
alter table public.connections_parties enable row level security;

revoke all on public.connections_ratings from anon, authenticated;
revoke all on public.connections_ranked_matches from anon, authenticated;
revoke all on public.connections_parties from anon, authenticated;

-- Counts one finished ranked duel (see above). Arrays are [seat 0, seat 1].
-- Returns { status: "applied" | "done", keys, before, after } or
-- { status: "stale", rating, games } (the current values, in p_keys order).
create or replace function public.connections_ranked_apply(
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
  m   public.connections_ranked_matches;
  ra  public.connections_ratings;
  rb  public.connections_ratings;
begin
  if array_length(p_keys, 1) <> 2 or p_keys[1] = p_keys[2] then
    raise exception 'a ranked match needs two different trainers';
  end if;

  select * into m from public.connections_ranked_matches where match_code = p_code;
  if found then
    return jsonb_build_object(
      'status', 'done',
      'keys',   jsonb_build_array(m.player_a, m.player_b),
      'before', jsonb_build_array(m.before_a, m.before_b),
      'after',  jsonb_build_array(m.after_a, m.after_b)
    );
  end if;

  -- New trainers start the season at 1,000; lock both rows in a fixed order.
  insert into public.connections_ratings (season, player_key, name) values (p_season, p_keys[1], p_names[1]) on conflict do nothing;
  insert into public.connections_ratings (season, player_key, name) values (p_season, p_keys[2], p_names[2]) on conflict do nothing;
  perform 1 from public.connections_ratings where season = p_season and player_key = any (p_keys) order by player_key for update;
  select * into ra from public.connections_ratings where season = p_season and player_key = p_keys[1];
  select * into rb from public.connections_ratings where season = p_season and player_key = p_keys[2];

  select * into m from public.connections_ranked_matches where match_code = p_code;
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

  insert into public.connections_ranked_matches (match_code, season, player_a, player_b, score_a, score_b, before_a, before_b, after_a, after_b)
  values (p_code, p_season, p_keys[1], p_keys[2], p_scores[1], p_scores[2], ra.rating, rb.rating, p_after[1], p_after[2]);

  update public.connections_ratings set
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

  update public.connections_ratings set
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

-- One trainer's standing this season: rating, record, streak and place on the
-- ladder (null before their first game). Every field is null for an unknown key.
create or replace function public.connections_ranked_standing(p_season text, p_key text)
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
                     (select count(*) + 1 from public.connections_ratings o where o.season = p_season and o.games > 0 and o.rating > r.rating)
                   end,
    'players',     (select count(*) from public.connections_ratings o where o.season = p_season and o.games > 0)
  )
  from (select 1) one
  left join public.connections_ratings r on r.season = p_season and r.player_key = p_key;
$$;

-- The top of a season's ladder (at most 100), without keys.
create or replace function public.connections_ranked_top(p_season text, p_limit integer)
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
    select name, rating, games, wins, losses from public.connections_ratings
    where season = p_season and games > 0
    order by rating desc, games desc, name
    limit least(greatest(p_limit, 1), 100)
  ) t;
$$;

revoke all on function public.connections_ranked_apply(text, text, text[], text[], integer[], integer[], integer[], numeric[]) from public, anon, authenticated;
revoke all on function public.connections_ranked_standing(text, text) from public, anon, authenticated;
revoke all on function public.connections_ranked_top(text, integer) from public, anon, authenticated;
grant execute on function public.connections_ranked_apply(text, text, text[], text[], integer[], integer[], integer[], numeric[]) to service_role;
grant execute on function public.connections_ranked_standing(text, text) to service_role;
grant execute on function public.connections_ranked_top(text, integer) to service_role;
