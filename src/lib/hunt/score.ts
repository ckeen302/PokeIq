import { geoCurveScore } from "@/lib/geo-curve";
import { wrapDistance } from "@/lib/geo-wrap";
import { HUNT_MAX_ROUND_SCORE, type HuntRegionId } from "./types";

/**
 * Pokémon Hunt's scoring: pure, so the server grades with it and the tests prove it.
 *
 * One pin a round. It scores against the nearest real spot (the distance to that place's area, 0 inside
 * it) on PokéGuessr's own curve (geoCurveScore): full points within half a town-map square, then
 * `5000 · e^(−10 · d / D)`. D is the diagonal of the nearest spot's region's own map, so a pin is scored
 * exactly as PokéGuessr scores one on that region's map, on the world map too: a pin on the spot earns
 * 5,000, a pin a couple of squares off still most of it, and a pin that only gets the region right very
 * little (the far side of Kanto is a few hundred points). Every distance is in world-map pixels (a region's
 * map is a crop of the world map, so a pixel is the same size on both).
 */

export type Point = [number, number];

/** A real spot as the scorer sees it: its region and its area, in world pixels. */
export interface ScoreSpot {
  region: HuntRegionId;
  area: Point[];
}

export interface ScoreMap {
  /** The curve's length scale for a spot in each region: that region's own map's diagonal, in world pixels. */
  diagonal: (region: HuntRegionId) => number;
  /** Within this many pixels of a spot's area is full points (PokéGuessr's half a town-map square). */
  perfectPx: number;
  /** A town-map square, in pixels: the reveal says how far the pin was in squares, as PokéGuessr does. */
  squarePx: number;
  /** The world map's width in pixels when the map wraps sideways (the whole world's): distances go the short way round. */
  period?: number;
}

/** Pixels from a pin to the nearest point of an area (the short way round a map wrapping every `period` px). */
export function areaDistance(pin: Point, area: readonly Point[], period?: number): number {
  let best = Infinity;
  for (const [x, y] of area) best = Math.min(best, wrapDistance(pin[0], pin[1], x, y, period));
  return best;
}

export interface PinScore {
  /** The nearest spot's region, or null (no pin, or no spot). */
  region: HuntRegionId | null;
  /** Its index in the spots given. */
  spot: number | null;
  /** Pixels to its area (rounded to a tenth; Infinity with no pin). */
  distancePx: number;
  /** The same in town-map squares (a tenth at least, 0 when the pin earned full points). */
  squares: number;
  /** Whole points, before hints. */
  score: number;
}

/** The nearest spot to a pin: its index and the distance to its area (−1 and Infinity with no spots). */
export function nearestSpot(pin: Point, spots: readonly ScoreSpot[], period?: number): { spot: number; px: number } {
  let spot = -1;
  let px = Infinity;
  spots.forEach((s, i) => {
    const d = areaDistance(pin, s.area, period);
    if (d < px) [px, spot] = [d, i];
  });
  return { spot, px };
}

/** Scores one pin (null: the clock ran out with none down) against a Pokémon's spots. */
export function scorePin(map: ScoreMap, pin: Point | null, spots: readonly ScoreSpot[]): PinScore {
  if (!pin || !spots.length) return { region: null, spot: null, distancePx: Infinity, squares: 0, score: 0 };
  const { spot, px } = nearestSpot(pin, spots, map.period);
  const region = spots[spot].region;
  const score = geoCurveScore(px, map.diagonal(region), map.perfectPx, HUNT_MAX_ROUND_SCORE);
  const squares = score === HUNT_MAX_ROUND_SCORE ? 0 : Math.max(0.1, Math.round((px / map.squarePx) * 10) / 10);
  return { region, spot, distancePx: Math.round(px * 10) / 10, squares, score };
}
