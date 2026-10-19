import "server-only";
import { z } from "zod";
import { randomId } from "./crypto";
import { createDuel, duelToken, isDuelMap, joinDuel as joinGeoDuel, readyDuel as readyGeoDuel } from "./duel";
import { pvpToken, type PvpFailure } from "./duel-core";
import { deleteDuel, insertDuel, newDuelCode, pvpStore, queueStore } from "./duel-store";
import { joinDuel, readyDuel } from "./duels";
import { createPokedleDuel } from "./pokedle-duel";
import { pvpHref } from "@/lib/pvp-types";

/**
 * Matchmaking: trainers searching for the same game with the same settings
 * are paired into a duel, no link needed.
 *
 * Each queue (a game and its settings: "geo:kanto", "pokedle:all") is one
 * row holding at most one waiting trainer. A search reads the row: if
 * someone else is waiting and still polling, it opens a duel with both
 * seated and ready, and takes them out of the queue; otherwise it becomes
 * the one waiting. Every change to the row is a compare-and-swap, so two
 * searches can never both wait on each other, and a waiting trainer is
 * paired once at most: of two searches that find them, one wins the swap
 * and the other starts over (and its duel is thrown away). The waiting
 * trainer learns of the match on their next poll, from the row.
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

/**
 * What can be matched: PokéGuessr on any map, and Pokédle on every
 * generation (one queue, so it fills up; a duel with picked generations is
 * one you invite a friend to).
 */
export const matchSettingsSchema = z.discriminatedUnion("game", [
  z.object({ game: z.literal("geo"), region: z.string().max(20).refine(isDuelMap, "Unknown map.") }),
  z.object({ game: z.literal("pokedle") }),
]);
export type MatchSettings = z.infer<typeof matchSettingsSchema>;

export const queueKey = (s: MatchSettings) => (s.game === "geo" ? `geo:${s.region}` : "pokedle:all");

export interface Waiter {
  ticket: string;
  name: string;
  /** When the search began. */
  since: number;
  seenAt: number;
}

export interface QueueRow {
  /** The queue's key, e.g. "geo:world". */
  key: string;
  waiting?: Waiter;
  /** Searches that were paired while waiting, until they collect their seat: ticket → duel. */
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

/** You take the waiting slot (or, already in it, say you're still here). */
export function withWaiter(row: QueueRow, me: { ticket: string; name: string }, now: number): QueueRow {
  const since = row.waiting?.ticket === me.ticket ? row.waiting.since : now;
  return { key: row.key, waiting: { ticket: me.ticket, name: me.name, since, seenAt: now }, matched: fresh(row.matched, now) };
}

/** The waiting trainer is paired: out of the slot, their seat kept for them to collect. */
export function withPair(row: QueueRow, opponent: string, seat: { code: string; playerId: string }, now: number): QueueRow {
  return { key: row.key, matched: { ...fresh(row.matched, now), [opponent]: { ...seat, at: now } } };
}

/** A search given up: out of the slot (if it's still in it). */
export function withoutTicket(row: QueueRow, ticket: string): QueueRow {
  return row.waiting?.ticket === ticket ? { key: row.key, matched: row.matched } : row;
}

/** Two trainers in one duel need different names: the newcomer gets a 2. */
export function seatNames(waiter: string, newcomer: string): [string, string] {
  return waiter.toLowerCase() === newcomer.toLowerCase() ? [waiter, `${newcomer.slice(0, 22)} 2`] : [waiter, newcomer];
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type SearchResult =
  | { ok: true; status: "waiting"; ticket: string; since: number }
  | { ok: true; status: "matched"; code: string; token: string; href: string };

const busy: PvpFailure = { ok: false, status: 503, error: "Matchmaking is busy. Try again." };

const must = <T extends { ok: boolean }>(out: T | PvpFailure): Extract<T, { ok: true }> => {
  if (!out.ok) throw new Error((out as PvpFailure).error);
  return out as Extract<T, { ok: true }>;
};

/**
 * A duel for two matched trainers, stored and under way: both seated and
 * ready, so round 1 starts after the usual countdown. Seat 0 is the trainer
 * who was waiting.
 */
async function openDuel(settings: MatchSettings, names: [string, string], now: number) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newDuelCode();
    if (settings.game === "geo") {
      const { duel, playerId: a } = createDuel(settings.region, names[0], code, now);
      const { duel: joined, playerId: b } = must(joinGeoDuel(duel, names[1], now));
      const ready = must(readyGeoDuel(must(readyGeoDuel(joined, a, true, now)).duel, b, true, now)).duel;
      if (await insertDuel(ready)) return { code, ids: [a, b], remove: () => deleteDuel(code) };
    } else {
      const { duel, playerId: a } = createPokedleDuel(names[0], code, now);
      const { duel: joined, playerId: b } = must(joinDuel(duel, names[1], now));
      const ready = must(readyDuel(must(readyDuel(joined, a, true, now)).duel, b, true, now)).duel;
      if (await pvpStore.insert(ready)) return { code, ids: [a, b], remove: () => pvpStore.remove(code) };
    }
  }
  return null;
}

function seat(settings: MatchSettings, code: string, playerId: string): SearchResult {
  return settings.game === "geo"
    ? { ok: true, status: "matched", code, token: duelToken(code, playerId), href: `/guessr/duel/${code}` }
    : { ok: true, status: "matched", code, token: pvpToken(code, playerId), href: pvpHref("pokedle", code) };
}

/** Writes the queue row: a new row for a queue nobody has used yet, else a compare-and-swap. */
const writeQueue = (row: QueueRow, version: number | null) => (version === null ? queueStore.insert(row) : queueStore.save(row, version));

export const newTicket = () => randomId(12);

/**
 * A search (or the next poll of one): paired, or waiting. `ticket` is the
 * search's own; a first search passes a new one.
 */
export async function searchMatch(settings: MatchSettings, name: string, ticket: string): Promise<SearchResult | PvpFailure> {
  const key = queueKey(settings);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const stored = await queueStore.load(key);
    const row = stored?.duel ?? emptyQueue(key);
    const version = stored ? stored.version : null;
    const now = Date.now();
    const plan = planSearch(row, ticket, now);

    if (plan.kind === "matched") return seat(settings, plan.code, plan.playerId);
    if (plan.kind === "waiting") {
      if (plan.refresh && !(await writeQueue(withWaiter(row, { ticket, name }, now), version))) continue;
      return { ok: true, status: "waiting", ticket, since: row.waiting!.since };
    }
    if (plan.kind === "wait") {
      const next = withWaiter(row, { ticket, name }, now);
      if (!(await writeQueue(next, version))) continue;
      return { ok: true, status: "waiting", ticket, since: next.waiting!.since };
    }

    // Pair with the waiting trainer: open the duel, then claim them. If someone else claimed them first, start over.
    const duel = await openDuel(settings, seatNames(plan.opponent.name, name), now);
    if (!duel) return busy;
    if (!(await writeQueue(withPair(row, plan.opponent.ticket, { code: duel.code, playerId: duel.ids[0] }, now), version))) {
      await duel.remove();
      continue;
    }
    return seat(settings, duel.code, duel.ids[1]);
  }
  return busy;
}

/** Gives up a search. */
export async function cancelMatch(settings: MatchSettings, ticket: string): Promise<void> {
  const key = queueKey(settings);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const stored = await queueStore.load(key);
    if (!stored || stored.duel.waiting?.ticket !== ticket) return;
    if (await queueStore.save(withoutTicket(stored.duel, ticket), stored.version)) return;
  }
}
