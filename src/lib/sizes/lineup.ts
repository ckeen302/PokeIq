import { COMPARE_MAX, compareOk } from "./deeplink";
import { DEFAULT_PRESET, PRESET_BY_ID, compareLineup, presetLineup } from "./presets";
import { HEIGHT_ORDER, inOrder, orderCompare, orderTitle, type Order } from "./order";
import { type SizeItem } from "./types";
import { foldLetters } from "@/lib/names/fold";

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

/** The line in an order (Height, smallest first, by default): the preset picks the figures, the order sorts them. */
export function lineFor(spec: LineSpec, all: SizeItem[], order: Order = HEIGHT_ORDER): SizeItem[] {
  const byKey = new Map(all.map((i) => [i.key, i]));
  if (compareOk(spec.vs.length)) return compareLineup(spec.vs.flatMap((k) => byKey.get(k) ?? []), all, order);
  const base = presetLineup(PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET, all, order);
  const have = new Set(base.map((i) => i.key));
  // A form opened by link joins the line only where it has a value in the order.
  const extras = spec.extra.flatMap((k) => (!have.has(k) && byKey.has(k) && inOrder(byKey.get(k)!, order) ? [byKey.get(k)!] : []));
  return extras.length ? [...base, ...extras].sort(orderCompare(order)) : base;
}

/** The video's hook for a comparison: "Wailord vs Eternatus 😳" (in another order, "…, by Speed 😳"). */
export function compareHook(items: SizeItem[], order: Order = HEIGHT_ORDER): string {
  const names = items.filter((i) => i.kind !== "ref").map((i) => i.name);
  return orderTitle(names.length ? `${names.join(" vs ")} 😳` : "Pokémon by size 😳", order);
}

/** Folds case and accents: "Flabébé" → "flabebe". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Pokémon and forms matching a search (by name, Dex number or "#25"):
 * exact names first, then names that start with it, then the rest; default
 * forms before their Megas and Gigantamax forms. References are left out.
 * `alt` (pages in another language): other names each figure answers to (its
 * English name, rōmaji), matched in any script.
 */
export function searchItems(all: SizeItem[], query: string, limit = 8, alt?: Map<string, string[]>): SizeItem[] {
  const f = alt ? foldLetters : fold;
  const q = f(query.trim()).replace(/^#/, "");
  if (!q) return [];
  const num = /^\d+$/.test(q) ? Number(q) : null;
  const scored: { i: SizeItem; s: number }[] = [];
  for (const i of all) {
    if (i.kind === "ref") continue;
    let s = -1;
    if (num !== null) s = i.species === num ? (i.kind === "pokemon" ? 0 : 1) : -1;
    else {
      for (const n of alt ? [i.name, ...(alt.get(i.key) ?? [])] : [i.name]) {
        const name = f(n);
        const m = name === q ? 0 : name.startsWith(q) ? 2 : name.split(/[\s-]+/).some((w) => w.startsWith(q)) ? 3 : name.includes(q) ? 4 : -1;
        if (m >= 0 && (s < 0 || m < s)) s = m;
      }
    }
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
