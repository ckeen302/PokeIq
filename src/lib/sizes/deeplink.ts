/**
 * Links into /pokedex/sizes. Client-safe.
 *
 * - /pokedex/sizes: the full line (the "Every Pokémon" preset).
 * - /pokedex/sizes/<preset>: a preset's line (Legendaries, Starters…).
 * - /pokedex/sizes/<pokemon>: the full line, flown to that Pokémon or form.
 * - /pokedex/sizes/compare?vs=wailord,eternatus: 2 to 6 side by side, with
 *   its own preview card. ?vs= on any of the pages above opens the same
 *   comparison.
 */

export const SIZES_PATH = "/pokedex/sizes";
export const COMPARE_PATH = `${SIZES_PATH}/compare`;
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 6;
export const EVERY_PRESET = "every-pokemon";

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const itemPath = (key: string) => `${SIZES_PATH}/${key}`;
export const presetPath = (id: string) => (id === EVERY_PRESET ? SIZES_PATH : `${SIZES_PATH}/${id}`);
export const compareQuery = (keys: string[]) => keys.slice(0, COMPARE_MAX).join(",");
export const comparePath = (keys: string[]) => `${COMPARE_PATH}?vs=${compareQuery(keys)}`;

/**
 * The figures a ?vs= list names, in order: known keys only, each once, at
 * most COMPARE_MAX. Names are matched case-insensitively and spaces or
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
    if (out.length === COMPARE_MAX) break;
  }
  return out;
}

/** Whether a comparison of `n` figures is allowed (2 to 6). */
export const compareOk = (n: number) => n >= COMPARE_MIN && n <= COMPARE_MAX;

/** Adds a figure to a comparison (no duplicates, at most 6). */
export function addToCompare(keys: string[], key: string): string[] {
  if (keys.includes(key) || keys.length >= COMPARE_MAX) return keys;
  return [...keys, key];
}
