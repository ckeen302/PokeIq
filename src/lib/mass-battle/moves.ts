import type { MBMove } from "./types";

/**
 * Small move helpers shared by the roster builder (server) and the
 * simulation (browser workers).
 */

/** Expected number of hits of one use (2–5 hits land 2, 3, 4 or 5 times 35/35/15/15% of the time). */
export function expectedHits(hits: [number, number] | null): number {
  if (!hits) return 1;
  if (hits[0] === 2 && hits[1] === 5) return 3.1;
  return (hits[0] + hits[1]) / 2;
}

export const expectedHitsOf = (mv: Pick<MBMove, "hits">) => expectedHits(mv.hits);
