/**
 * A regulation 400 m running track (World Athletics' standard track): two
 * 84.39 m straights joined by semicircular bends with a 36.5 m inner
 * radius, 8 lanes of 1.22 m (lines included). Pure and unit-tested.
 *
 * Distances are measured along each lane's measurement line: 0.30 m
 * outside the kerb in lane 1 (radius 36.80 m, so lane 1 is exactly
 * 400.00 m) and 0.20 m outside the lane's inner line in the others. The
 * 200 m and 400 m starts are staggered so every lane runs the same
 * distance; the 100 m is run on the home straight, extended past the bend
 * to its start. All races finish on the common finish line at the end of
 * the home straight.
 *
 * World coordinates (metres, y up): the infield is centred on the origin,
 * the straights run along x, the home straight is on the +z side and
 * runners on it run towards +x, counter-clockwise seen from above (the
 * infield on their left). The finish line is at x = STRAIGHT / 2.
 */

export const STRAIGHT = 84.39;
export const KERB_R = 36.5;
export const LANE_W = 1.22;
export const LANES = 8;
export const X0 = STRAIGHT / 2;
/** Outer edge of lane 8. */
export const OUTER_R = KERB_R + LANES * LANE_W;
export const DISTANCES = [100, 200, 400] as const;
export type Distance = (typeof DISTANCES)[number];
export const isDistance = (d: number): d is Distance => (DISTANCES as readonly number[]).includes(d);
/** Run-out beyond the finish line on the home straight (m). */
export const RUN_OUT = 30;

/** Radius of a lane's measurement line on the bends. */
export function measureRadius(lane: number): number {
  return lane <= 1 ? KERB_R + 0.3 : KERB_R + LANE_W * (lane - 1) + 0.2;
}

/** Radius of the middle of a lane, where runners are drawn. */
export const laneCentre = (lane: number) => KERB_R + LANE_W * (lane - 0.5);

/** One lap of a lane along its measurement line (m). */
export const lapLength = (lane: number) => 2 * STRAIGHT + 2 * Math.PI * measureRadius(lane);

/** How far ahead of lane 1 a lane starts (m along its own line), so all lanes run the same distance. */
export function stagger(lane: number, distance: Distance): number {
  if (distance === 100) return 0;
  const bends = distance === 200 ? 1 : 2;
  return bends * Math.PI * (measureRadius(lane) - measureRadius(1));
}

export interface TrackPoint {
  x: number;
  z: number;
  /** Running direction (unit vector in the ground plane). */
  dx: number;
  dz: number;
  /** On a bend: the bend's centre side (1 = turning left). */
  bend: boolean;
}

/**
 * A point on a lane's loop at loop distance u from the finish line,
 * counter-clockwise (bend 1, back straight, bend 2, home straight),
 * drawn at radius `r` on the bends (the lane's middle), while u is
 * measured along the lane's measurement line (radius `rm`).
 */
export function loopPoint(u: number, rm: number, r: number): TrackPoint {
  const L = 2 * STRAIGHT + 2 * Math.PI * rm;
  let s = ((u % L) + L) % L;
  const bend = Math.PI * rm;
  if (s < bend) {
    const a = s / rm;
    return { x: X0 + r * Math.sin(a), z: r * Math.cos(a), dx: Math.cos(a), dz: -Math.sin(a), bend: true };
  }
  s -= bend;
  if (s < STRAIGHT) return { x: X0 - s, z: -r, dx: -1, dz: 0, bend: false };
  s -= STRAIGHT;
  if (s < bend) {
    const a = s / rm;
    return { x: -X0 - r * Math.sin(a), z: -r * Math.cos(a), dx: -Math.cos(a), dz: Math.sin(a), bend: true };
  }
  s -= bend;
  return { x: -X0 + s, z: r, dx: 1, dz: 0, bend: false };
}

/**
 * Where a runner in `lane` is after covering `s` metres of a `distance`
 * race (the lane's middle). Past the line it runs on straight into the
 * run-out.
 */
export function lanePoint(lane: number, distance: Distance, s: number): TrackPoint {
  const r = laneCentre(lane);
  if (s >= distance) return { x: X0 + (s - distance), z: r, dx: 1, dz: 0, bend: false };
  if (distance === 100) return { x: X0 - 100 + Math.max(0, s), z: r, dx: 1, dz: 0, bend: false };
  const rm = measureRadius(lane);
  const L = lapLength(lane);
  return loopPoint(L - distance + Math.max(0, s), rm, r);
}

/** The start of a lane for a race (its staggered start line). */
export const startPoint = (lane: number, distance: Distance) => lanePoint(lane, distance, 0);

/** The 100 m start line's x (the home straight extended past bend 2). */
export const START_100_X = X0 - 100;

/**
 * PokéIQ Stadium's bowl: the stands' barrier is a superellipse
 * |x/A|^N + |z/B|^N = 1 round the track (with room for the 100 m start and
 * the run-out on the home straight).
 */
export const BOWL = { A: 112, B: 57, N: 2.6 } as const;

/** The barrier's distance from the long axis at x (m): where the apron ends and the stands begin. */
export function barrierZ(x: number): number {
  const k = Math.min(0.999, Math.abs(x) / BOWL.A);
  return BOWL.B * Math.pow(1 - Math.pow(k, BOWL.N), 1 / BOWL.N);
}
