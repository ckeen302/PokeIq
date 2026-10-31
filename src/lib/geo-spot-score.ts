import { GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";

/**
 * PokéGuessr exact spots: the round score for a screenshot whose spot on the
 * map is verified (src/data/geo-shot-spots.json). GeoGuessr-like and steep:
 * full marks only within GEO_SPOT_PERFECT_PX map pixels of the spot, then an
 * exponential drop (GEO_SPOT_FALL_PX per factor e). The area's own distance
 * score (the curve every other shot uses) is a floor, capped at
 * GEO_SPOT_FLOOR: a pin in or near the right area but far from the spot gets
 * GEO_SPOT_FLOOR, and a pin far away scores exactly what it would on any
 * other shot.
 *
 * Tuned on the scored routes' drawn lengths (scripts/geo/spots-2d.ts reports
 * them): a typical scored route is about 60 px long on the world map, a
 * screen of it about 9 px. So the perfect radius is about a third of a
 * screen, a pin one screen off keeps about half the points, and one a
 * quarter of the route away is down to the floor.
 */
export const GEO_SPOT_PERFECT_PX = 3;
export const GEO_SPOT_FALL_PX = 9;
export const GEO_SPOT_FLOOR = 2000;

/** Points for a pin `spotPx` map pixels from the spot, given what the area's distance curve gives it. */
export function geoSpotScore(spotPx: number, areaScore: number): number {
  const curve = spotPx <= GEO_SPOT_PERFECT_PX ? GEO_MAX_ROUND_SCORE : Math.round(GEO_MAX_ROUND_SCORE * Math.exp(-(spotPx - GEO_SPOT_PERFECT_PX) / GEO_SPOT_FALL_PX));
  return Math.max(curve, Math.min(areaScore, GEO_SPOT_FLOOR));
}
