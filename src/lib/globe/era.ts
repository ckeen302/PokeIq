/**
 * The globe's era filter: the world as it grew, one generation at a time.
 * A region's generation is the first main-series generation whose games are
 * set there, read from the Pokédex's version table (src/lib/pokemon/
 * encounter-types.ts), so nothing here is typed in by hand. Client-safe.
 */
import { VERSIONS } from "@/lib/pokemon/encounter-types";

export const FIRST_GEN = 1;
export const LAST_GEN = Math.max(...VERSIONS.map((v) => v.gen));

const GEN_OF = new Map<string, number>();
for (const v of VERSIONS) for (const r of v.regions) GEN_OF.set(r, Math.min(GEN_OF.get(r) ?? Infinity, v.gen));

/** The generation a region first appeared in, or null when no main-series version lists it. */
export function regionGeneration(region: string): number | null {
  return GEN_OF.get(region) ?? null;
}

/** Every region the version table knows, oldest first. */
export function regionsByGeneration(): { region: string; gen: number }[] {
  return [...GEN_OF].map(([region, gen]) => ({ region, gen })).sort((a, b) => a.gen - b.gen || a.region.localeCompare(b.region));
}

/** The regions on the globe at an era (a generation): every region from that generation or before. */
export function regionsAt(era: number, regions: readonly string[]): string[] {
  return regions.filter((r) => {
    const g = regionGeneration(r);
    return g !== null && g <= era;
  });
}

/**
 * How much of a region shows while the era slides between generations
 * (`era` may be fractional mid-animation): 0 before its generation, 1 from
 * it on, and a linear fade-in across the step that adds it. A region with no
 * known generation always shows.
 */
export function eraVisibility(regionGen: number | null, era: number): number {
  if (regionGen === null) return 1;
  return Math.max(0, Math.min(1, era - regionGen + 1));
}

/** Clamps a requested era (a URL value, a key press) to a whole generation. */
export function clampEra(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(FIRST_GEN, Math.min(LAST_GEN, n)) : LAST_GEN;
}

export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
