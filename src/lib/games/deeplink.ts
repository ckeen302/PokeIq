import { parseSeed, parseVs } from "@/lib/race/deeplink";
import { EVENT_IDS, eventOf, isEventId, type EventId } from "./events";
import { MAX_NATIONS, NATION_SIZE, NATION_TYPES, type NationSpec } from "./games";

/**
 * Links into the PokéIQ Games. Client-safe and unit-tested.
 *
 * - /lab/games: the hub (single events, the Games, records, head to head).
 * - /lab/games/<event>: an event with its default line-up.
 * - /lab/games/run?e=<event>&vs=pikachu,snorlax,…&seed=7&rain=1: a shared
 *   run with its own title and preview card: your field (1 to 8; two make
 *   a head to head), the day (the seed replays it exactly), rain (Swift
 *   Swim).
 * - /lab/games/play?n=fire,water,x-pikachu.raichu.pichu&seed=7: the Games,
 *   up to eight nations: a type, or a built team of three (x-a.b.c).
 * - /lab/games/records/<event>: the records; /lab/games/pokemon/<key>: one
 *   Pokémon's results in every event.
 */

export const GAMES_PATH = "/lab/games";
export const PLAY_PATH = `${GAMES_PATH}/play`;
export const RECORDS_PATH = `${GAMES_PATH}/records`;
export const MAX_FIELD = 8;

export const eventPath = (id: EventId) => `${GAMES_PATH}/${id}`;
export const recordsPath = (id: EventId) => `${RECORDS_PATH}/${id}`;
export const pokemonPath = (key: string) => `${GAMES_PATH}/pokemon/${key}`;

export interface EventLink {
  keys?: string[];
  seed?: number | null;
  rain?: boolean;
}

export const RUN_PATH = `${GAMES_PATH}/run`;

/** An event's own page, or (with a field, a seed or rain) a shared run: /lab/games/run?e=<event>&vs=…&seed=…&rain=1. */
export function eventRunPath(id: EventId, o: EventLink = {}): string {
  const q: string[] = [];
  if (o.keys?.length) q.push(`vs=${o.keys.slice(0, MAX_FIELD).join(",")}`);
  if (o.seed != null) q.push(`seed=${o.seed}`);
  if (o.rain) q.push("rain=1");
  return q.length ? `${RUN_PATH}?e=${id}&${q.join("&")}` : eventPath(id);
}

/** A field from ?vs= (known keys, each once, at most eight; names read case-insensitively). */
export const parseField = (raw: string | null | undefined, known: (key: string) => boolean) => parseVs(raw, known);
export const parseGamesSeed = parseSeed;
export const parseRain = (raw: string | null | undefined) => raw === "1" || raw === "true";
export const parseEvent = (raw: string | null | undefined): EventId | null => (raw && isEventId(raw) ? raw : null);

export function nationToken(s: NationSpec): string {
  return "type" in s ? s.type : `x-${s.keys.join(".")}`;
}

export function playPath(specs: NationSpec[], seed?: number | null, rain?: boolean): string {
  const q = [`n=${specs.slice(0, MAX_NATIONS).map(nationToken).join(",")}`];
  if (seed != null) q.push(`seed=${seed}`);
  if (rain) q.push("rain=1");
  return `${PLAY_PATH}?${q.join("&")}`;
}

/** Nations from ?n=: type names and built teams (x-a.b.c, known keys only), each type once, at most eight. */
export function parseNations(raw: string | null | undefined, known: (key: string) => boolean): NationSpec[] {
  if (!raw) return [];
  const out: NationSpec[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    if (p.startsWith("x-")) {
      const keys = parseVs(p.slice(2).replace(/\./g, ","), known).filter((k) => !seen.has(k)).slice(0, NATION_SIZE);
      if (!keys.length) continue;
      keys.forEach((k) => seen.add(k));
      out.push({ keys });
    } else if (NATION_TYPES.includes(p) && !seen.has(`type:${p}`)) {
      seen.add(`type:${p}`);
      out.push({ type: p });
    }
    if (out.length === MAX_NATIONS) break;
  }
  return out;
}

/** The default Games: eight type nations. */
export const DEFAULT_NATIONS: NationSpec[] = ["fire", "water", "grass", "electric", "dragon", "fighting", "psychic", "steel"].map((type) => ({ type }));

/** A head to head's question: "Can Snorlax out-lift Machamp?" */
export function h2hQuestion(id: EventId, a: string, b: string): string {
  switch (eventOf(id).kind) {
    case "sprint": return `Can ${a} outrun ${b}?`;
    case "jump": return id === "high-jump" ? `Can ${a} jump higher than ${b}?` : `Can ${a} out-jump ${b}?`;
    case "throw": return `Can ${a} out-throw ${b}?`;
    case "lift": return `Can ${a} out-lift ${b}?`;
    case "swim": return `Can ${a} out-swim ${b}?`;
    case "wrestle": return `Can ${a} push ${b} out of the ring?`;
    default: return `${a} or ${b}: who's the better all-rounder?`;
  }
}

export const ALL_EVENT_PATHS = EVENT_IDS.map(eventPath);
