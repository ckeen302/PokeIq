import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { RANKED_START, type RankedLeaderRow, type RankedStanding, type RatingState } from "@/lib/ranked";
import { ladderReason } from "@/lib/battle/ladder";
import type { StandardFormatId } from "@/lib/battle/play";
import type { BattleRatings } from "@/lib/battle/play";
import { RankedUnavailable, settleRanked, type ApplyInput, type ApplyOutcome, type RankedStore } from "../ranked";
import type { BattleMeta } from "./store";

/**
 * The battle ladder's ratings: one per trainer (their ladder key, an HMAC)
 * per format. The Elo maths, the provisional K, the tiers and the
 * exactly-once settling are ranked Pokédle's (ranked.ts, lib/ranked.ts): a
 * battle's rating change is computed here and written by one database
 * function that records the battle under its code (a second write for the
 * same battle changes nothing and returns the first), checks both ratings
 * are still the ones it was computed from, and moves both on.
 *
 * Ratings live in Supabase (`battle_ratings`, `battle_ranked_matches`;
 * migration 0018), or in memory with POKEIQ_LOCAL_ACCOUNTS=1 and in
 * development without Supabase. Before the migration is applied there are
 * no ranked battles: the ranked toggle says ranked opens soon.
 */

export interface LadderStore {
  rating(key: string, format: StandardFormatId): Promise<RatingState | null>;
  standing(key: string, format: StandardFormatId): Promise<RankedStanding | null>;
  /** Every format this trainer has a ranked game in. */
  standings(key: string): Promise<{ format: StandardFormatId; standing: RankedStanding }[]>;
  top(format: StandardFormatId, limit: number): Promise<RankedLeaderRow[]>;
  apply(format: StandardFormatId, input: ApplyInput): Promise<ApplyOutcome>;
}

/** One format's ratings, as ranked.ts's settling reads them. */
export function formatStore(store: LadderStore, format: StandardFormatId): RankedStore {
  return {
    rating: (key) => store.rating(key, format),
    standing: (key) => store.standing(key, format),
    top: (limit) => store.top(format, limit),
    apply: (input) => store.apply(format, input),
  };
}

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

const globalStore = globalThis as unknown as { __pokeiqLadder?: MemoryDb };
const slot = (format: string, key: string) => `${format}|${key}`;

export function memoryLadderStore(): LadderStore {
  const db = (globalStore.__pokeiqLadder ??= { players: new Map(), matches: new Map() });
  const ladder = (format: string) =>
    [...db.players.entries()]
      .filter(([k, p]) => k.startsWith(`${format}|`) && p.games > 0)
      .map(([, p]) => p)
      .sort((a, b) => b.rating - a.rating || b.games - a.games || a.name.localeCompare(b.name));
  const standing = (key: string, format: string): RankedStanding | null => {
    const p = db.players.get(slot(format, key));
    if (!p) return null;
    const all = ladder(format);
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
  };
  return {
    async rating(key, format) {
      const p = db.players.get(slot(format, key));
      return p ? { rating: p.rating, games: p.games } : null;
    },
    async standing(key, format) {
      return standing(key, format);
    },
    async standings(key) {
      return [...db.players.keys()]
        .filter((k) => k.endsWith(`|${key}`))
        .map((k) => k.split("|")[0] as StandardFormatId)
        .map((format) => ({ format, standing: standing(key, format)! }))
        .filter((s) => s.standing.games > 0);
    },
    async top(format, limit) {
      return ladder(format)
        .slice(0, limit)
        .map((p, i) => ({ position: i + 1, name: p.name, rating: p.rating, games: p.games, wins: p.wins, losses: p.losses }));
    },
    async apply(format, input) {
      const done = db.matches.get(input.code);
      if (done) return { status: "done", ...done };
      const players = input.keys.map((k, i) => db.players.get(slot(format, k)) ?? { rating: RANKED_START, games: 0, name: input.names[i], wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 });
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
        db.players.set(slot(format, input.keys[i]), p);
      });
      const match = { keys: input.keys, before: [current[0].rating, current[1].rating] as [number, number], after: input.after };
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
    if (Date.now() >= missingUntil) console.warn("[ladder] ranked battles are off until migration 0018_battle_replays_ladder.sql is applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new RankedUnavailable(error.message);
  }
  throw new Error(error.message);
}

const pair = <T>(v: unknown, map: (x: unknown) => T): [T, T] => {
  const a = v as unknown[];
  return [map(a[0]), map(a[1])];
};

function toStanding(r: Record<string, unknown>): RankedStanding {
  return {
    rating: Number(r.rating),
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
    if (Date.now() < missingUntil) throw new RankedUnavailable("migration 0018 not applied");
    const { data, error } = await sb.rpc(fn, args);
    check(error);
    return data as unknown;
  };
  return {
    async rating(key, format) {
      const r = (await call("battle_ladder_standing", { p_key: key, p_format: format })) as Record<string, unknown> | null;
      return r && r.rating !== null && r.rating !== undefined ? { rating: Number(r.rating), games: Number(r.games) } : null;
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
      return rows.map((r, i) => ({ position: i + 1, name: String(r.name), rating: Number(r.rating), games: Number(r.games), wins: Number(r.wins), losses: Number(r.losses) }));
    },
    async apply(format, input) {
      const r = (await call("battle_ranked_apply", {
        p_code: input.code,
        p_format: format,
        p_keys: input.keys,
        p_names: input.names,
        p_expect_rating: input.expect.map((e) => e.rating),
        p_expect_games: input.expect.map((e) => e.games),
        p_after: input.after,
        p_scores: input.scores,
      })) as Record<string, unknown>;
      if (r.status === "stale") {
        const ratings = pair(r.rating, Number);
        const games = pair(r.games, Number);
        return { status: "stale", current: [{ rating: ratings[0], games: games[0] }, { rating: ratings[1], games: games[1] }] };
      }
      return { status: r.status === "applied" ? "applied" : "done", keys: pair(r.keys, String), before: pair(r.before, Number), after: pair(r.after, Number) };
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
 * Counts a finished ranked battle, once: each seat's rating before and after
 * (null when it doesn't count: no contest, or a seat without a ladder key).
 * Safe to call again and again: later calls return what the first recorded.
 */
export async function settleRankedBattle(meta: BattleMeta, store: LadderStore): Promise<BattleRatings | null> {
  if (!meta.ranked || !meta.end || meta.seats.length !== 2) return null;
  const reason = ladderReason(meta.end);
  const keys = meta.seats.map((s) => s.player);
  if (!reason || !keys[0] || !keys[1] || keys[0] === keys[1]) return null;
  const out = await settleRanked(
    { code: meta.code, keys: [keys[0], keys[1]], names: [meta.seats[0].name, meta.seats[1].name], reason, winner: meta.end.winner },
    formatStore(store, meta.format as StandardFormatId)
  );
  return [
    { before: out.before[0], after: out.after[0] },
    { before: out.before[1], after: out.after[1] },
  ];
}
