import "server-only";
import { GAMES_BY_KEY } from "./data";
import { EVENT_IDS, type EventId } from "./events";
import { findMatchups, type Matchup } from "./h2h";
import { FAVOURITES } from "./lineups";
import { DEFAULT_GAMES_SEED } from "./seed";
import type { Athlete } from "./athlete";

/**
 * Example head to heads for the pages, found by running the real events
 * between the best-known Pokémon on the share link's default day (so each
 * link replays the result it was picked for). Worked out once per server.
 */

const POOL: Athlete[] = FAVOURITES.map((k) => GAMES_BY_KEY.get(k)).filter((a): a is Athlete => !!a);
const MARKED: EventId[] = EVENT_IDS.filter((e) => e !== "all-around");

let hub: Matchup[] | null = null;
/** The hub's: the best match-up of each event, the most interesting first. */
export function hubMatchups(): Matchup[] {
  hub ??= findMatchups(POOL, DEFAULT_GAMES_SEED, { events: MARKED, n: 8 });
  return hub;
}

const perEvent = new Map<EventId, Matchup[]>();
/** An event's: its single best match-up among the favourites, then the hub's in other events. */
export function eventMatchups(event: EventId, n = 4): Matchup[] {
  let own = perEvent.get(event);
  if (!own) { own = findMatchups(POOL, DEFAULT_GAMES_SEED, { events: [event], n: 1 }); perEvent.set(event, own); }
  return [...own, ...hubMatchups().filter((m) => m.event !== event)].slice(0, n);
}

/** One Pokémon's: its most interesting match-ups against the favourites. */
export function pokemonMatchups(a: Athlete, n = 4): Matchup[] {
  return findMatchups(POOL, DEFAULT_GAMES_SEED, { events: MARKED, n, with: a });
}

/** The rivals to suggest in the picker: the favourites. */
export const RIVALS = POOL.map((a) => a.key);
