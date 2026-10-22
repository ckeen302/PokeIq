/** PokéGuessr's Look around: flipping through a place's screenshots, like moving in Street View. */
import type { GeoRoundPublic } from "./geo-types";

/** A round's views: the place's screenshots (the dealt one first), or just the dealt one. */
export const roundViewsOf = (round: Pick<GeoRoundPublic, "shot" | "views">): string[] => (round.views?.length ? round.views : [round.shot]);

/** The view `delta` steps from `index`, wrapping around both ends. */
export function stepView(index: number, delta: number, count: number): number {
  if (count <= 1) return 0;
  return (((index + delta) % count) + count) % count;
}

/** The step a key makes: ← and → (and , and . for one hand), or null. */
export function viewKeyStep(key: string): -1 | 1 | null {
  if (key === "ArrowLeft" || key === ",") return -1;
  if (key === "ArrowRight" || key === ".") return 1;
  return null;
}

/** "View 2 of 5", for the counter and screen readers. */
export const viewLabel = (index: number, count: number) => `View ${index + 1} of ${count}`;
