import { Rng } from "@/lib/rng";
import { HUNT_ROUNDS, type HuntEntry, type HuntMapRegionId, type HuntMode } from "./types";

/**
 * Which Pokémon a game deals: pure (the seed decides), so the Daily is the
 * same for everyone and a test can prove the mix.
 *
 * World maps (Classic, the Daily) never deal an `everywhere` entry. Region
 * mode deals entries found in that region, rated by their difficulty on its
 * map. Five rounds: one famous (else from the easiest third), two from the
 * middle third, one from the hardest third, one from anywhere; then played
 * easy → hard. One form of a species at most per game.
 */

export interface DealOptions {
  mode: HuntMode;
  region?: HuntMapRegionId;
  rounds?: number;
  /** Entry ids the player saw lately (most recent first): dealt only when nothing fresher is left. */
  recent?: readonly string[];
}

/** An entry's difficulty for a mode: the world's, or its region map's. */
export function difficultyFor(entry: HuntEntry, mode: HuntMode, region?: HuntMapRegionId): number {
  if (mode === "region" && region) return entry.regionDifficulty[region] ?? entry.difficulty;
  return entry.difficulty;
}

/** The entries a mode can deal at all. */
export function eligible(entries: readonly HuntEntry[], mode: HuntMode, region?: HuntMapRegionId): HuntEntry[] {
  if (mode === "region") return region ? entries.filter((e) => e.regions.includes(region)) : [];
  return entries.filter((e) => !e.everywhere);
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
  const plan: (readonly HuntEntry[])[] = [famous.length ? famous : easy, middle, middle, hard, sorted];
  for (let i = 0; i < rounds; i++) {
    const want = plan[i] ?? sorted;
    if (!take(want)) take(sorted);
  }
  return picked.sort((a, b) => diff(a) - diff(b));
}
