/**
 * The whole world's map wraps sideways (GeoGuessr's): its right edge meets its
 * left, so the way between two points across that join is the short one.
 * Everything that measures or draws a guess against an answer on a whole-world
 * map (the server's grading, Pokémon Hunt's spots, the map's lines and camera)
 * goes through these, so the client draws exactly what the server scores.
 *
 * `period` is the map's width in the units given (1 for the 0–1 coordinates
 * of a whole-world map, the width in px for world pixels). A region's map
 * never wraps: pass no period (or 0) and the plain difference comes back.
 */

/** A whole-world map's width in its own 0–1 coordinates. */
export const GEO_WORLD_PERIOD = 1;

/** The signed horizontal step from `a` to `b` the short way round, in (−period/2, period/2]. */
export function wrapDelta(dx: number, period?: number): number {
  if (!period) return dx;
  const d = dx - period * Math.round(dx / period);
  return d === -period / 2 ? period / 2 : d;
}

/** The horizontal gap between two points the short way round: min(|dx|, period − |dx|). */
export function wrapGap(dx: number, period?: number): number {
  if (!period) return Math.abs(dx);
  const a = Math.abs(dx) % period;
  return Math.min(a, period - a);
}

/** `x` moved by whole periods onto the copy nearest `near`. */
export function wrapNear(x: number, near: number, period?: number): number {
  return period ? near + wrapDelta(x - near, period) : x;
}

/** Distance between two points, each axis scaled (a 0–1 map to its pixels), horizontally the short way round. */
export function wrapDistance(ax: number, ay: number, bx: number, by: number, period?: number, sx = 1, sy = 1): number {
  return Math.hypot(wrapGap(ax - bx, period) * sx, (ay - by) * sy);
}
