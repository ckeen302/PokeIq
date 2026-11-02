import { COMPARE_MAX, compareOk } from "./deeplink";
import { DEFAULT_PRESET, PRESET_BY_ID, compareLineup, presetLineup } from "./presets";
import { bySize, type SizeItem } from "./types";

/**
 * Which line /pokedex/sizes shows, from what the page was opened with (a
 * preset, a Pokémon's own page, a ?vs= comparison) and what was searched
 * since. Client-safe and unit-tested.
 */

export interface LineSpec {
  /** Preset id (the main page is "every-pokemon"). */
  preset: string;
  /** A comparison (2–6 keys) replaces the preset's line. */
  vs: string[];
  /** Forms opened by link or search that the preset doesn't hold (a Mega on the full line). */
  extra: string[];
}

export function lineFor(spec: LineSpec, all: SizeItem[]): SizeItem[] {
  const byKey = new Map(all.map((i) => [i.key, i]));
  if (compareOk(spec.vs.length)) return compareLineup(spec.vs.flatMap((k) => byKey.get(k) ?? []), all);
  const base = presetLineup(PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET, all);
  const have = new Set(base.map((i) => i.key));
  const extras = spec.extra.flatMap((k) => (!have.has(k) && byKey.has(k) ? [byKey.get(k)!] : []));
  return extras.length ? [...base, ...extras].sort(bySize) : base;
}

/** The video's hook for a comparison: "Wailord vs Eternatus 😳". */
export function compareHook(items: SizeItem[]): string {
  const names = items.filter((i) => i.kind !== "ref").map((i) => i.name);
  return names.length ? `${names.join(" vs ")} 😳` : "Pokémon by size 😳";
}

/** Folds case and accents: "Flabébé" → "flabebe". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Pokémon and forms matching a search (by name, Dex number or "#25"):
 * exact names first, then names that start with it, then the rest; default
 * forms before their Megas and Gigantamax forms. References are left out.
 */
export function searchItems(all: SizeItem[], query: string, limit = 8): SizeItem[] {
  const q = fold(query.trim()).replace(/^#/, "");
  if (!q) return [];
  const num = /^\d+$/.test(q) ? Number(q) : null;
  const scored: { i: SizeItem; s: number }[] = [];
  for (const i of all) {
    if (i.kind === "ref") continue;
    const name = fold(i.name);
    let s = -1;
    if (num !== null) s = i.species === num ? (i.kind === "pokemon" ? 0 : 1) : -1;
    else if (name === q) s = 0;
    else if (name.startsWith(q)) s = 2;
    else if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) s = 3;
    else if (name.includes(q)) s = 4;
    if (s < 0) continue;
    if (i.kind !== "pokemon") s += 0.5;
    scored.push({ i, s });
  }
  scored.sort((a, b) => a.s - b.s || a.i.species - b.i.species || a.i.name.localeCompare(b.i.name));
  return scored.slice(0, limit).map((x) => x.i);
}

/** Adds a key to a comparison, dropping the oldest when it is full. */
export function pushCompare(keys: string[], key: string): string[] {
  if (keys.includes(key)) return keys;
  const next = [...keys, key];
  return next.length > COMPARE_MAX ? next.slice(next.length - COMPARE_MAX) : next;
}
