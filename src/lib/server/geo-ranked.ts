import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import {
  GEO_ELO_START,
  GEO_RANKED_BOT_AFTER_S_DEFAULT,
  GEO_RANKED_BOT_K_SCALE,
  GEO_RANKED_SHOCK_DIFF_DEFAULT,
  geoDecayedElo,
  geoDivisionOf,
  geoMatchScores,
  geoRateDuel,
  type GeoRankedLeaderRow,
  type GeoRankedStanding,
  type GeoRatingRules,
} from "@/lib/geo-ranked";
import { deriveSeed } from "./crypto";
import { RankedUnavailable } from "./ranked";

/**
 * Ranked PokéGuessr on the server: one Elo per trainer (lib/geo-ranked.ts
 * has the rules), changed once per finished ranked duel.
 *
 * A trainer is who ranked Pokédle says they are (ranked.ts: their account,
 * or the signed anonymous id their browser holds), hashed again under this
 * ladder's own purpose so the two never share a key.
 *
 * Decay is lazy: a rating is read as it stands today (every day since its
 * last game decayed), a standing read writes that back, and counting a
 * duel starts from the decayed value. Counting is one database function
 * that, in one transaction, records the duel under its code (a second write
 * changes nothing and returns the first), checks both ratings are still the
 * ones the change was computed from, and moves them on; so every duel
 * counts exactly once whatever polls race. The Gym Leader bot has no row:
 * a bot duel records the bot's Elo on the match and moves the trainer only.
 *
 * Ratings live in Supabase (`geo_ranked`, `geo_ranked_matches`; migration
 * 0043), or in memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E
 * run) and in development without Supabase. Before the migration is applied
 * there is no ranked PokéGuessr: callers get null and casual duels carry on.
 */

/** The key a trainer's PokéGuessr rating is stored under: an HMAC of their ranked identity. */
export const geoRankedKey = (identity: string) => deriveSeed("geo-ranked", identity);

// ---------------------------------------------------------------------------
// Configuration (environment)
// ---------------------------------------------------------------------------

const envNumber = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export interface GeoRankedConfig extends GeoRatingRules {
  /** The widest Elo gap matchmaking ever allows (0: unlimited). */
  maxDiff: number;
  /** Seconds in the queue before the Gym Leader is offered (0: never). */
  botAfterS: number;
}

/** The ladder's tunables, read from the environment on each call (cheap, and tests can change them). */
export function geoRankedConfig(): GeoRankedConfig {
  return {
    shockDiff: envNumber("POKEIQ_GEO_RANKED_SHOCK_DIFF", GEO_RANKED_SHOCK_DIFF_DEFAULT),
    maxDiff: envNumber("POKEIQ_GEO_RANKED_MAX_DIFF", 0),
    botAfterS: envNumber("POKEIQ_GEO_RANKED_BOT_AFTER_S", GEO_RANKED_BOT_AFTER_S_DEFAULT),
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** A rating as it stands on a day: the Elo (decayed to that day) and the ranked games before it. */
export interface GeoRatingState {
  elo: number;
  games: number;
}

export interface GeoApplyInput {
  code: string;
  /** The UTC day the duel ended on. */
  today: string;
  /** Seat 1 is null for the Gym Leader bot. */
  keys: [string, string | null];
  names: [string, string];
  /** The ratings the change was computed from (the bot's: its fixed Elo, no games). */
  expect: [GeoRatingState, GeoRatingState];
  after: [number, number];
  scores: [number, number];
  /** Each seat's points over the duel's rounds (for best score). */
  points: [number, number];
}

export type GeoApplyOutcome =
  /** Recorded now, or already recorded for this duel: the match as it was counted. */
  | { status: "applied" | "done"; keys: [string, string | null]; before: [number, number]; after: [number, number] }
  /** A rating moved since it was read: compute again from these. */
  | { status: "stale"; current: [GeoRatingState, GeoRatingState] };

export interface GeoRankedStore {
  /** The trainer's rating as of `today`, or null before a first game. Reads only. */
  rating(key: string, today: string): Promise<GeoRatingState | null>;
  /** Their standing as of `today` (writes the decay back). Null for an unknown trainer. */
  standing(key: string, today: string): Promise<GeoRankedStanding | null>;
  /** The top of the ladder as of `today`, hidden Elos blanked. */
  top(limit: number, today: string): Promise<GeoRankedLeaderRow[]>;
  apply(input: GeoApplyInput): Promise<GeoApplyOutcome>;
}

const LADDER_MAX = 100;

/** The ladder row the client sees: the Elo only where the division shows it. */
function leaderRow(position: number, p: { name: string; elo: number; games: number; wins: number; losses: number }): GeoRankedLeaderRow {
  const division = geoDivisionOf(p.elo);
  return { position, name: p.name, elo: division.showElo ? p.elo : null, division: division.id, games: p.games, wins: p.wins, losses: p.losses };
}

// ---- memory -------------------------------------------------------------------

interface MemoryPlayer {
  name: string;
  elo: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  bestScore: number;
  day: string | null;
  gamesToday: number;
}

interface MemoryDb {
  players: Map<string, MemoryPlayer>;
  matches: Map<string, { keys: [string, string | null]; before: [number, number]; after: [number, number] }>;
}

const globalStore = globalThis as unknown as { __pokeiqGeoRanked?: MemoryDb };

const blankPlayer = (name: string): MemoryPlayer => ({ name, elo: GEO_ELO_START, games: 0, wins: 0, losses: 0, draws: 0, bestScore: 0, day: null, gamesToday: 0 });

/** Brings a player's row to `today`: the decay since their last game applied, that day closed. */
function catchUp(p: MemoryPlayer, today: string): MemoryPlayer {
  if (!p.day || p.day >= today) return p;
  return { ...p, elo: geoDecayedElo(p, today), day: today, gamesToday: 0 };
}

export function memoryGeoRankedStore(): GeoRankedStore {
  const db = (globalStore.__pokeiqGeoRanked ??= { players: new Map(), matches: new Map() });
  const ladder = (today: string) =>
    [...db.players.values()]
      .filter((p) => p.games > 0)
      .map((p) => catchUp(p, today))
      .sort((a, b) => b.elo - a.elo || b.games - a.games || a.name.localeCompare(b.name));
  const current = (key: string, name: string, today: string): MemoryPlayer => catchUp(db.players.get(key) ?? blankPlayer(name), today);
  return {
    async rating(key, today) {
      const p = db.players.get(key);
      if (!p) return null;
      const c = catchUp(p, today);
      return { elo: c.elo, games: c.games };
    },
    async standing(key, today) {
      const p = db.players.get(key);
      if (!p) return null;
      const c = catchUp(p, today);
      db.players.set(key, c);
      const all = ladder(today);
      return {
        elo: c.elo,
        games: c.games,
        wins: c.wins,
        losses: c.losses,
        draws: c.draws,
        bestScore: c.bestScore,
        position: c.games > 0 ? all.filter((q) => q.elo > c.elo).length + 1 : null,
        players: all.length,
      };
    },
    async top(limit, today) {
      return ladder(today)
        .slice(0, Math.min(limit, LADDER_MAX))
        .map((p, i) => leaderRow(i + 1, p));
    },
    async apply(input) {
      const done = db.matches.get(input.code);
      if (done) return { status: "done", ...done };
      const bot = input.keys[1] === null;
      const players = input.keys.map((k, i) => (k === null ? null : current(k, input.names[i], input.today)));
      const now = players.map((p, i) => (p ? { elo: p.elo, games: p.games } : { elo: input.expect[i].elo, games: 0 })) as [GeoRatingState, GeoRatingState];
      if (now.some((c, i) => c.elo !== input.expect[i].elo || c.games !== input.expect[i].games)) return { status: "stale", current: now };
      players.forEach((p, i) => {
        if (!p) return;
        const s = input.scores[i];
        p.elo = input.after[i];
        p.games += 1;
        p.name = input.names[i];
        if (s === 1) p.wins += 1;
        else if (s === 0.5) p.draws += 1;
        else p.losses += 1;
        p.bestScore = Math.max(p.bestScore, input.points[i]);
        p.gamesToday = p.day === input.today ? p.gamesToday + 1 : 1;
        p.day = input.today;
        db.players.set(input.keys[i]!, p);
      });
      const match = { keys: input.keys, before: [now[0].elo, now[1].elo] as [number, number], after: bot ? ([input.after[0], now[1].elo] as [number, number]) : input.after };
      db.matches.set(input.code, match);
      return { status: "applied", ...match };
    },
  };
}

/** Forgets every rating in memory (tests). */
export function clearMemoryGeoRanked() {
  globalStore.__pokeiqGeoRanked = undefined;
}

// ---- Supabase -------------------------------------------------------------------

/** The tables or functions aren't there (the migration hasn't been applied). */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
/** After finding them missing, look again this much later (so applying the migration needs no redeploy). */
const RECHECK_MS = 60_000;
let missingUntil = 0;

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    if (Date.now() >= missingUntil) console.warn("[geo-ranked] ranked PokéGuessr is off until migration 0043_geo_ranked.sql is applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new RankedUnavailable(error.message);
  }
  throw new Error(error.message);
}

const pair = <T>(v: unknown, map: (x: unknown) => T): [T, T] => {
  const a = v as unknown[];
  return [map(a[0]), map(a[1])];
};
const num = (x: unknown) => Number(x);

export function supabaseGeoRankedStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): GeoRankedStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    if (Date.now() < missingUntil) throw new RankedUnavailable("migration 0043 not applied");
    const { data, error } = await sb.rpc(`geo_ranked_${name}`, args);
    check(error);
    return data as unknown;
  };
  const standingOf = async (key: string, today: string, write: boolean) => {
    const r = (await call("standing", { p_key: key, p_today: today, p_write: write })) as Record<string, unknown> | null;
    return r && r.elo !== null && r.elo !== undefined ? r : null;
  };
  return {
    async rating(key, today) {
      const r = await standingOf(key, today, false);
      return r ? { elo: num(r.elo), games: num(r.games) } : null;
    },
    async standing(key, today) {
      const r = await standingOf(key, today, true);
      if (!r) return null;
      return {
        elo: num(r.elo),
        games: num(r.games),
        wins: num(r.wins),
        losses: num(r.losses),
        draws: num(r.draws),
        bestScore: num(r.best_score),
        position: r.position === null || r.position === undefined ? null : num(r.position),
        players: num(r.players),
      };
    },
    async top(limit, today) {
      const rows = ((await call("top", { p_limit: Math.min(limit, LADDER_MAX), p_today: today })) ?? []) as Record<string, unknown>[];
      return rows.map((r, i) => leaderRow(i + 1, { name: String(r.name), elo: num(r.elo), games: num(r.games), wins: num(r.wins), losses: num(r.losses) }));
    },
    async apply(input) {
      const r = (await call("apply", {
        p_code: input.code,
        p_today: input.today,
        p_keys: input.keys,
        p_names: input.names,
        p_expect_elo: input.expect.map((e) => e.elo),
        p_expect_games: input.expect.map((e) => e.games),
        p_after: input.after,
        p_scores: input.scores,
        p_points: input.points,
      })) as Record<string, unknown>;
      if (r.status === "stale") {
        const elos = pair(r.elo, num);
        const games = pair(r.games, num);
        return { status: "stale", current: [{ elo: elos[0], games: games[0] }, { elo: elos[1], games: games[1] }] };
      }
      const [a, b] = pair(r.keys, (k) => (k === null || k === undefined ? null : String(k)));
      return { status: r.status === "applied" ? "applied" : "done", keys: [String(a), b], before: pair(r.before, num), after: pair(r.after, num) };
    },
  };
}

/** Where ratings live: memory for tests, local E2E and development without Supabase; else Supabase; null in production without it. */
export function geoRankedStore(): GeoRankedStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryGeoRankedStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseGeoRankedStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryGeoRankedStore() : null;
}

/** The top of the ladder (at most 100), or null while ranked PokéGuessr is off. */
export async function geoRankedTop(today: string, limit = LADDER_MAX): Promise<GeoRankedLeaderRow[] | null> {
  const store = geoRankedStore();
  if (!store) return null;
  try {
    return await store.top(limit, today);
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[geo-ranked] ladder failed:", err);
    return null;
  }
}

/** A trainer's standing, or null while ranked PokéGuessr is off (or before their first game). */
export async function geoRankedStandingOf(key: string, today: string): Promise<GeoRankedStanding | null> {
  const store = geoRankedStore();
  if (!store) return null;
  try {
    return await store.standing(key, today);
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[geo-ranked] standing failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Settling a duel
// ---------------------------------------------------------------------------

/** What a finished ranked duel needs to be counted. */
export interface GeoRankedMatch {
  code: string;
  /** Seat 1 is null for the Gym Leader bot. */
  keys: [string, string | null];
  names: [string, string];
  /** The winner's seat, or null for a draw. */
  winner: number | null;
  /** When the duel ended (the day it counts on). */
  at: number;
  /** Each seat's points over the rounds. */
  points: [number, number];
  /** The bot's Elo (the trainer's division floor) when seat 1 is the bot. */
  botElo?: number;
}

const MAX_TRIES = 5;

/**
 * Counts a finished ranked duel, once: each seat's Elo before and after (by
 * seat). Safe to call again and again for the same duel: later calls return
 * what the first one recorded.
 */
export async function settleGeoRanked(match: GeoRankedMatch, store: GeoRankedStore, config: GeoRatingRules = geoRankedConfig()): Promise<{ before: [number, number]; after: [number, number] }> {
  const scores = geoMatchScores(match.winner);
  const today = new Date(match.at).toISOString().slice(0, 10);
  const bot = match.keys[1] === null;
  const fresh = async (key: string): Promise<GeoRatingState> => (await store.rating(key, today)) ?? { elo: GEO_ELO_START, games: 0 };
  let current: [GeoRatingState, GeoRatingState] = [await fresh(match.keys[0]), bot ? { elo: match.botElo ?? GEO_ELO_START, games: 0 } : await fresh(match.keys[1]!)];
  const rules: GeoRatingRules = bot ? { shockDiff: config.shockDiff, kScale: GEO_RANKED_BOT_K_SCALE } : { shockDiff: config.shockDiff };
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const [a, b] = geoRateDuel([current[0].elo, current[1].elo], scores, rules);
    // The bot's Elo never moves.
    const after: [number, number] = [a.after, bot ? current[1].elo : b.after];
    const out = await store.apply({ code: match.code, today, keys: match.keys, names: match.names, expect: current, after, scores, points: match.points });
    if (out.status === "stale") {
      current = out.current;
      continue;
    }
    // Stored in the order of the first write's keys: put them back in this duel's seat order.
    const flip = out.keys[0] !== match.keys[0];
    return flip ? { before: [out.before[1], out.before[0]], after: [out.after[1], out.after[0]] } : { before: out.before, after: out.after };
  }
  throw new Error("Ratings are busy. Try again.");
}
