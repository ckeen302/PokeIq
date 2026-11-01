import { firstDate, yearFrac, type TimelineRaw } from "./types";

/**
 * Derives the species ids on timeline entries from data already in the repo,
 * so none are typed by hand: starters from src/data/quiz/games/starters.json,
 * box legendaries from box-art.json (kept only if the Pokédex marks the
 * species legendary or mythical), and names/slugs resolved against
 * src/data/pokedex.json. Used by scripts/timeline-data.ts and its test.
 */

export interface DexRow {
  id: number;
  slug: string;
  name: string;
  gen: number;
  legendary: boolean;
  mythical: boolean;
}
export interface StarterRow {
  game: string;
  grass: string;
  fire: string;
  water: string;
}
export interface BoxRow {
  game: string;
  species: string;
}

export function deriveSpecies(e: TimelineRaw, dex: DexRow[], starters: StarterRow[], box: BoxRow[]): { starters?: number[]; legendaries?: number[] } {
  const byName = new Map(dex.map((p) => [p.name, p]));
  const bySlug = new Map(dex.map((p) => [p.slug, p]));
  const need = <T,>(v: T | undefined, what: string): T => {
    if (v === undefined) throw new Error(`${e.id}: unknown ${what}`);
    return v;
  };
  const out: { starters?: number[]; legendaries?: number[] } = {};
  const b = e.basis;
  if (!b) return out;
  if (b.starters) {
    const row = need(starters.find((s) => s.game === b.starters), `starter game "${b.starters}"`);
    out.starters = [row.grass, row.fire, row.water].map((n) => need(byName.get(n), `species "${n}"`).id);
  } else if (b.starter_slugs) {
    out.starters = b.starter_slugs.map((s) => need(bySlug.get(s), `species "${s}"`).id);
  }
  const boxSpecies = b.box
    ? b.box.map((g) => need(box.find((r) => r.game === g), `box-art game "${g}"`).species).map((n) => need(byName.get(n), `species "${n}"`))
    : (b.box_slugs ?? []).map((s) => need(bySlug.get(s), `species "${s}"`));
  const legend = [...new Set(boxSpecies.filter((p) => p.legendary || p.mythical).map((p) => p.id))];
  if (legend.length) out.legendaries = legend;
  return out;
}

/** The generation era a date falls in: the last generation opener released on or before it. */
export function generationAt(t: number, openers: { generation: number; t: number }[]): number {
  let gen = 1;
  for (const o of [...openers].sort((a, b) => a.t - b.t)) if (o.t <= t) gen = o.generation;
  return gen;
}

export const LANE_ORDER = ["games", "spinoffs", "anime", "movies", "tcg", "events"] as const;

/** Chronological by first release, then by lane, then by id: the order the JSON is kept in. */
export function compareEntries(a: TimelineRaw, b: TimelineRaw): number {
  return yearFrac(firstDate(a)) - yearFrac(firstDate(b)) || LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || a.id.localeCompare(b.id);
}
