-- Battle replays (and, below, the battle ladder).
--
-- A replay is one finished battle's public log: the spectator channel, the
-- very lines Pokémon Showdown shows its spectators. It never holds a
-- player's own channel, a request, the input log or the seed, so it can't
-- reveal a set or a move the battle didn't. `player_keys` are HMACs of the
-- trainers' accounts or signed anonymous ids (never the ids themselves), for
-- "My replays".
--
-- The id is the battle's code: one replay per battle, and saving it again
-- changes nothing. `public` replays (ranked and spectator-open battles) are
-- listed in recent replays; the rest are unlisted, for anyone with the link.
--
-- RLS is on with NO policies and no grants: only the server (service role)
-- reads or writes.

create table if not exists public.battle_replays (
  id           text        primary key check (id ~ '^[a-hjkmnp-z2-9]{8}$'),
  format       text        not null check (char_length(format) between 1 and 60),
  format_name  text        not null check (char_length(format_name) between 1 and 80),
  players      text[]      not null check (array_length(players, 1) = 2),
  -- Ranked: each trainer's rating before the battle.
  ratings      integer[]   check (ratings is null or array_length(ratings, 1) = 2),
  winner       smallint    check (winner in (0, 1)),
  end_reason   text        not null default 'normal' check (end_reason in ('normal', 'forfeit', 'timeout', 'left', 'nocontest')),
  turns        integer     not null default 0 check (turns >= 0),
  ranked       boolean     not null default false,
  public       boolean     not null default false,
  -- The spectator channel, newline-joined (a long battle is ~50 KB; TOAST-compressed).
  log          text        not null check (char_length(log) <= 2000000),
  player_keys  text[]      not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists battle_replays_recent_idx on public.battle_replays (created_at desc) where public;
create index if not exists battle_replays_format_idx on public.battle_replays (format, created_at desc) where public;
create index if not exists battle_replays_players_idx on public.battle_replays using gin (player_keys);

alter table public.battle_replays enable row level security;
revoke all on public.battle_replays from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The battle ladder: one Elo rating per trainer per format, and every ranked
-- battle that has been counted. As in 0014 (ranked Pokédle): `player_key` is
-- an HMAC of the trainer's account id or signed anonymous id; `name` is the
-- name they last played a ranked battle under. The server computes each
-- rating change (a larger K for a trainer's first ten games in the format)
-- and writes it with battle_ranked_apply, which in one transaction:
--   * records the battle under its code: a second call for the same battle
--     changes nothing and returns the first call's numbers;
--   * locks both trainers' rows and checks their ratings and game counts are
--     still the ones the change was computed from; if not, nothing is
--     written and the current values come back to compute again;
--   * moves both ratings on, with wins, losses, draws and the win streak.
-- ---------------------------------------------------------------------------

create table if not exists public.battle_ratings (
  player_key   text        not null check (player_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  format       text        not null check (format ~ '^[a-z0-9]{3,40}$'),
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
  primary key (player_key, format)
);

create index if not exists battle_ratings_ladder_idx on public.battle_ratings (format, rating desc, games desc) where games > 0;

create table if not exists public.battle_ranked_matches (
  battle_code  text         primary key check (battle_code ~ '^[a-hjkmnp-z2-9]{8}$'),
  format       text         not null,
  player_a     text         not null,
  player_b     text         not null,
  score_a      numeric(2,1) not null check (score_a in (0, 0.5, 1)),
  score_b      numeric(2,1) not null check (score_b in (0, 0.5, 1)),
  before_a     integer      not null,
  before_b     integer      not null,
  after_a      integer      not null,
  after_b      integer      not null,
  created_at   timestamptz  not null default now(),
  check (player_a <> player_b),
  foreign key (player_a, format) references public.battle_ratings (player_key, format) on delete cascade,
  foreign key (player_b, format) references public.battle_ratings (player_key, format) on delete cascade
);

create index if not exists battle_ranked_matches_a_idx on public.battle_ranked_matches (player_a, created_at desc);
create index if not exists battle_ranked_matches_b_idx on public.battle_ranked_matches (player_b, created_at desc);

alter table public.battle_ratings enable row level security;
alter table public.battle_ranked_matches enable row level security;
revoke all on public.battle_ratings from anon, authenticated;
revoke all on public.battle_ranked_matches from anon, authenticated;

-- Counts one finished ranked battle (see above). Arrays are [seat 0, seat 1].
-- Returns { status: "applied" | "done", keys, before, after } or
-- { status: "stale", rating, games } (the current values, in p_keys order).
create or replace function public.battle_ranked_apply(
  p_code          text,
  p_format        text,
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
  m   public.battle_ranked_matches;
  ra  public.battle_ratings;
  rb  public.battle_ratings;
begin
  if array_length(p_keys, 1) <> 2 or p_keys[1] = p_keys[2] then
    raise exception 'a ranked battle needs two different trainers';
  end if;

  select * into m from public.battle_ranked_matches where battle_code = p_code;
  if found then
    return jsonb_build_object(
      'status', 'done',
      'keys',   jsonb_build_array(m.player_a, m.player_b),
      'before', jsonb_build_array(m.before_a, m.before_b),
      'after',  jsonb_build_array(m.after_a, m.after_b)
    );
  end if;

  -- New trainers start at 1,000. Then lock both rows, always in the same order.
  insert into public.battle_ratings (player_key, format, name) values (p_keys[1], p_format, p_names[1]) on conflict (player_key, format) do nothing;
  insert into public.battle_ratings (player_key, format, name) values (p_keys[2], p_format, p_names[2]) on conflict (player_key, format) do nothing;
  perform 1 from public.battle_ratings where format = p_format and player_key = any (p_keys) order by player_key for update;
  select * into ra from public.battle_ratings where player_key = p_keys[1] and format = p_format;
  select * into rb from public.battle_ratings where player_key = p_keys[2] and format = p_format;

  -- Locking may have waited for another call for this same battle.
  select * into m from public.battle_ranked_matches where battle_code = p_code;
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

  insert into public.battle_ranked_matches (battle_code, format, player_a, player_b, score_a, score_b, before_a, before_b, after_a, after_b)
  values (p_code, p_format, p_keys[1], p_keys[2], p_scores[1], p_scores[2], ra.rating, rb.rating, p_after[1], p_after[2]);

  update public.battle_ratings set
    name        = p_names[1],
    rating      = p_after[1],
    games       = games + 1,
    wins        = wins + (p_scores[1] = 1)::int,
    draws       = draws + (p_scores[1] = 0.5)::int,
    losses      = losses + (p_scores[1] = 0)::int,
    streak      = case when p_scores[1] = 1 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when p_scores[1] = 1 then streak + 1 else 0 end),
    updated_at  = now()
  where player_key = p_keys[1] and format = p_format;

  update public.battle_ratings set
    name        = p_names[2],
    rating      = p_after[2],
    games       = games + 1,
    wins        = wins + (p_scores[2] = 1)::int,
    draws       = draws + (p_scores[2] = 0.5)::int,
    losses      = losses + (p_scores[2] = 0)::int,
    streak      = case when p_scores[2] = 1 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when p_scores[2] = 1 then streak + 1 else 0 end),
    updated_at  = now()
  where player_key = p_keys[2] and format = p_format;

  return jsonb_build_object(
    'status', 'applied',
    'keys',   jsonb_build_array(p_keys[1], p_keys[2]),
    'before', jsonb_build_array(ra.rating, rb.rating),
    'after',  jsonb_build_array(p_after[1], p_after[2])
  );
end;
$$;

-- One trainer's standing in one format (every field null for an unknown key).
create or replace function public.battle_ladder_standing(p_key text, p_format text)
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
                     (select count(*) + 1 from public.battle_ratings o where o.format = p_format and o.games > 0 and o.rating > r.rating)
                   end,
    'players',     (select count(*) from public.battle_ratings o where o.format = p_format and o.games > 0)
  )
  from (select 1) one
  left join public.battle_ratings r on r.player_key = p_key and r.format = p_format;
$$;

-- One trainer's standing in every format they've played a ranked battle in.
create or replace function public.battle_ladder_standings(p_key text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(public.battle_ladder_standing(p_key, r.format) || jsonb_build_object('format', r.format) order by r.format), '[]'::jsonb)
  from public.battle_ratings r
  where r.player_key = p_key and r.games > 0;
$$;

-- The top of one format's ladder (at most 100), without keys.
create or replace function public.battle_ladder_top(p_format text, p_limit integer)
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
    select name, rating, games, wins, losses from public.battle_ratings
    where format = p_format and games > 0
    order by rating desc, games desc, name
    limit least(greatest(p_limit, 1), 100)
  ) t;
$$;

revoke all on function public.battle_ranked_apply(text, text, text[], text[], integer[], integer[], integer[], numeric[]) from public, anon, authenticated;
revoke all on function public.battle_ladder_standing(text, text) from public, anon, authenticated;
revoke all on function public.battle_ladder_standings(text) from public, anon, authenticated;
revoke all on function public.battle_ladder_top(text, integer) from public, anon, authenticated;
grant execute on function public.battle_ranked_apply(text, text, text[], text[], integer[], integer[], integer[], numeric[]) to service_role;
grant execute on function public.battle_ladder_standing(text, text) to service_role;
grant execute on function public.battle_ladder_standings(text) to service_role;
grant execute on function public.battle_ladder_top(text, integer) to service_role;
