import "server-only";
import { randomId } from "./crypto";
import type { PvpFailure } from "./duel-core";
import { queueStore } from "./duel-store";

/**
 * The matchmaking queue every game shares: trainers searching with the same
 * queue key (a game and its settings: "geo:kanto", "pokedle:all",
 * "battle:gen9randombattle") are paired, no link needed.
 *
 * Each queue is one row (`duel_queue`) holding at most one waiting trainer.
 * A search reads the row: if someone else is waiting and still polling, it
 * opens a game with both seated and ready, and takes them out of the queue;
 * otherwise it becomes the one waiting. Every change to the row is a
 * compare-and-swap, so two searches can never both wait on each other, and a
 * waiting trainer is paired once at most: of two searches that find them,
 * one wins the swap and the other starts over (and its game is thrown away).
 * The waiting trainer learns of the match on their next poll, from the row.
 *
 * A search is identified by its ticket, a random secret only the searcher
 * holds; polling keeps it fresh, and a ticket not heard from in 8 seconds
 * (a closed tab) is passed over.
 */

/** A waiting trainer not heard from in this long has gone. */
export const MATCH_FRESH_MS = 8_000;
/** Polls refresh the waiting trainer at most this often, to spare writes. */
const SEEN_STEP_MS = 2_000;
/** A match waits this long for its trainer to collect it. */
const MATCH_KEEP_MS = 60_000;
const MAX_TRIES = 6;

export interface Waiter {
  ticket: string;
  name: string;
  /** When the search began. */
  since: number;
  seenAt: number;
  /** What the trainer brings, checked before they joined the queue (a battle team, packed). Server-side only. */
  team?: string;
  /** A battle ladder key (an HMAC). Server-side only. */
  player?: string;
}

export interface QueueRow {
  /** The queue's key, e.g. "geo:world". */
  key: string;
  waiting?: Waiter;
  /** Searches that were paired while waiting, until they collect their seat: ticket → game. */
  matched: Record<string, { code: string; playerId: string; at: number }>;
}

export type SearchPlan =
  /** Someone paired with you while you waited. */
  | { kind: "matched"; code: string; playerId: string }
  /** You're the one waiting (refresh: time to tell the row you're still here). */
  | { kind: "waiting"; refresh: boolean }
  /** Someone else is waiting: pair with them. */
  | { kind: "pair"; opponent: Waiter }
  /** Nobody is: wait. */
  | { kind: "wait" };

export const emptyQueue = (key: string): QueueRow => ({ key, matched: {} });

/** What a search with `ticket` should do, given the queue as it stands. */
export function planSearch(row: QueueRow, ticket: string, now: number): SearchPlan {
  const match = row.matched[ticket];
  if (match) return { kind: "matched", code: match.code, playerId: match.playerId };
  const waiter = row.waiting;
  if (waiter?.ticket === ticket) return { kind: "waiting", refresh: now - waiter.seenAt >= SEEN_STEP_MS };
  if (waiter && now - waiter.seenAt <= MATCH_FRESH_MS) return { kind: "pair", opponent: waiter };
  return { kind: "wait" };
}

const fresh = (matched: QueueRow["matched"], now: number) => Object.fromEntries(Object.entries(matched).filter(([, m]) => now - m.at < MATCH_KEEP_MS));

/** You take the waiting slot (or, already in it, say you're still here; what you brought stays). */
export function withWaiter(row: QueueRow, me: { ticket: string; name: string; team?: string; player?: string }, now: number): QueueRow {
  const mine = row.waiting?.ticket === me.ticket ? row.waiting : undefined;
  const team = me.team ?? mine?.team;
  const waiting: Waiter = { ticket: me.ticket, name: me.name, since: mine?.since ?? now, seenAt: now };
  if (team) waiting.team = team;
  const player = me.player ?? mine?.player;
  if (player) waiting.player = player;
  return { key: row.key, waiting, matched: fresh(row.matched, now) };
}

/** The waiting trainer is paired: out of the slot, their seat kept for them to collect. */
export function withPair(row: QueueRow, opponent: string, seat: { code: string; playerId: string }, now: number): QueueRow {
  return { key: row.key, matched: { ...fresh(row.matched, now), [opponent]: { ...seat, at: now } } };
}

/** A search given up: out of the slot (if it's still in it). */
export function withoutTicket(row: QueueRow, ticket: string): QueueRow {
  return row.waiting?.ticket === ticket ? { key: row.key, matched: row.matched } : row;
}

/** Two trainers in one game need different names: the newcomer gets a 2. */
export function seatNames(waiter: string, newcomer: string): [string, string] {
  return waiter.toLowerCase() === newcomer.toLowerCase() ? [waiter, `${newcomer.slice(0, 22)} 2`] : [waiter, newcomer];
}

export const newTicket = () => randomId(12);

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/** A game opened for two matched trainers: its code, each seat's id (the waiter's first), and how to throw it away. */
/** A trainer a game opens for: their name (made distinct), and what they brought. */
export interface QueuedPlayer {
  name: string;
  team?: string;
  player?: string;
}

export interface OpenedGame {
  code: string;
  ids: [string, string];
  remove: () => Promise<void>;
}

export interface Searcher {
  ticket: string;
  name: string;
  /** A battle ladder key (server-side only), for the trainer's battle record and replays. */
  player?: string;
  /**
   * What the searcher brings (a battle team), checked only when it's needed:
   * before they wait, or before they pair. A failure ends the search.
   */
  bring?: () => { ok: true; team?: string } | PvpFailure;
}

export type QueueResult =
  | { ok: true; status: "waiting"; ticket: string; since: number }
  /** Seat 0 is the trainer who was waiting. */
  | { ok: true; status: "matched"; code: string; playerId: string; seat: 0 | 1 };

const busy: PvpFailure = { ok: false, status: 503, error: "Matchmaking is busy. Try again." };

/** Writes the queue row: a new row for a queue nobody has used yet, else a compare-and-swap. */
const writeQueue = (row: QueueRow, version: number | null) => (version === null ? queueStore.insert(row) : queueStore.save(row, version));

/**
 * A search (or the next poll of one) in the queue `key`: paired, or waiting.
 * `open` opens the game for the waiting trainer and the searcher (with
 * their names, made distinct, and what each brought).
 */
export async function searchQueue(
  key: string,
  me: Searcher,
  open: (players: [QueuedPlayer, QueuedPlayer], now: number) => Promise<OpenedGame | null>
): Promise<QueueResult | PvpFailure> {
  let brought: { ok: true; team?: string } | PvpFailure | null = null;
  const bring = () => (brought ??= me.bring ? me.bring() : { ok: true });
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const stored = await queueStore.load(key);
    const row = stored?.duel ?? emptyQueue(key);
    const version = stored ? stored.version : null;
    const now = Date.now();
    const plan = planSearch(row, me.ticket, now);

    if (plan.kind === "matched") return { ok: true, status: "matched", code: plan.code, playerId: plan.playerId, seat: 0 };
    if (plan.kind === "waiting") {
      if (plan.refresh && !(await writeQueue(withWaiter(row, me, now), version))) continue;
      return { ok: true, status: "waiting", ticket: me.ticket, since: row.waiting!.since };
    }
    const mine = bring();
    if (!mine.ok) return mine;
    if (plan.kind === "wait") {
      const next = withWaiter(row, { ticket: me.ticket, name: me.name, team: mine.team, player: me.player }, now);
      if (!(await writeQueue(next, version))) continue;
      return { ok: true, status: "waiting", ticket: me.ticket, since: next.waiting!.since };
    }

    // Pair with the waiting trainer: open the game, then claim them. If someone else claimed them first, start over.
    const [a, b] = seatNames(plan.opponent.name, me.name);
    const game = await open(
      [
        { name: a, team: plan.opponent.team, player: plan.opponent.player },
        { name: b, team: mine.team, player: me.player },
      ],
      now
    );
    if (!game) return busy;
    if (!(await writeQueue(withPair(row, plan.opponent.ticket, { code: game.code, playerId: game.ids[0] }, now), version))) {
      await game.remove();
      continue;
    }
    return { ok: true, status: "matched", code: game.code, playerId: game.ids[1], seat: 1 };
  }
  return busy;
}

/** Gives up a search in the queue `key`. */
export async function cancelQueue(key: string, ticket: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const stored = await queueStore.load(key);
    if (!stored || stored.duel.waiting?.ticket !== ticket) return;
    if (await queueStore.save(withoutTicket(stored.duel, ticket), stored.version)) return;
  }
}
