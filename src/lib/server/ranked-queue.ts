import "server-only";
import type { RatingState } from "@/lib/ranked";
import type { PvpFailure } from "./duel-core";
import { rankedQueueStore } from "./duel-store";
import { MATCH_FRESH_MS, seatNames, type OpenedGame } from "./match-queue";

/**
 * The ranked queue: trainers are paired by rating. Unlike the casual queue
 * (one waiting trainer per row), the ranked row keeps everyone waiting, each
 * with the rating they queued at, so a search can pick the closest match.
 *
 * Two trainers may be paired when their ratings are within a gap that
 * widens the longer either has waited: close games at first, then anyone
 * rather than nobody. Every change is a compare-and-swap on the row, as in
 * match-queue.ts, so nobody is paired twice.
 */

export const RANKED_QUEUE_KEY = "pokedle:ranked";
/** The rating gap allowed at once, how much it widens each second of waiting, and the most it ever is. */
export const RANKED_GAP_BASE = 100;
export const RANKED_GAP_PER_SECOND = 15;
export const RANKED_GAP_MAX = 1000;
/** Polls refresh a waiting trainer at most this often, to spare writes. */
const SEEN_STEP_MS = 2_000;
const MATCH_KEEP_MS = 60_000;
/** Never more than this many waiting in one row. */
const POOL_MAX = 64;
const MAX_TRIES = 6;

/** The rating gap allowed after waiting `ms`. */
export const allowedGap = (ms: number) => Math.min(RANKED_GAP_MAX, RANKED_GAP_BASE + RANKED_GAP_PER_SECOND * Math.floor(Math.max(0, ms) / 1000));

export interface RankedWaiter {
  ticket: string;
  name: string;
  /** The trainer's rating key (an HMAC), so nobody is paired with themselves in another tab. Server-side only. */
  player: string;
  rating: number;
  /** Ranked games played, for the provisional badge. */
  games: number;
  since: number;
  seenAt: number;
}

export interface RankedQueueRow {
  key: string;
  pool: RankedWaiter[];
  matched: Record<string, { code: string; playerId: string; at: number }>;
}

export const emptyRankedQueue = (key = RANKED_QUEUE_KEY): RankedQueueRow => ({ key, pool: [], matched: {} });

export interface RankedSearcher {
  ticket: string;
  name: string;
  player: string;
}

export type RankedPlan =
  | { kind: "matched"; code: string; playerId: string }
  | { kind: "waiting"; refresh: boolean }
  | { kind: "pair"; opponent: RankedWaiter }
  | { kind: "wait" };

/**
 * What a search should do. `rating` is the searcher's rating (what they
 * queued at, if they're already waiting). A pair is allowed when the gap is
 * within what the longer wait of the two allows; of those, the closest
 * rating wins, then whoever has waited longest.
 */
export function planRanked(row: RankedQueueRow, me: RankedSearcher, rating: number, now: number): RankedPlan {
  // `rating` is ignored once the searcher is in the pool: they keep the rating they queued at.
  const match = row.matched[me.ticket];
  if (match) return { kind: "matched", code: match.code, playerId: match.playerId };
  const mine = row.pool.find((w) => w.ticket === me.ticket);
  const mySince = mine?.since ?? now;
  const myRating = mine?.rating ?? rating;
  const best = row.pool
    .filter((w) => w.ticket !== me.ticket && w.player !== me.player && now - w.seenAt <= MATCH_FRESH_MS)
    .map((w) => ({ w, gap: Math.abs(w.rating - myRating), allowed: allowedGap(now - Math.min(w.since, mySince)) }))
    .filter((c) => c.gap <= c.allowed)
    .sort((a, b) => a.gap - b.gap || a.w.since - b.w.since)[0];
  if (best) return { kind: "pair", opponent: best.w };
  if (mine) return { kind: "waiting", refresh: now - mine.seenAt >= SEEN_STEP_MS };
  return { kind: "wait" };
}

const live = (row: RankedQueueRow, now: number) => ({
  pool: row.pool.filter((w) => now - w.seenAt <= MATCH_FRESH_MS),
  matched: Object.fromEntries(Object.entries(row.matched).filter(([, m]) => now - m.at < MATCH_KEEP_MS)),
});

/** You join the pool, or say you're still in it (keeping the rating and time you queued at). */
export function withRankedWaiter(row: RankedQueueRow, me: RankedSearcher, rating: RatingState, now: number): RankedQueueRow {
  const { pool, matched } = live(row, now);
  const mine = row.pool.find((w) => w.ticket === me.ticket);
  const waiter: RankedWaiter = {
    ticket: me.ticket,
    name: me.name,
    player: me.player,
    rating: mine?.rating ?? rating.rating,
    games: mine?.games ?? rating.games,
    since: mine?.since ?? now,
    seenAt: now,
  };
  // Another search by the same trainer (a second tab) gives way to this one.
  const others = pool.filter((w) => w.ticket !== me.ticket && w.player !== me.player);
  return { key: row.key, pool: [...others, waiter].slice(-POOL_MAX), matched };
}

/** Two trainers paired: both out of the pool, the waiter's seat kept for them to collect. */
export function withRankedPair(row: RankedQueueRow, opponent: string, me: string, seat: { code: string; playerId: string }, now: number): RankedQueueRow {
  const { pool, matched } = live(row, now);
  return { key: row.key, pool: pool.filter((w) => w.ticket !== opponent && w.ticket !== me), matched: { ...matched, [opponent]: { ...seat, at: now } } };
}

export function withoutRankedTicket(row: RankedQueueRow, ticket: string): RankedQueueRow {
  return row.pool.some((w) => w.ticket === ticket) ? { ...row, pool: row.pool.filter((w) => w.ticket !== ticket) } : row;
}

export type RankedQueueResult =
  | { ok: true; status: "waiting"; ticket: string; since: number }
  | { ok: true; status: "matched"; code: string; playerId: string; seat: 0 | 1 };

const busy: PvpFailure = { ok: false, status: 503, error: "Matchmaking is busy. Try again." };

const writeRow = (row: RankedQueueRow, version: number | null) => (version === null ? rankedQueueStore.insert(row) : rankedQueueStore.save(row, version));

/** The two trainers a ranked game opens for, the waiter first. */
export interface RankedSeat extends RatingState {
  name: string;
  player: string;
}

/**
 * A ranked search (or its next poll). `rating` reads the searcher's rating,
 * only when it's needed (joining the pool, or pairing before joining).
 */
export async function searchRankedQueue(
  me: RankedSearcher,
  rating: () => Promise<RatingState>,
  open: (players: [RankedSeat, RankedSeat], now: number) => Promise<OpenedGame | null>,
  key = RANKED_QUEUE_KEY
): Promise<RankedQueueResult | PvpFailure> {
  let mine: RatingState | null = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const stored = await rankedQueueStore.load(key);
    const row = stored?.duel ?? emptyRankedQueue(key);
    const version = stored ? stored.version : null;
    const queued = row.pool.find((w) => w.ticket === me.ticket);
    if (!queued && !row.matched[me.ticket] && mine === null) mine = await rating();
    const myRating: RatingState = queued ?? mine ?? { rating: 0, games: 0 };
    const now = Date.now();
    const plan = planRanked(row, me, myRating.rating, now);

    if (plan.kind === "matched") return { ok: true, status: "matched", code: plan.code, playerId: plan.playerId, seat: 0 };
    if (plan.kind === "waiting") {
      if (plan.refresh && !(await writeRow(withRankedWaiter(row, me, myRating, now), version))) continue;
      return { ok: true, status: "waiting", ticket: me.ticket, since: queued!.since };
    }
    if (plan.kind === "wait") {
      const next = withRankedWaiter(row, me, myRating, now);
      if (!(await writeRow(next, version))) continue;
      return { ok: true, status: "waiting", ticket: me.ticket, since: next.pool.find((w) => w.ticket === me.ticket)!.since };
    }

    const [a, b] = seatNames(plan.opponent.name, me.name);
    const game = await open(
      [
        { name: a, player: plan.opponent.player, rating: plan.opponent.rating, games: plan.opponent.games },
        { name: b, player: me.player, rating: myRating.rating, games: myRating.games },
      ],
      now
    );
    if (!game) return busy;
    if (!(await writeRow(withRankedPair(row, plan.opponent.ticket, me.ticket, { code: game.code, playerId: game.ids[0] }, now), version))) {
      await game.remove();
      continue;
    }
    return { ok: true, status: "matched", code: game.code, playerId: game.ids[1], seat: 1 };
  }
  return busy;
}

export async function cancelRankedQueue(ticket: string, key = RANKED_QUEUE_KEY): Promise<void> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const stored = await rankedQueueStore.load(key);
    if (!stored || !stored.duel.pool.some((w) => w.ticket === ticket)) return;
    if (await rankedQueueStore.save(withoutRankedTicket(stored.duel, ticket), stored.version)) return;
  }
}
