import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { matchScores, type RankedLeaderRow, type RankedStanding, type RatingState } from "@/lib/ranked";
import { ELO_START, eloDecayDays, eloUpdate } from "@/lib/rating/elo";
import { GLICKO_START, gxe, rateGlicko, type GlickoState } from "@/lib/battle/glicko";
import { isPopularLadderFormat, ladderReason } from "@/lib/battle/ladder";
import type { StandardFormatId } from "@/lib/battle/play";
import type { BattleRatings } from "@/lib/battle/play";
import { RankedUnavailable } from "../ranked";
import type { BattleMeta } from "./store";

/**
 * The battle ladder's ratings: per trainer (their ladder key, an HMAC) per
 * format, an Elo (lib/rating/elo.ts: Showdown's ladder rating, the headline
 * number and the ladder's order) and a Glicko-2 rating (rating, deviation,
 * volatility; lib/battle/glicko.ts) with GXE as Showdown shows it. A
 * battle's rating changes are computed here and written by one database
 * function that records the battle under its code (a second write for the
 * same battle changes nothing and returns the first), checks both ratings
 * are still the ones they were computed from, and moves both on.
 *
 * Elo above 1400 decays once per UTC day (elo.ts). There's no clock: a row
 * catches up on every day it has missed whenever it's read, listed or
 * settled, and remembers the last day it caught up on (`decayed_at`) with
 * the ranked games it has played today (`day`, `games_today`), so catching
 * up twice changes nothing.
 *
 * Ratings live in Supabase (`battle_ratings`, `battle_ranked_matches`;
 * migrations 0018, 0037 and 0042), or in memory with POKEIQ_LOCAL_ACCOUNTS=1
 * and in development without Supabase. Before the migrations are applied
 * there are no ranked battles: the ranked toggle says ranked opens soon.
 */

/** A trainer's Elo and Glicko-2 state in one format, and how many ranked battles they're from. */
export interface BattleRating extends GlickoState {
  elo: number;
  games: number;
}

/** A trainer's Elo and Glicko-2 state after a battle. */
export type BattleRated = GlickoState & { elo: number };

export const NEW_BATTLE_RATING: BattleRating = { ...GLICKO_START, elo: ELO_START, games: 0 };

export interface BattleApplyInput {
  code: string;
  keys: [string, string];
  names: [string, string];
  /** The ratings the change was computed from. */
  expect: [BattleRating, BattleRating];
  after: [BattleRated, BattleRated];
  scores: [number, number];
}

/** A battle counted (or found already counted): both Glicko-2 ratings before and after, and both Elos (null for a battle counted before the ladder had Elo). */
export interface BattleApplied {
  status: "applied" | "done";
  keys: [string, string];
  before: [number, number];
  after: [number, number];
  elo: { before: [number, number]; after: [number, number] } | null;
}

export type BattleApplyOutcome = BattleApplied | { status: "stale"; current: [BattleRating, BattleRating] };

export interface LadderStore {
  rating(key: string, format: StandardFormatId): Promise<BattleRating | null>;
  standing(key: string, format: StandardFormatId): Promise<RankedStanding | null>;
  /** Every format this trainer has a ranked game in. */
  standings(key: string): Promise<{ format: StandardFormatId; standing: RankedStanding }[]>;
  top(format: StandardFormatId, limit: number): Promise<RankedLeaderRow[]>;
  apply(format: StandardFormatId, input: BattleApplyInput): Promise<BattleApplyOutcome>;
}

/** For matchmaking: the rating a trainer is paired by (Glicko-2, which knows how sure it is), with their Elo for the battle to show. */
export const pairingRating = (r: BattleRating | null): RatingState => {
  const me = r ?? NEW_BATTLE_RATING;
  return { rating: Math.round(me.rating), games: me.games, elo: Math.round(me.elo) };
};

/** Both trainers' new Elo and Glicko-2 states after a battle (scores 1 win, ½ draw, 0 loss). Each Elo moves by its own K. */
export function rateBattle(players: readonly [BattleRating, BattleRating], scores: readonly [number, number]): [BattleRated, BattleRated] {
  const [a, b] = rateGlicko(players, scores);
  return [
    { ...a, elo: eloUpdate(players[0].elo, players[1].elo, scores[0]) },
    { ...b, elo: eloUpdate(players[1].elo, players[0].elo, scores[1]) },
  ];
}

// ---- UTC days -------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** The UTC day a moment falls in, as a count of days. */
export const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

/**
 * A row's Elo once every finished UTC day since `decayedAt` (the last day it
 * caught up on) has decayed it: `day` and `gamesToday` are the day of its
 * last ranked game and how many it played that day. Today isn't over, so
 * it's left for tomorrow. Returns the Elo and the day caught up to.
 */
export function catchUpElo(row: { elo: number; day: number | null; gamesToday: number; decayedAt: number }, popular: boolean, now: number): { elo: number; decayedAt: number } {
  const yesterday = utcDay(now) - 1;
  const days = yesterday - row.decayedAt;
  if (days <= 0) return { elo: row.elo, decayedAt: row.decayedAt };
  const gamesPerDay: number[] = [];
  if (row.day !== null && row.day > row.decayedAt && row.day <= yesterday) gamesPerDay[row.day - row.decayedAt - 1] = row.gamesToday;
  return { elo: eloDecayDays(row.elo, days, gamesPerDay, popular), decayedAt: yesterday };
}

// ---- memory -------------------------------------------------------------------

interface MemoryPlayer extends BattleRating {
  name: string;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestStreak: number;
  /** The UTC day of the last ranked game, and the ranked games that day. */
  day: number | null;
  gamesToday: number;
  /** The last UTC day whose decay has been applied. */
  decayedAt: number;
}

interface MemoryMatch {
  keys: [string, string];
  before: [number, number];
  after: [number, number];
  elo: { before: [number, number]; after: [number, number] } | null;
}

interface MemoryDb {
  players: Map<string, MemoryPlayer>;
  matches: Map<string, MemoryMatch>;
}

const globalStore = globalThis as unknown as { __pokeiqLadder?: MemoryDb };
const slot = (format: string, key: string) => `${format}|${key}`;
const gxeOf = (p: GlickoState) => gxe(p.rating, p.rd);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const same = (a: BattleRating, b: BattleRating) => a.rating === b.rating && a.games === b.games && a.rd === b.rd && close(a.elo, b.elo);
/** The ladder's order: Elo, then GXE, then the Glicko-2 rating. */
const ahead = (a: MemoryPlayer, b: MemoryPlayer) => a.elo > b.elo || (a.elo === b.elo && (gxeOf(a) > gxeOf(b) || (gxeOf(a) === gxeOf(b) && a.rating > b.rating)));

export function memoryLadderStore(): LadderStore {
  const db = (globalStore.__pokeiqLadder ??= { players: new Map(), matches: new Map() });
  const newPlayer = (name: string, now: number): MemoryPlayer => ({ ...NEW_BATTLE_RATING, name, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, day: null, gamesToday: 0, decayedAt: utcDay(now) - 1 });
  /** Catches one row up on its decay (see catchUpElo). */
  const decay = (p: MemoryPlayer, format: string, now: number) => {
    const out = catchUpElo(p, isPopularLadderFormat(format), now);
    p.elo = out.elo;
    p.decayedAt = out.decayedAt;
    return p;
  };
  const ladder = (format: string, now: number) =>
    [...db.players.entries()]
      .filter(([k, p]) => k.startsWith(`${format}|`) && p.games > 0)
      .map(([, p]) => decay(p, format, now))
      .sort((a, b) => b.elo - a.elo || gxeOf(b) - gxeOf(a) || b.rating - a.rating || b.games - a.games || a.name.localeCompare(b.name));
  const standing = (key: string, format: string, now: number): RankedStanding | null => {
    const p = db.players.get(slot(format, key));
    if (!p) return null;
    const all = ladder(format, now);
    decay(p, format, now);
    return {
      rating: p.rating,
      rd: p.rd,
      gxe: gxeOf(p),
      elo: p.elo,
      games: p.games,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      streak: p.streak,
      bestStreak: p.bestStreak,
      position: p.games > 0 ? all.filter((q) => ahead(q, p)).length + 1 : null,
      players: all.length,
    };
  };
  return {
    async rating(key, format) {
      const p = db.players.get(slot(format, key));
      if (!p) return null;
      decay(p, format, Date.now());
      return { rating: p.rating, rd: p.rd, vol: p.vol, elo: p.elo, games: p.games };
    },
    async standing(key, format) {
      return standing(key, format, Date.now());
    },
    async standings(key) {
      const now = Date.now();
      return [...db.players.keys()]
        .filter((k) => k.endsWith(`|${key}`))
        .map((k) => k.split("|")[0] as StandardFormatId)
        .map((format) => ({ format, standing: standing(key, format, now)! }))
        .filter((s) => s.standing.games > 0);
    },
    async top(format, limit) {
      return ladder(format, Date.now())
        .slice(0, limit)
        .map((p, i) => ({ position: i + 1, name: p.name, rating: p.rating, rd: p.rd, gxe: gxeOf(p), elo: p.elo, games: p.games, wins: p.wins, losses: p.losses }));
    },
    async apply(format, input) {
      const done = db.matches.get(input.code);
      if (done) return { status: "done", ...done };
      const now = Date.now();
      const today = utcDay(now);
      const players = input.keys.map((k, i) => decay(db.players.get(slot(format, k)) ?? newPlayer(input.names[i], now), format, now));
      const current = players.map((p) => ({ rating: p.rating, rd: p.rd, vol: p.vol, elo: p.elo, games: p.games })) as [BattleRating, BattleRating];
      if (current.some((c, i) => !same(c, input.expect[i]))) return { status: "stale", current };
      players.forEach((p, i) => {
        const s = input.scores[i];
        p.rating = input.after[i].rating;
        p.rd = input.after[i].rd;
        p.vol = input.after[i].vol;
        p.elo = input.after[i].elo;
        p.games += 1;
        p.gamesToday = p.day === today ? p.gamesToday + 1 : 1;
        p.day = today;
        p.name = input.names[i];
        if (s === 1) p.wins += 1;
        else if (s === 0.5) p.draws += 1;
        else p.losses += 1;
        p.streak = s === 1 ? p.streak + 1 : 0;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        db.players.set(slot(format, input.keys[i]), p);
      });
      const match: MemoryMatch = {
        keys: input.keys,
        before: [current[0].rating, current[1].rating],
        after: [input.after[0].rating, input.after[1].rating],
        elo: { before: [current[0].elo, current[1].elo], after: [input.after[0].elo, input.after[1].elo] },
      };
      db.matches.set(input.code, match);
      return { status: "applied", ...match };
    },
  };
}

export function clearMemoryLadder() {
  globalStore.__pokeiqLadder = undefined;
}

// ---- Supabase -------------------------------------------------------------------

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    if (Date.now() >= missingUntil) console.warn("[ladder] ranked battles are off until migrations 0018_battle_replays_ladder.sql, 0037_battle_glicko2.sql and 0042_battle_elo.sql are applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new RankedUnavailable(error.message);
  }
  throw new Error(error.message);
}

const pair = <T>(v: unknown, map: (x: unknown) => T): [T, T] => {
  const a = v as unknown[];
  return [map(a[0]), map(a[1])];
};

/** A pair of numbers the database may not have (a match counted before Elo). */
const pairOrNull = (v: unknown): [number, number] | null => {
  if (!Array.isArray(v) || v.length !== 2 || v.some((x) => x === null || x === undefined)) return null;
  return [Number(v[0]), Number(v[1])];
};

const toRating = (r: Record<string, unknown>): BattleRating => ({ rating: Number(r.rating), rd: Number(r.rd), vol: Number(r.vol), elo: Number(r.elo), games: Number(r.games) });

function toStanding(r: Record<string, unknown>): RankedStanding {
  return {
    rating: Number(r.rating),
    rd: Number(r.rd),
    gxe: gxe(Number(r.rating), Number(r.rd)),
    elo: Number(r.elo),
    games: Number(r.games),
    wins: Number(r.wins),
    losses: Number(r.losses),
    draws: Number(r.draws),
    streak: Number(r.streak),
    bestStreak: Number(r.best_streak),
    position: r.position === null || r.position === undefined ? null : Number(r.position),
    players: Number(r.players),
  };
}

export function supabaseLadderStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): LadderStore {
  const call = async (fn: string, args: Record<string, unknown>) => {
    if (Date.now() < missingUntil) throw new RankedUnavailable("migrations 0018/0037/0042 not applied");
    const { data, error } = await sb.rpc(fn, args);
    check(error);
    return data as unknown;
  };
  return {
    async rating(key, format) {
      const r = (await call("battle_ladder_standing", { p_key: key, p_format: format })) as Record<string, unknown> | null;
      return r && r.rating !== null && r.rating !== undefined ? toRating(r) : null;
    },
    async standing(key, format) {
      const r = (await call("battle_ladder_standing", { p_key: key, p_format: format })) as Record<string, unknown> | null;
      return r && r.rating !== null && r.rating !== undefined ? toStanding(r) : null;
    },
    async standings(key) {
      const rows = ((await call("battle_ladder_standings", { p_key: key })) ?? []) as Record<string, unknown>[];
      return rows.map((r) => ({ format: String(r.format) as StandardFormatId, standing: toStanding(r) }));
    },
    async top(format, limit) {
      const rows = ((await call("battle_ladder_top", { p_format: format, p_limit: limit })) ?? []) as Record<string, unknown>[];
      return rows.map((r, i) => ({
        position: i + 1,
        name: String(r.name),
        rating: Number(r.rating),
        rd: Number(r.rd),
        gxe: gxe(Number(r.rating), Number(r.rd)),
        elo: Number(r.elo),
        games: Number(r.games),
        wins: Number(r.wins),
        losses: Number(r.losses),
      }));
    },
    async apply(format, input) {
      const r = (await call("battle_ranked_apply_elo", {
        p_code: input.code,
        p_format: format,
        p_keys: input.keys,
        p_names: input.names,
        p_expect_rating: input.expect.map((e) => e.rating),
        p_expect_rd: input.expect.map((e) => e.rd),
        p_expect_elo: input.expect.map((e) => e.elo),
        p_expect_games: input.expect.map((e) => e.games),
        p_after: input.after.map((a) => a.rating),
        p_after_rd: input.after.map((a) => a.rd),
        p_after_vol: input.after.map((a) => a.vol),
        p_after_gxe: input.after.map((a) => gxeOf(a)),
        p_after_elo: input.after.map((a) => a.elo),
        p_scores: input.scores,
      })) as Record<string, unknown>;
      if (r.status === "stale") {
        const ratings = pair(r.rating, Number);
        const rds = pair(r.rd, Number);
        const vols = pair(r.vol, Number);
        const elos = pair(r.elo, Number);
        const games = pair(r.games, Number);
        return {
          status: "stale",
          current: [
            { rating: ratings[0], rd: rds[0], vol: vols[0], elo: elos[0], games: games[0] },
            { rating: ratings[1], rd: rds[1], vol: vols[1], elo: elos[1], games: games[1] },
          ],
        };
      }
      const eloBefore = pairOrNull(r.elo_before);
      const eloAfter = pairOrNull(r.elo_after);
      return {
        status: r.status === "applied" ? "applied" : "done",
        keys: pair(r.keys, String),
        before: pair(r.before, Number),
        after: pair(r.after, Number),
        elo: eloBefore && eloAfter ? { before: eloBefore, after: eloAfter } : null,
      };
    },
  };
}

/** Where ratings live: memory for tests, local E2E and development without Supabase; else Supabase; null in production without it. */
export function ladderStore(): LadderStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryLadderStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseLadderStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryLadderStore() : null;
}

/** The top 100 of a format's ladder; null while the ladder is off. */
export async function ladderTop(format: StandardFormatId, limit = 100): Promise<RankedLeaderRow[] | null> {
  const store = ladderStore();
  if (!store) return null;
  try {
    return await store.top(format, limit);
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[ladder] top failed:", err);
    return null;
  }
}

/**
 * Counts a finished ranked battle, once: each seat's Glicko-2 rating and Elo
 * before and after (null when it doesn't count: no contest, or a seat
 * without a ladder key). Safe to call again and again: later calls return
 * what the first recorded.
 */
export async function settleRankedBattle(meta: BattleMeta, store: LadderStore): Promise<BattleRatings | null> {
  if (!meta.ranked || !meta.end || meta.seats.length !== 2) return null;
  const reason = ladderReason(meta.end);
  const keys = meta.seats.map((s) => s.player);
  if (!reason || !keys[0] || !keys[1] || keys[0] === keys[1]) return null;
  const format = meta.format as StandardFormatId;
  const pairKeys: [string, string] = [keys[0], keys[1]];
  const scores = matchScores(reason, meta.end.winner);
  const fresh = async (key: string) => (await store.rating(key, format)) ?? NEW_BATTLE_RATING;
  let current: [BattleRating, BattleRating] = [await fresh(pairKeys[0]), await fresh(pairKeys[1])];
  for (let attempt = 0; attempt < 5; attempt++) {
    const after = rateBattle(current, scores);
    const out = await store.apply(format, { code: meta.code, keys: pairKeys, names: [meta.seats[0].name, meta.seats[1].name], expect: current, after, scores });
    if (out.status === "stale") {
      current = out.current;
      continue;
    }
    // Stored in the order of the first write's keys: put them back in this battle's seat order.
    const flip = out.keys[0] !== pairKeys[0];
    const seat = <T>(p: [T, T]): [T, T] => (flip ? [p[1], p[0]] : p);
    const before = seat(out.before);
    const done = seat(out.after);
    const elo = out.elo && { before: seat(out.elo.before), after: seat(out.elo.after) };
    // Elo is shown whole, as Showdown shows it.
    return [
      { before: before[0], after: done[0], ...(elo ? { elo: { before: Math.round(elo.before[0]), after: Math.round(elo.after[0]) } } : {}) },
      { before: before[1], after: done[1], ...(elo ? { elo: { before: Math.round(elo.before[1]), after: Math.round(elo.after[1]) } } : {}) },
    ];
  }
  throw new Error("Ratings are busy. Try again.");
}
