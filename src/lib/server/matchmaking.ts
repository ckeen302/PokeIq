import "server-only";
import { z } from "zod";
import { createDuel, duelToken, isDuelMap, joinDuel as joinGeoDuel, readyDuel as readyGeoDuel } from "./duel";
import { pvpToken, type PvpFailure } from "./duel-core";
import { deleteDuel, insertDuel, newDuelCode, pvpStore } from "./duel-store";
import { joinDuel, readyDuel } from "./duels";
import { createPokedleDuel } from "./pokedle-duel";
import { createWhoamiDuel } from "./whoami-duel";
import { whoamiAbilitySchema, whoamiSettingsSchema } from "./whoami-schema";
import { normalizeSettings } from "./whoami";
import { WHOAMI_ABILITIES, type WhoamiAbility } from "@/lib/whoami";
import { cancelQueue, searchQueue, type OpenedGame } from "./match-queue";
import { RANKED_QUEUE_KEY, cancelRankedQueue, searchRankedQueue, type RankedSeat } from "./ranked-queue";
import type { RatingState } from "@/lib/ranked";
import { pvpHref } from "@/lib/pvp-types";
import { DLE_ASSISTS, DLE_DEFAULT_ASSIST } from "@/lib/dle-assist";

/**
 * Matchmaking for duels: trainers searching for the same game with the same
 * settings are paired into a duel, no link needed. The queue itself (one
 * row per game and settings, compare-and-swap, the freshness rule) is
 * shared with battles: see match-queue.ts.
 */

export {
  MATCH_FRESH_MS,
  emptyQueue,
  newTicket,
  planSearch,
  seatNames,
  withPair,
  withWaiter,
  withoutTicket,
  type QueueRow,
  type SearchPlan,
  type Waiter,
} from "./match-queue";

/**
 * What can be matched: PokéGuessr on any map, and Pokédle on every
 * generation (a duel with picked generations is one you invite a friend
 * to), one casual queue per Pokédex assist level so both trainers play
 * with the same one. Ranked is one queue, always the Notebook: its
 * `assist` is ignored.
 */
export const matchSettingsSchema = z.discriminatedUnion("game", [
  z.object({ game: z.literal("geo"), region: z.string().max(20).refine(isDuelMap, "Unknown map.") }),
  z.object({ game: z.literal("pokedle"), ranked: z.boolean().optional(), assist: z.enum(DLE_ASSISTS).optional() }),
  // Who Am I?: one queue per pool (generations, legendaries); the ability is the trainer's own and pairs with any.
  whoamiSettingsSchema.extend({ game: z.literal("whoami"), ability: whoamiAbilitySchema.optional() }),
]);
export type MatchSettings = z.infer<typeof matchSettingsSchema>;

/** The queue a search waits in. The Notebook keeps the queue Pokédle had before levels. */
export function queueKey(s: MatchSettings): string {
  if (s.game === "geo") return `geo:${s.region}`;
  if (s.game === "whoami") {
    const w = normalizeSettings(s);
    return `whoami:${w.from}-${w.to}${w.casual ? ":casual" : ""}`;
  }
  if (s.ranked) return RANKED_QUEUE_KEY;
  const assist = s.assist ?? DLE_DEFAULT_ASSIST;
  return assist === DLE_DEFAULT_ASSIST ? "pokedle:all" : `pokedle:all:${assist}`;
}

export type SearchResult =
  | { ok: true; status: "waiting"; ticket: string; since: number }
  | { ok: true; status: "matched"; code: string; token: string; href: string };

const must = <T extends { ok: boolean }>(out: T | PvpFailure): Extract<T, { ok: true }> => {
  if (!out.ok) throw new Error((out as PvpFailure).error);
  return out as Extract<T, { ok: true }>;
};

/**
 * A duel for two matched trainers, stored and under way: both seated and
 * ready, so round 1 starts after the usual countdown. Seat 0 is the trainer
 * who was waiting.
 */
/** A brought trainer ability (from the queue row), if it's one. */
const abilityFrom = (team?: string) => ((WHOAMI_ABILITIES as readonly string[]).includes(team ?? "") ? (team as WhoamiAbility) : undefined);

async function openDuel(settings: MatchSettings, players: [{ name: string; team?: string }, { name: string; team?: string }], now: number): Promise<OpenedGame | null> {
  const names = players.map((p) => p.name) as [string, string];
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newDuelCode();
    if (settings.game === "geo") {
      const { duel, playerId: a } = createDuel(settings.region, names[0], code, now);
      const { duel: joined, playerId: b } = must(joinGeoDuel(duel, names[1], now));
      const ready = must(readyGeoDuel(must(readyGeoDuel(joined, a, true, now)).duel, b, true, now)).duel;
      if (await insertDuel(ready)) return { code, ids: [a, b], remove: () => deleteDuel(code) };
    } else if (settings.game === "whoami") {
      const { duel, playerId: a } = createWhoamiDuel(names[0], code, now, { settings, ability: abilityFrom(players[0].team), queue: "casual" });
      const { duel: joined, playerId: b } = must(joinDuel(duel, names[1], now));
      const second = abilityFrom(players[1].team);
      const picked = second ? { ...joined, abilities: { ...joined.abilities, [b]: second } } : joined;
      const ready = must(readyDuel(must(readyDuel(picked, a, true, now)).duel, b, true, now)).duel;
      if (await pvpStore.insert(ready)) return { code, ids: [a, b], remove: () => pvpStore.remove(code) };
    } else {
      const { duel, playerId: a } = createPokedleDuel(names[0], code, now, undefined, { queue: "casual", assist: settings.assist });
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
    : { ok: true, status: "matched", code, token: pvpToken(code, playerId), href: pvpHref(settings.game, code) };
}

/**
 * A search (or the next poll of one): paired, or waiting. `ticket` is the
 * search's own; a first search passes a new one.
 */
export async function searchMatch(settings: MatchSettings, name: string, ticket: string): Promise<SearchResult | PvpFailure> {
  // A Who Am I? trainer brings their ability (it waits with them in the queue).
  const bring = settings.game === "whoami" && settings.ability ? () => ({ ok: true as const, team: settings.ability }) : undefined;
  const out = await searchQueue(queueKey(settings), { ticket, name, bring }, (players, now) => openDuel(settings, players, now));
  if (!out.ok || out.status === "waiting") return out;
  return seat(settings, out.code, out.playerId);
}

/** Gives up a search. */
export function cancelMatch(settings: MatchSettings, ticket: string): Promise<void> {
  return settings.game === "pokedle" && settings.ranked ? cancelRankedQueue(ticket) : cancelQueue(queueKey(settings), ticket);
}

// ---------------------------------------------------------------------------
// Ranked
// ---------------------------------------------------------------------------

/** A ranked Pokédle duel for two matched trainers (every generation), stored and under way. Seat 0 is the trainer who was waiting. */
async function openRankedDuel(players: [RankedSeat, RankedSeat], now: number): Promise<OpenedGame | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newDuelCode();
    const ranked = {
      keys: [players[0].player, players[1].player] as [string, string],
      ratings: [players[0].rating, players[1].rating] as [number, number],
      games: [players[0].games, players[1].games] as [number, number],
    };
    const { duel, playerId: a } = createPokedleDuel(players[0].name, code, now, undefined, { queue: "ranked", ranked });
    const { duel: joined, playerId: b } = must(joinDuel(duel, players[1].name, now));
    const ready = must(readyDuel(must(readyDuel(joined, a, true, now)).duel, b, true, now)).duel;
    if (await pvpStore.insert(ready)) return { code, ids: [a, b], remove: () => pvpStore.remove(code) };
  }
  return null;
}

/**
 * A ranked search (or its next poll) by the trainer whose rating key is
 * `player`: paired by rating, or waiting. `rating` reads their rating when
 * it's needed (it throws RankedUnavailable before the migration).
 */
export async function searchRankedMatch(name: string, ticket: string, player: string, rating: () => Promise<RatingState>): Promise<SearchResult | PvpFailure> {
  const out = await searchRankedQueue({ ticket, name, player }, rating, openRankedDuel);
  if (!out.ok || out.status === "waiting") return out;
  return seat({ game: "pokedle", ranked: true }, out.code, out.playerId);
}
