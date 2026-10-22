import "server-only";
import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  RANKED_START,
  matchScores,
  rateMatch,
  type RankedLeaderRow,
  type RankedStanding,
  type RatingState,
} from "@/lib/ranked";
import type { PvpEndReason } from "@/lib/pvp-types";
import { deriveSeed, randomId, signToken, verifyToken } from "./crypto";
import { sessionTokenHash, userFromRequest } from "./auth";

/**
 * Ranked Pokédle: one rating per trainer, changed once per finished ranked
 * duel.
 *
 * A trainer is their account when signed in, else a signed anonymous id the
 * server hands their browser (so ids can't be made up to take over someone
 * else's rating). Either way only an HMAC of it is stored.
 *
 * A rating change is computed here (the maths is in lib/ranked.ts) and
 * written by one database function that, in one transaction, records the
 * match (keyed by the duel's code: a second write for the same duel changes
 * nothing and returns the first), checks both ratings are still the ones the
 * change was computed from (else it asks for a fresh computation), and moves
 * both ratings on. So every match counts exactly once, whatever polls race.
 *
 * Ratings live in Supabase (`pokedle_ratings`, `pokedle_ranked_matches`;
 * migration 0014), or in memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests, the
 * local E2E run) or in development without Supabase. Before the migration
 * has been applied there is no ranked play: callers get null and the page
 * offers casual duels only.
 */

// ---------------------------------------------------------------------------
// Who's playing
// ---------------------------------------------------------------------------

const ANON_KIND = "pokedle-ranked-anon";
const ANON_RE = /^[A-Za-z0-9_-]{16}$/;

/** A new signed anonymous id for a browser that doesn't have one. */
export const newAnonId = () => signToken(ANON_KIND, { a: randomId(12) });

/** The anonymous id inside a token, if the server signed it. */
export function readAnonId(token: unknown): string | null {
  const out = verifyToken<{ a?: unknown }>(ANON_KIND, token);
  return out && typeof out.a === "string" && ANON_RE.test(out.a) ? out.a : null;
}

/** The key a trainer's rating is stored under: an HMAC of "u:<account>" or "a:<anonymous id>". */
export const rankedKey = (identity: string) => deriveSeed("pokedle-ranked", identity);

/** The trainer behind a request: their account if signed in, else the anonymous id they sent. Null when neither. */
export async function rankedIdentity(request: NextRequest, anonToken: unknown): Promise<string | null> {
  if (sessionTokenHash(request)) {
    try {
      const user = await userFromRequest(request);
      if (user) return `u:${user.id}`;
    } catch {
      // Accounts are down: fall back to the anonymous id.
    }
  }
  const anon = readAnonId(anonToken);
  return anon ? `a:${anon}` : null;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface ApplyInput {
  code: string;
  keys: [string, string];
  names: [string, string];
  /** The ratings the change was computed from. */
  expect: [RatingState, RatingState];
  after: [number, number];
  scores: [number, number];
}

export type ApplyOutcome =
  /** Recorded now, or already recorded for this duel: the match as it was counted. */
  | { status: "applied" | "done"; keys: [string, string]; before: [number, number]; after: [number, number] }
  /** A rating moved since it was read: compute again from these. */
  | { status: "stale"; current: [RatingState, RatingState] };

/**
 * A ladder: Pokédle's, or one PokéGuessr season's (see geo-ranked.ts). The
 * same maths and the same store, each with ratings of its own: in memory
 * under its own name, in Supabase through its own functions (with `args`
 * added to every call, such as the season).
 */
export interface RankedLadder {
  id: string;
  fns: { apply: string; standing: string; top: string };
  args?: Record<string, unknown>;
  /** The migration that creates its tables and functions (named in the log while it's missing). */
  migration: string;
}

export const POKEDLE_LADDER: RankedLadder = {
  id: "pokedle",
  fns: { apply: "pokedle_ranked_apply", standing: "pokedle_ranked_standing", top: "pokedle_ranked_top" },
  migration: "0014_pokedle_ranked.sql",
};

export interface RankedStore {
  /** Null when there's no such trainer yet. */
  rating(key: string): Promise<RatingState | null>;
  standing(key: string): Promise<RankedStanding | null>;
  top(limit: number): Promise<RankedLeaderRow[]>;
  apply(input: ApplyInput): Promise<ApplyOutcome>;
}

/** Thrown when the store isn't there (the migration hasn't been applied). */
export class RankedUnavailable extends Error {}

// ---- memory -------------------------------------------------------------------

interface MemoryPlayer extends RatingState {
  name: string;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestStreak: number;
}

interface MemoryDb {
  players: Map<string, MemoryPlayer>;
  matches: Map<string, { keys: [string, string]; before: [number, number]; after: [number, number] }>;
}

const globalStore = globalThis as unknown as { __pokeiqRanked?: MemoryDb; __pokeiqRankedLadders?: Map<string, MemoryDb> };

/** A ladder's ratings in memory (Pokédle's where they always were). */
function memoryDb(ladder: string): MemoryDb {
  if (ladder === POKEDLE_LADDER.id) return (globalStore.__pokeiqRanked ??= { players: new Map(), matches: new Map() });
  const all = (globalStore.__pokeiqRankedLadders ??= new Map());
  if (!all.has(ladder)) all.set(ladder, { players: new Map(), matches: new Map() });
  return all.get(ladder)!;
}

const blankPlayer = (name: string): MemoryPlayer => ({ rating: RANKED_START, games: 0, name, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 });

const ladder = (db: MemoryDb) =>
  [...db.players.values()].filter((p) => p.games > 0).sort((a, b) => b.rating - a.rating || b.games - a.games || a.name.localeCompare(b.name));

export function memoryRankedStore(which: RankedLadder = POKEDLE_LADDER): RankedStore {
  const db = memoryDb(which.id);
  return {
    async rating(key) {
      const p = db.players.get(key);
      return p ? { rating: p.rating, games: p.games } : null;
    },
    async standing(key) {
      const p = db.players.get(key);
      const all = ladder(db);
      if (!p) return null;
      return {
        rating: p.rating,
        games: p.games,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        streak: p.streak,
        bestStreak: p.bestStreak,
        position: p.games > 0 ? all.filter((q) => q.rating > p.rating).length + 1 : null,
        players: all.length,
      };
    },
    async top(limit) {
      return ladder(db)
        .slice(0, limit)
        .map((p, i) => ({ position: i + 1, name: p.name, rating: p.rating, games: p.games, wins: p.wins, losses: p.losses }));
    },
    async apply(input) {
      const done = db.matches.get(input.code);
      if (done) return { status: "done", ...done };
      const players = input.keys.map((k, i) => db.players.get(k) ?? blankPlayer(input.names[i]));
      const current = players.map((p) => ({ rating: p.rating, games: p.games })) as [RatingState, RatingState];
      if (current.some((c, i) => c.rating !== input.expect[i].rating || c.games !== input.expect[i].games)) return { status: "stale", current };
      players.forEach((p, i) => {
        const s = input.scores[i];
        p.rating = input.after[i];
        p.games += 1;
        p.name = input.names[i];
        if (s === 1) p.wins += 1;
        else if (s === 0.5) p.draws += 1;
        else p.losses += 1;
        p.streak = s === 1 ? p.streak + 1 : 0;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        db.players.set(input.keys[i], p);
      });
      const match = { keys: input.keys, before: [current[0].rating, current[1].rating] as [number, number], after: input.after };
      db.matches.set(input.code, match);
      return { status: "applied", ...match };
    },
  };
}

/** Forgets every rating in memory (tests). */
export function clearMemoryRanked() {
  globalStore.__pokeiqRanked = undefined;
  globalStore.__pokeiqRankedLadders = undefined;
}

// ---- Supabase -------------------------------------------------------------------

/** The tables or functions aren't there (the migration hasn't been applied). */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
/** After finding them missing, look again this much later (so applying the migration needs no redeploy). */
const RECHECK_MS = 60_000;
/** Per migration: until when its tables are taken to be missing. */
const missingUntil = new Map<string, number>();

function check(error: { code?: string; message?: string } | null, migration: string) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    if (Date.now() >= (missingUntil.get(migration) ?? 0)) console.warn(`[ranked] ranked play is off until migration ${migration} is applied:`, error.message);
    missingUntil.set(migration, Date.now() + RECHECK_MS);
    throw new RankedUnavailable(error.message);
  }
  throw new Error(error.message);
}

const pair = <T>(v: unknown, map: (x: unknown) => T): [T, T] => {
  const a = v as unknown[];
  return [map(a[0]), map(a[1])];
};

export function supabaseRankedStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>, ladder: RankedLadder = POKEDLE_LADDER): RankedStore {
  const call = async (fn: "apply" | "standing" | "top", args: Record<string, unknown>) => {
    if (Date.now() < (missingUntil.get(ladder.migration) ?? 0)) throw new RankedUnavailable(`migration ${ladder.migration} not applied`);
    const { data, error } = await sb.rpc(ladder.fns[fn], { ...args, ...ladder.args });
    check(error, ladder.migration);
    return data as Record<string, unknown> | null;
  };
  return {
    async rating(key) {
      const r = await call("standing", { p_key: key });
      return r && r.rating !== null && r.rating !== undefined ? { rating: Number(r.rating), games: Number(r.games) } : null;
    },
    async standing(key) {
      const r = await call("standing", { p_key: key });
      if (!r || r.rating === null || r.rating === undefined) return null;
      return {
        rating: Number(r.rating),
        games: Number(r.games),
        wins: Number(r.wins),
        losses: Number(r.losses),
        draws: Number(r.draws),
        streak: Number(r.streak),
        bestStreak: Number(r.best_streak),
        position: r.position === null ? null : Number(r.position),
        players: Number(r.players),
      };
    },
    async top(limit) {
      const rows = ((await call("top", { p_limit: limit })) ?? []) as unknown as Record<string, unknown>[];
      return rows.map((r, i) => ({
        position: i + 1,
        name: String(r.name),
        rating: Number(r.rating),
        games: Number(r.games),
        wins: Number(r.wins),
        losses: Number(r.losses),
      }));
    },
    async apply(input) {
      const r = (await call("apply", {
        p_code: input.code,
        p_keys: input.keys,
        p_names: input.names,
        p_expect_rating: input.expect.map((e) => e.rating),
        p_expect_games: input.expect.map((e) => e.games),
        p_after: input.after,
        p_scores: input.scores,
      }))!;
      if (r.status === "stale") {
        const ratings = pair(r.rating, Number);
        const games = pair(r.games, Number);
        return { status: "stale", current: [{ rating: ratings[0], games: games[0] }, { rating: ratings[1], games: games[1] }] };
      }
      return {
        status: r.status === "applied" ? "applied" : "done",
        keys: pair(r.keys, String),
        before: pair(r.before, Number),
        after: pair(r.after, Number),
      };
    },
  };
}

/** Where ratings live: memory for tests, local E2E and development without Supabase; else Supabase; null in production without it. */
export function rankedStore(ladder: RankedLadder = POKEDLE_LADDER): RankedStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryRankedStore(ladder);
  const sb = getServiceSupabase();
  if (sb) return supabaseRankedStore(sb, ladder);
  return process.env.NODE_ENV !== "production" ? memoryRankedStore(ladder) : null;
}

// ---------------------------------------------------------------------------
// Settling a duel
// ---------------------------------------------------------------------------

/** What a finished ranked duel needs to be counted. */
export interface RankedMatch {
  code: string;
  keys: [string, string];
  names: [string, string];
  reason: PvpEndReason;
  winner: number | null;
}

const MAX_TRIES = 5;

/**
 * Counts a finished ranked duel, once: each seat's rating before and after
 * (by seat). Safe to call again and again for the same duel: later calls
 * return what the first one recorded.
 */
export async function settleRanked(match: RankedMatch, store: RankedStore): Promise<{ before: [number, number]; after: [number, number] }> {
  const scores = matchScores(match.reason, match.winner);
  const fresh = async (key: string): Promise<RatingState> => (await store.rating(key)) ?? { rating: RANKED_START, games: 0 };
  let current: [RatingState, RatingState] = [await fresh(match.keys[0]), await fresh(match.keys[1])];
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const [a, b] = rateMatch(current, scores);
    const out = await store.apply({ code: match.code, keys: match.keys, names: match.names, expect: current, after: [a.after, b.after], scores });
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
