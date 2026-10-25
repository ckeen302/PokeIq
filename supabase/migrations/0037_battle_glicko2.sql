-- The battle ladder moves from Elo to Glicko-2 (src/lib/battle/glicko.ts),
-- with GXE as Pokémon Showdown shows it. Builds on 0018.
--
-- Each trainer's rating per format gains a rating deviation (`rd`: how sure
-- the ladder is of the rating), a volatility (`vol`) and their GXE (`gxe`:
-- the chance, in percent, of beating a random ladder trainer, computed by
-- the server from rating and RD and stored so the ladder can be ordered by
-- it). New trainers start at 1500 ± 350.
--
-- Existing Elo ratings (centred on 1000) are moved onto the Glicko scale
-- (centred on 1500) by adding 500, keeping everyone's order, with an RD that
-- starts at 350 and shrinks 20 per ranked game already played, never below
-- 100: the ladder isn't yet sure of a converted rating, so the next few
-- battles move it quickly.
--
-- battle_ranked_apply_glicko replaces battle_ranked_apply for new battles
-- (the old function is left in place, unused, so an older deploy keeps
-- working until this one is live). It works the same way: one transaction
-- records the battle under its code (exactly once), checks both trainers'
-- rating, RD and game count are still the ones the change was computed
-- from, and moves both on.
--
-- As before: RLS on, no policies, no grants; only the service role reads or
-- writes.

alter table public.battle_ratings alter column rating set default 1500;
alter table public.battle_ratings add column if not exists rd  double precision not null default 350  check (rd > 0 and rd <= 500);
alter table public.battle_ratings add column if not exists vol double precision not null default 0.06 check (vol > 0 and vol < 1);
alter table public.battle_ratings add column if not exists gxe double precision not null default 50   check (gxe >= 0 and gxe <= 100);
alter table public.battle_ratings add column if not exists glicko boolean not null default false;

-- Showdown's GXE formula (as in glicko.ts).
create or replace function public.battle_gxe(p_rating double precision, p_rd double precision)
returns double precision
language sql
immutable
set search_path = public
as $$
  select round((100.0 / (1 + power(10::double precision,
    ((1500 - p_rating) * pi()) / sqrt(3 * ln(10) ^ 2 * p_rd ^ 2 + 2500 * (64 * pi() ^ 2 + 147 * ln(10) ^ 2))
  )))::numeric, 2)::double precision;
$$;

-- Convert the Elo ratings once (rows already converted are marked `glicko`).
update public.battle_ratings set
  rating = least(10000, rating + 500),
  rd     = least(350, greatest(100, 350 - 20 * games)),
  vol    = 0.06,
  glicko = true
where not glicko;
update public.battle_ratings set gxe = public.battle_gxe(rating, rd);
alter table public.battle_ratings alter column glicko set default true;

create index if not exists battle_ratings_gxe_idx on public.battle_ratings (format, gxe desc, rating desc, games desc) where games > 0;

-- Counts one finished ranked battle. Arrays are [seat 0, seat 1].
-- Returns { status: "applied" | "done", keys, before, after } or
-- { status: "stale", rating, rd, vol, games } (the current values, in p_keys order).
create or replace function public.battle_ranked_apply_glicko(
  p_code          text,
  p_format        text,
  p_keys          text[],
  p_names         text[],
  p_expect_rating integer[],
  p_expect_rd     double precision[],
  p_expect_games  integer[],
  p_after         integer[],
  p_after_rd      double precision[],
  p_after_vol     double precision[],
  p_after_gxe     double precision[],
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

  -- New trainers start at 1500 ± 350. Then lock both rows, always in the same order.
  insert into public.battle_ratings (player_key, format, name, rating, rd, vol, gxe, glicko)
    values (p_keys[1], p_format, p_names[1], 1500, 350, 0.06, 50, true) on conflict (player_key, format) do nothing;
  insert into public.battle_ratings (player_key, format, name, rating, rd, vol, gxe, glicko)
    values (p_keys[2], p_format, p_names[2], 1500, 350, 0.06, 50, true) on conflict (player_key, format) do nothing;
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

  if ra.rating <> p_expect_rating[1] or ra.games <> p_expect_games[1] or abs(ra.rd - p_expect_rd[1]) > 0.001
     or rb.rating <> p_expect_rating[2] or rb.games <> p_expect_games[2] or abs(rb.rd - p_expect_rd[2]) > 0.001 then
    return jsonb_build_object(
      'status', 'stale',
      'rating', jsonb_build_array(ra.rating, rb.rating),
      'rd',     jsonb_build_array(ra.rd, rb.rd),
      'vol',    jsonb_build_array(ra.vol, rb.vol),
      'games',  jsonb_build_array(ra.games, rb.games)
    );
  end if;

  insert into public.battle_ranked_matches (battle_code, format, player_a, player_b, score_a, score_b, before_a, before_b, after_a, after_b)
  values (p_code, p_format, p_keys[1], p_keys[2], p_scores[1], p_scores[2], ra.rating, rb.rating, p_after[1], p_after[2]);

  update public.battle_ratings set
    name        = p_names[1],
    rating      = p_after[1],
    rd          = p_after_rd[1],
    vol         = p_after_vol[1],
    gxe         = p_after_gxe[1],
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
    rd          = p_after_rd[2],
    vol         = p_after_vol[2],
    gxe         = p_after_gxe[2],
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

-- One trainer's standing in one format, now with RD and volatility; the
-- place on the ladder is by GXE (every field null for an unknown key).
create or replace function public.battle_ladder_standing(p_key text, p_format text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rating',      r.rating,
    'rd',          r.rd,
    'vol',         r.vol,
    'gxe',         r.gxe,
    'games',       r.games,
    'wins',        r.wins,
    'losses',      r.losses,
    'draws',       r.draws,
    'streak',      r.streak,
    'best_streak', r.best_streak,
    'position',    case when r.games > 0 then
                     (select count(*) + 1 from public.battle_ratings o where o.format = p_format and o.games > 0 and o.gxe > r.gxe)
                   end,
    'players',     (select count(*) from public.battle_ratings o where o.format = p_format and o.games > 0)
  )
  from (select 1) one
  left join public.battle_ratings r on r.player_key = p_key and r.format = p_format;
$$;

-- The top of one format's ladder by GXE (at most 100), without keys.
create or replace function public.battle_ladder_top(p_format text, p_limit integer)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', t.name, 'rating', t.rating, 'rd', t.rd, 'gxe', t.gxe, 'games', t.games, 'wins', t.wins, 'losses', t.losses
  ) order by t.gxe desc, t.rating desc, t.games desc, t.name), '[]'::jsonb)
  from (
    select name, rating, rd, gxe, games, wins, losses from public.battle_ratings
    where format = p_format and games > 0
    order by gxe desc, rating desc, games desc, name
    limit least(greatest(p_limit, 1), 100)
  ) t;
$$;

revoke all on function public.battle_gxe(double precision, double precision) from public, anon, authenticated;
revoke all on function public.battle_ranked_apply_glicko(text, text, text[], text[], integer[], double precision[], integer[], integer[], double precision[], double precision[], double precision[], numeric[]) from public, anon, authenticated;
revoke all on function public.battle_ladder_standing(text, text) from public, anon, authenticated;
revoke all on function public.battle_ladder_top(text, integer) from public, anon, authenticated;
grant execute on function public.battle_gxe(double precision, double precision) to service_role;
grant execute on function public.battle_ranked_apply_glicko(text, text, text[], text[], integer[], double precision[], integer[], integer[], double precision[], double precision[], double precision[], numeric[]) to service_role;
grant execute on function public.battle_ladder_standing(text, text) to service_role;
grant execute on function public.battle_ladder_top(text, integer) to service_role;
