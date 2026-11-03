import { isDistance, type Distance } from "./track";

/**
 * Links into /pokedex/race. Client-safe and unit-tested.
 *
 * - /pokedex/race: the hub, ready to run the Fastest Eight.
 * - /pokedex/race/<preset>: a preset (Shuckle vs Regieleki, Gen 1 final…).
 * - /pokedex/race/run?vs=regieleki,shuckle&d=200: any 2 to 8 Pokémon or
 *   forms over 100, 200 or 400 m, with its own preview card.
 * - /pokedex/race/run?run=starters&d=400: a preset over another distance.
 *   ?vs= (and ?run=) on the hub open the same races.
 */

export const RACE_PATH = "/pokedex/race";
export const RUN_PATH = `${RACE_PATH}/run`;
export const VS_MIN = 2;
export const VS_MAX = 8;
export const HUB_PRESET = "fastest-eight";

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const presetPath = (id: string) => (id === HUB_PRESET ? RACE_PATH : `${RACE_PATH}/${id}`);

export function vsQuery(keys: string[]): string {
  return keys.slice(0, VS_MAX).join(",");
}

/** A custom race's share link. */
export function vsPath(keys: string[], d: Distance): string {
  return `${RUN_PATH}?vs=${vsQuery(keys)}${d !== 100 ? `&d=${d}` : ""}`;
}

/** A preset run over a distance (its default distance needs no parameter on its own page). */
export function presetRunPath(id: string, d: Distance, seed?: number): string {
  return `${RUN_PATH}?run=${id}${d !== 100 ? `&d=${d}` : ""}${seed != null ? `&seed=${seed}` : ""}`;
}

/**
 * The runners a ?vs= list names, in order: known keys only, each once, at
 * most eight. Names are matched case-insensitively and spaces or
 * underscores are read as dashes ("Mr Mime" → "mr-mime").
 */
export function parseVs(raw: string | null | undefined, known: (key: string) => boolean): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,+|]/)) {
    let k = part;
    try { k = decodeURIComponent(part); } catch { /* keep as is */ }
    k = k.trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (!KEY_RE.test(k) || !known(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length === VS_MAX) break;
  }
  return out;
}

export const vsOk = (n: number) => n >= VS_MIN && n <= VS_MAX;

/** ?d=200 → 200; anything else → null. */
export function parseDistance(raw: string | null | undefined): Distance | null {
  const n = Number(raw);
  return raw != null && isDistance(n) ? n : null;
}

/** ?seed=… for a tournament's draw: a whole number, or null. */
export function parseSeed(raw: string | null | undefined): number | null {
  if (raw == null || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

/** Adds a runner to a custom field (no duplicates, the oldest drops off past eight). */
export function pushRunner(keys: string[], key: string): string[] {
  if (keys.includes(key)) return keys;
  const next = [...keys, key];
  return next.length > VS_MAX ? next.slice(next.length - VS_MAX) : next;
}
