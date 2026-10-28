-- Elo on the battle ladder, as Pokémon Showdown's ladder computes it
-- (src/lib/rating/elo.ts): the headline rating per trainer per format and
-- the ladder's order, kept alongside the Glicko-2 rating and GXE of 0037,
-- which move on exactly as before. Builds on 0018, 0037 and 0041.
--
-- Everyone starts at 1000 and never drops below it (existing rows start
-- there too). After a battle each trainer's Elo moves by their own K (from
-- their Elo before the battle and the result), computed by the server and
-- written by battle_ranked_apply_elo, which works as 0037's
-- battle_ranked_apply_glicko (left in place, unused, so an older deploy keeps
-- working): one transaction records the battle under its code, checks both
-- trainers' ratings are still the ones the change was computed from, and
-- moves both on.
--
-- Elo above 1400 decays once per UTC day, by how much the trainer played
-- that day (`day`, `games_today`): six or more ranked games, none; one to
-- five, a point per 100 points above 1500; none, a point per 50 points above
-- 1400. A less popular format (anything but the current generation's OU and
-- Random Battle) decays two points less. There's no clock: a row catches up
-- on every finished day since `decayed_at` whenever the ladder is read,
-- listed or settled (battle_ladder_decay), and remembers the day it caught
-- up to, so catching up twice changes nothing.
--
-- Each ranked battle's Elos before and after are kept with the battle
-- (battle_ranked_matches, battle_results), replays keep the Elos the
-- trainers brought (`elos`), and the rating history (0041) gains the Elo.
--
-- As before: RLS on, no policies, no grants; only the service role reads or
-- writes.

alter table public.battle_ratings add column if not exists elo         double precision not null default 1000 check (elo >= 1000);
alter table public.battle_ratings add column if not exists day         date;
alter table public.battle_ratings add column if not exists games_today integer          not null default 0 check (games_today >= 0);
alter table public.battle_ratings add column if not exists decayed_at  date             not null default ((now() at time zone 'utc')::date - 1);

create index if not exists battle_ratings_elo_idx   on public.battle_ratings (format, elo desc, gxe desc, rating desc) where games > 0;
create index if not exists battle_ratings_decay_idx on public.battle_ratings (format, decayed_at);

alter table public.battle_ranked_matches add column if not exists elo_before_a double precision;
alter table public.battle_ranked_matches add column if not exists elo_before_b double precision;
alter table public.battle_ranked_matches add column if not exists elo_after_a  double precision;
alter table public.battle_ranked_matches add column if not exists elo_after_b  double precision;

alter table public.battle_results add column if not exists elo_before integer;
alter table public.battle_results add column if not exists elo_after  integer;

alter table public.battle_replays add column if not exists elos integer[] check (elos is null or array_length(elos, 1) = 2);

alter table public.battle_rating_history add column if not exists elo double precision;

-- Showdown's popular formats, whose Elo decays by the full amount (POPULAR_LADDER_FORMATS in src/lib/battle/ladder.ts).
create or replace function public.battle_popular_format(p_format text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_format in ('gen9ou', 'gen9randombattle');
$$;

-- One row's Elo once every finished UTC day after p_decayed_at (the last day
-- it caught up on) and before p_today has decayed it: p_day and
-- p_games_today are the day of its last ranked game and the games that day.
-- Exactly eloDecayDays in src/lib/rating/elo.ts.
create or replace function public.battle_elo_decay(
  p_elo         double precision,
  p_day         date,
  p_games_today integer,
  p_decayed_at  date,
  p_today       date,
  p_popular     boolean
)
returns double precision
language plpgsql
immutable
set search_path = public
as $$
declare
  v_elo   double precision := p_elo;
  v_day   date;
  v_games integer;
  v_loss  integer;
begin
  if p_decayed_at is null or p_today - 1 <= p_decayed_at then
    return v_elo;
  end if;
  v_day := p_decayed_at + 1;
  while v_day <= p_today - 1 loop
    exit when v_elo <= 1400;
    v_games := case when v_day = p_day then p_games_today else 0 end;
    if v_games >= 6 then
      v_loss := 0;
    elsif v_games > 0 then
      v_loss := floor((v_elo - 1500) / 100);
    else
      v_loss := floor((v_elo - 1400) / 50);
    end if;
    if not p_popular then
      v_loss := v_loss - 2;
    end if;
    if v_loss > 0 then
      v_elo := greatest(1000, v_elo - v_loss);
    elsif v_games = 0 and (p_day is null or v_day >= p_day) then
      -- Nothing lost today with no games, and no later day has games: nothing more will be lost.
      exit;
    end if;
    v_day := v_day + 1;
  end loop;
  return v_elo;
end;
$$;

-- Catches rows up on their decay (one format, one trainer, or everything
-- with null), once per finished UTC day. Rows are locked in key order, as
-- battle_ranked_apply_elo locks them, so the two never deadlock.
create or replace function public.battle_ladder_decay(p_format text, p_key text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  perform 1 from public.battle_ratings r
    where r.decayed_at < v_today - 1
      and (p_format is null or r.format = p_format)
      and (p_key is null or r.player_key = p_key)
    order by r.player_key, r.format
    for update;
  update public.battle_ratings r set
    elo        = public.battle_elo_decay(r.elo, r.day, r.games_today, r.decayed_at, v_today, public.battle_popular_format(r.format)),
    decayed_at = v_today - 1
  where r.decayed_at < v_today - 1
    and (p_format is null or r.format = p_format)
    and (p_key is null or r.player_key = p_key);
end;
$$;

-- Counts one finished ranked battle. Arrays are [seat 0, seat 1].
-- Returns { status: "applied" | "done", keys, before, after, elo_before, elo_after }
-- (Glicko-2 ratings, then Elos; the Elos null for a battle counted before
-- the ladder had Elo) or { status: "stale", rating, rd, vol, elo, games }
-- (the current values, in p_keys order).
create or replace function public.battle_ranked_apply_elo(
  p_code          text,
  p_format        text,
  p_keys          text[],
  p_names         text[],
  p_expect_rating integer[],
  p_expect_rd     double precision[],
  p_expect_elo    double precision[],
  p_expect_games  integer[],
  p_after         integer[],
  p_after_rd      double precision[],
  p_after_vol     double precision[],
  p_after_gxe     double precision[],
  p_after_elo     double precision[],
  p_scores        numeric[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  m       public.battle_ranked_matches;
  ra      public.battle_ratings;
  rb      public.battle_ratings;
  v_today date := (now() at time zone 'utc')::date;
begin
  if array_length(p_keys, 1) <> 2 or p_keys[1] = p_keys[2] then
    raise exception 'a ranked battle needs two different trainers';
  end if;

  select * into m from public.battle_ranked_matches where battle_code = p_code;
  if found then
    return jsonb_build_object(
      'status',     'done',
      'keys',       jsonb_build_array(m.player_a, m.player_b),
      'before',     jsonb_build_array(m.before_a, m.before_b),
      'after',      jsonb_build_array(m.after_a, m.after_b),
      'elo_before', jsonb_build_array(m.elo_before_a, m.elo_before_b),
      'elo_after',  jsonb_build_array(m.elo_after_a, m.elo_after_b)
    );
  end if;

  -- New trainers start at 1000 Elo and 1500 ± 350. Then lock both rows, always in the same order.
  insert into public.battle_ratings (player_key, format, name, rating, rd, vol, gxe, glicko, elo, decayed_at)
    values (p_keys[1], p_format, p_names[1], 1500, 350, 0.06, 50, true, 1000, v_today - 1) on conflict (player_key, format) do nothing;
  insert into public.battle_ratings (player_key, format, name, rating, rd, vol, gxe, glicko, elo, decayed_at)
    values (p_keys[2], p_format, p_names[2], 1500, 350, 0.06, 50, true, 1000, v_today - 1) on conflict (player_key, format) do nothing;
  perform 1 from public.battle_ratings where format = p_format and player_key = any (p_keys) order by player_key for update;

  -- Locking may have waited for another call for this same battle.
  select * into m from public.battle_ranked_matches where battle_code = p_code;
  if found then
    return jsonb_build_object(
      'status',     'done',
      'keys',       jsonb_build_array(m.player_a, m.player_b),
      'before',     jsonb_build_array(m.before_a, m.before_b),
      'after',      jsonb_build_array(m.after_a, m.after_b),
      'elo_before', jsonb_build_array(m.elo_before_a, m.elo_before_b),
      'elo_after',  jsonb_build_array(m.elo_after_a, m.elo_after_b)
    );
  end if;

  -- Both rows catch up on any day of decay they've missed before the battle counts.
  perform public.battle_ladder_decay(p_format, p_keys[1]);
  perform public.battle_ladder_decay(p_format, p_keys[2]);
  select * into ra from public.battle_ratings where player_key = p_keys[1] and format = p_format;
  select * into rb from public.battle_ratings where player_key = p_keys[2] and format = p_format;

  if ra.rating <> p_expect_rating[1] or ra.games <> p_expect_games[1] or abs(ra.rd - p_expect_rd[1]) > 0.001 or abs(ra.elo - p_expect_elo[1]) > 0.000001
     or rb.rating <> p_expect_rating[2] or rb.games <> p_expect_games[2] or abs(rb.rd - p_expect_rd[2]) > 0.001 or abs(rb.elo - p_expect_elo[2]) > 0.000001 then
    return jsonb_build_object(
      'status', 'stale',
      'rating', jsonb_build_array(ra.rating, rb.rating),
      'rd',     jsonb_build_array(ra.rd, rb.rd),
      'vol',    jsonb_build_array(ra.vol, rb.vol),
      'elo',    jsonb_build_array(ra.elo, rb.elo),
      'games',  jsonb_build_array(ra.games, rb.games)
    );
  end if;

  insert into public.battle_ranked_matches (battle_code, format, player_a, player_b, score_a, score_b, before_a, before_b, after_a, after_b, elo_before_a, elo_before_b, elo_after_a, elo_after_b)
  values (p_code, p_format, p_keys[1], p_keys[2], p_scores[1], p_scores[2], ra.rating, rb.rating, p_after[1], p_after[2], ra.elo, rb.elo, p_after_elo[1], p_after_elo[2]);

  update public.battle_ratings set
    name        = p_names[1],
    rating      = p_after[1],
    rd          = p_after_rd[1],
    vol         = p_after_vol[1],
    gxe         = p_after_gxe[1],
    elo         = p_after_elo[1],
    games       = games + 1,
    games_today = case when day = v_today then games_today + 1 else 1 end,
    day         = v_today,
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
    rd          = p_after_rd[2],
    vol         = p_after_vol[2],
    gxe         = p_after_gxe[2],
    elo         = p_after_elo[2],
    games       = games + 1,
    games_today = case when day = v_today then games_today + 1 else 1 end,
    day         = v_today,
    wins        = wins + (p_scores[2] = 1)::int,
    draws       = draws + (p_scores[2] = 0.5)::int,
    losses      = losses + (p_scores[2] = 0)::int,
    streak      = case when p_scores[2] = 1 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when p_scores[2] = 1 then streak + 1 else 0 end),
    updated_at  = now()
  where player_key = p_keys[2] and format = p_format;

  return jsonb_build_object(
    'status',     'applied',
    'keys',       jsonb_build_array(p_keys[1], p_keys[2]),
    'before',     jsonb_build_array(ra.rating, rb.rating),
    'after',      jsonb_build_array(p_after[1], p_after[2]),
    'elo_before', jsonb_build_array(ra.elo, rb.elo),
    'elo_after',  jsonb_build_array(p_after_elo[1], p_after_elo[2])
  );
end;
$$;

-- One trainer's standing in one format, now with Elo; the place on the
-- ladder is by Elo, then GXE, then the Glicko-2 rating (every field null for
-- an unknown key). The format catches up on its decay first.
create or replace function public.battle_ladder_standing(p_key text, p_format text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_out jsonb;
begin
  perform public.battle_ladder_decay(p_format, null);
  select jsonb_build_object(
    'rating',      r.rating,
    'rd',          r.rd,
    'vol',         r.vol,
    'gxe',         r.gxe,
    'elo',         r.elo,
    'games',       r.games,
    'wins',        r.wins,
    'losses',      r.losses,
    'draws',       r.draws,
    'streak',      r.streak,
    'best_streak', r.best_streak,
    'position',    case when r.games > 0 then
                     (select count(*) + 1 from public.battle_ratings o
                      where o.format = p_format and o.games > 0
                        and (o.elo > r.elo or (o.elo = r.elo and (o.gxe > r.gxe or (o.gxe = r.gxe and o.rating > r.rating)))))
                   end,
    'players',     (select count(*) from public.battle_ratings o where o.format = p_format and o.games > 0)
  ) into v_out
  from (select 1) one
  left join public.battle_ratings r on r.player_key = p_key and r.format = p_format;
  return v_out;
end;
$$;

-- One trainer's standing in every format they've played a ranked battle in.
create or replace function public.battle_ladder_standings(p_key text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_agg(public.battle_ladder_standing(p_key, r.format) || jsonb_build_object('format', r.format) order by r.format), '[]'::jsonb) into v_out
  from public.battle_ratings r
  where r.player_key = p_key and r.games > 0;
  return v_out;
end;
$$;

-- The top of one format's ladder by Elo (at most 100), without keys. The
-- format catches up on its decay first.
create or replace function public.battle_ladder_top(p_format text, p_limit integer)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_out jsonb;
begin
  perform public.battle_ladder_decay(p_format, null);
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', t.name, 'rating', t.rating, 'rd', t.rd, 'gxe', t.gxe, 'elo', t.elo, 'games', t.games, 'wins', t.wins, 'losses', t.losses
  ) order by t.elo desc, t.gxe desc, t.rating desc, t.games desc, t.name), '[]'::jsonb) into v_out
  from (
    select name, rating, rd, gxe, elo, games, wins, losses from public.battle_ratings
    where format = p_format and games > 0
    order by elo desc, gxe desc, rating desc, games desc, name
    limit least(greatest(p_limit, 1), 100)
  ) t;
  return v_out;
end;
$$;

-- A trainer's record per format and their latest battles (each with whether
-- its replay was saved), without keys: as in 0018, now with each battle's
-- Elo before and after.
create or replace function public.battle_profile(p_key text, p_limit integer)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'formats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'format', f.format, 'format_name', f.format_name, 'wins', f.wins, 'losses', f.losses, 'draws', f.draws
      ) order by f.wins + f.losses + f.draws desc)
      from (
        select format, max(format_name) as format_name,
               count(*) filter (where result = 'win') as wins,
               count(*) filter (where result = 'loss') as losses,
               count(*) filter (where result = 'draw') as draws
        from public.battle_results where player_key = p_key group by format
      ) f
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'battle_code', r.battle_code, 'format', r.format, 'format_name', r.format_name, 'name', r.name,
        'opponent', r.opponent, 'result', r.result, 'ranked', r.ranked, 'rating_before', r.rating_before,
        'rating_after', r.rating_after, 'elo_before', r.elo_before, 'elo_after', r.elo_after, 'created_at', r.created_at,
        'replay', exists (select 1 from public.battle_replays p where p.id = r.battle_code)
      ) order by r.created_at desc)
      from (
        select * from public.battle_results where player_key = p_key
        order by created_at desc
        limit least(greatest(p_limit, 1), 50)
      ) r
    ), '[]'::jsonb)
  );
$$;

-- The rating history (0041) keeps the Elo after every ranked game too.
create or replace function public.battle_rating_history_log()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.games > 0 and (tg_op = 'INSERT' or new.games <> old.games) then
    insert into public.battle_rating_history (player_key, format, games, rating, rd, gxe, elo)
    values (new.player_key, new.format, new.games, new.rating, new.rd, new.gxe, new.elo);
  end if;
  return new;
end;
$$;

revoke all on function public.battle_popular_format(text) from public, anon, authenticated;
revoke all on function public.battle_elo_decay(double precision, date, integer, date, date, boolean) from public, anon, authenticated;
revoke all on function public.battle_ladder_decay(text, text) from public, anon, authenticated;
revoke all on function public.battle_ranked_apply_elo(text, text, text[], text[], integer[], double precision[], double precision[], integer[], integer[], double precision[], double precision[], double precision[], double precision[], numeric[]) from public, anon, authenticated;
revoke all on function public.battle_ladder_standing(text, text) from public, anon, authenticated;
revoke all on function public.battle_ladder_standings(text) from public, anon, authenticated;
revoke all on function public.battle_ladder_top(text, integer) from public, anon, authenticated;
revoke all on function public.battle_profile(text, integer) from public, anon, authenticated;
grant execute on function public.battle_popular_format(text) to service_role;
grant execute on function public.battle_elo_decay(double precision, date, integer, date, date, boolean) to service_role;
grant execute on function public.battle_ladder_decay(text, text) to service_role;
grant execute on function public.battle_ranked_apply_elo(text, text, text[], text[], integer[], double precision[], double precision[], integer[], integer[], double precision[], double precision[], double precision[], double precision[], numeric[]) to service_role;
grant execute on function public.battle_ladder_standing(text, text) to service_role;
grant execute on function public.battle_ladder_standings(text) to service_role;
grant execute on function public.battle_ladder_top(text, integer) to service_role;
grant execute on function public.battle_profile(text, integer) to service_role;
