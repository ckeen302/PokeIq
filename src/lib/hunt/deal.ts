import { Rng } from "@/lib/rng";
import { HUNT_REGION_OF_GEO, HUNT_ROUNDS, type HuntDifficulty, type HuntEntry, type HuntMapRegionId, type HuntMode } from "./types";

/**
 * Which Pokémon a game deals: pure (the seed decides), so the Daily is the same for everyone and a test
 * can prove the mix.
 *
 * A round needs a real "where": a Pokémon found in a few distinct places. So a game never deals one
 * found almost everywhere (`everywhere`, or too many spots on a region's map), nor one with a single
 * spot that isn't famous.
 *
 * Normal (and the Daily): one famous (else from the easiest third), two from the middle third, one from
 * the hardest third, one from anywhere. Easy: famous Pokémon in their home region (on a region's map,
 * that region's own). Hard: any of them, at random. Every game is played easy → hard, one form of a
 * species at most.
 */

/** The fewest spots a dealt Pokémon has on the map played (a famous one may have a single spot). */
export const HUNT_MIN_SPOTS = 2;
/** The most spots it has on a region's own map: more and a pin anywhere there scores. */
export const HUNT_MAX_REGION_SPOTS = 12;
/** Map places outside every region's own map (geo.json's crops): they only show on the world map. */
export const HUNT_OFF_CROP = new Set(["Sevii Islands", "Blueberry Academy", "Kitakami"]);

export interface DealOptions {
  mode: HuntMode;
  region?: HuntMapRegionId;
  difficulty?: HuntDifficulty;
  rounds?: number;
  /** Entry ids the player saw lately (most recent first): dealt only when nothing fresher is left. */
  recent?: readonly string[];
}

/** An entry's difficulty for a mode: the world's, or its region map's. */
export function difficultyFor(entry: HuntEntry, mode: HuntMode, region?: HuntMapRegionId): number {
  if (mode === "region" && region) return entry.regionDifficulty[region] ?? entry.difficulty;
  return entry.difficulty;
}

/** How many of an entry's spots are on a region's own map. */
export const spotsOnRegionMap = (entry: HuntEntry, region: HuntMapRegionId): number =>
  entry.places.filter((p) => HUNT_REGION_OF_GEO[p.geoRegion] === region && !HUNT_OFF_CROP.has(p.geoRegion)).length;

/** The entries a mode can deal at all: a few distinct places on the map played. */
export function eligible(entries: readonly HuntEntry[], mode: HuntMode, region?: HuntMapRegionId): HuntEntry[] {
  if (mode === "region") {
    // A region's map only shows its own crop (the Sevii Islands and Blueberry Academy sit outside theirs).
    if (!region) return [];
    return entries.filter((e) => {
      if (e.regionDifficulty[region] === undefined) return false;
      const n = spotsOnRegionMap(e, region);
      return n <= HUNT_MAX_REGION_SPOTS && (n >= HUNT_MIN_SPOTS || !!e.famous);
    });
  }
  return entries.filter((e) => !e.everywhere && (e.places.length >= HUNT_MIN_SPOTS || !!e.famous));
}

/** Easy's Pokémon: famous ones in their home region (on a region's map, only that region's own). */
export function easyPool(entries: readonly HuntEntry[], mode: HuntMode, region?: HuntMapRegionId): HuntEntry[] {
  // A famous Pokémon may live all over (Clefairy): on Easy that's fine, its famous spot is the answer people know.
  if (mode === "region") return region ? entries.filter((e) => e.famous && e.home === region && e.regionDifficulty[region] !== undefined) : [];
  return entries.filter((e) => e.famous && e.home);
}

export function dealHunt(entries: readonly HuntEntry[], seed: string, opts: DealOptions): HuntEntry[] {
  const rounds = opts.rounds ?? HUNT_ROUNDS;
  const rng = new Rng(`hunt:${seed}`);
  const pool = eligible(entries, opts.mode, opts.region);
  const diff = (e: HuntEntry) => difficultyFor(e, opts.mode, opts.region);
  const sorted = [...pool].sort((a, b) => diff(a) - diff(b) || a.id.localeCompare(b.id));
  const third = Math.max(1, Math.ceil(sorted.length / 3));
  const easy = sorted.slice(0, third);
  const middle = sorted.slice(third, third * 2);
  const hard = sorted.slice(third * 2);
  const famous = sorted.filter((e) => e.famous);
  const recent = new Map((opts.recent ?? []).map((id, i) => [id, i] as const));

  const picked: HuntEntry[] = [];
  const species = new Set<number>();
  const take = (from: readonly HuntEntry[]) => {
    const open = from.filter((e) => !species.has(e.dex));
    if (!open.length) return false;
    // Unseen first; among seen ones, the longest ago.
    const freshness = (e: HuntEntry) => (recent.has(e.id) ? recent.get(e.id)! : Infinity);
    const top = Math.max(...open.map(freshness));
    const fresh = open.filter((e) => freshness(e) === top);
    const e = fresh[Math.floor(rng.next() * fresh.length)];
    picked.push(e);
    species.add(e.dex);
    return true;
  };
  const plan: (readonly HuntEntry[])[] =
    opts.difficulty === "easy"
      ? // Famous Pokémon in their home region; then the easiest of the rest if there aren't enough of them.
        Array.from({ length: rounds }, () => easyPool(entries, opts.mode, opts.region).sort((a, b) => diff(a) - diff(b) || a.id.localeCompare(b.id)))
      : opts.difficulty === "hard"
        ? Array.from({ length: rounds }, () => sorted)
        : [famous.length ? famous : easy, middle, middle, hard, sorted];
  for (let i = 0; i < rounds; i++) {
    const want = plan[i] ?? sorted;
    if (!take(want) && !(opts.difficulty === "easy" && take(easy))) take(sorted);
  }
  return picked.sort((a, b) => diff(a) - diff(b));
}
