import { KERB_R, X0 } from "@/lib/race/track";
import { JAVELIN, SHOT, SWIM } from "./constants";

/**
 * Where everything stands, in metres (y up), shared by the 3D venues and by
 * the camera and motion maths. The stadium is the Race's (lib/race/track:
 * the infield is centred on the origin, the straights run along x, the
 * main stand is on the +z side); the field events are laid out in its
 * infield, each shown only during its own event. The indoor arena and the
 * aquatics centre are their own rooms, each centred on the origin.
 */

/** Long jump: a runway along the home side of the infield, run towards +x; the board's pit edge is the foul line. */
export const LJ = {
  z: 25,
  /** The foul line (the board's edge nearest the pit). */
  line: 2,
  boardW: 0.2,
  runwayW: 1.22,
  /** Run-up start (m before the line). */
  back: 45,
  /** The pit: its near end 1 m past the line, 9 m long, 2.9 m wide. */
  pitStart: 3,
  pitLength: 9,
  pitW: 2.9,
} as const;

/** High jump: in the west D. The bar runs along z; jumpers cross it towards −x and land on the mat behind it. */
export const HJ = {
  barX: -X0 - 16,
  z: 0,
  /** Bar length (World Athletics: 3.98–4.02 m) and the standards' spacing. */
  barLength: 4.02,
  /** The mat (behind the bar): 6 m along the bar, 4 m deep, 0.7 m tall. */
  matW: 6,
  matD: 4,
  matH: 0.7,
  /** The apron's radius (the fan of tartan the jumpers approach on). */
  apron: 22,
} as const;

/** Shot put: the circle in the east D, throwing towards −x along the infield. */
export const SP = {
  x: X0 + 14,
  z: 0,
  r: SHOT.circle / 2,
  /** The sector's half-angle (rad). */
  half: ((SHOT.sector / 2) * Math.PI) / 180,
} as const;

/**
 * Javelin: the arc (radius 8 m) near the east end of the infield, the
 * runway running back from it over the track (as in many stadiums), so
 * the longest throws (just over 105 m) still land on the infield's grass
 * rather than in the west D. Throwing towards −x.
 */
export const JT = {
  /** The arc's centre and its front (the foul line) at centre − 8 m. */
  cx: X0 + 31,
  z: 0,
  r: JAVELIN.arcRadius,
  runway: 24,
  width: 4,
  half: ((JAVELIN.sector / 2) * Math.PI) / 180,
} as const;
export const jtLine = () => JT.cx - JT.r;

/** Indoor arena: the weightlifting platform and the wrestling ring both stand at its centre. */
export const ARENA = {
  /** The IWF competition platform: 4 m square, 10 cm tall. */
  platform: 4,
  platformH: 0.1,
  /** The ring: a raised clay square 6.7 m across, 0.55 m tall; the ring itself (4.55 m) is set in it. */
  dohyo: 6.7,
  dohyoH: 0.55,
  /** The hall: the floor's half-size and the first row of seats. */
  floor: 26,
  seats: 15,
} as const;

/** Aquatics centre: a 50 m pool along x, starts at −x; ten 2.5 m lanes, racing in 1–8. */
export const POOL = {
  length: SWIM.pool,
  width: 25,
  laneW: SWIM.laneWidth,
  depth: SWIM.depth,
  /** The water's surface, the deck around it, the blocks' platforms (0.75 m above the water). */
  water: 0,
  deck: 0.3,
  block: SWIM.block,
  startX: -SWIM.pool / 2,
} as const;

/** Lane L's centre across the pool (z). Lanes 0 and 9 stay empty. */
export const poolLaneZ = (lane: number) => -POOL.width / 2 + POOL.laneW * (lane + 0.5);

/** Where a swimmer's front is along the pool after `x` metres of a race (out, then back after 50 m). */
export function poolX(x: number): { x: number; dir: 1 | -1 } {
  const L = POOL.length;
  const k = Math.max(0, x);
  if (k <= L) return { x: POOL.startX + k, dir: 1 };
  return { x: POOL.startX + L - (k - L), dir: -1 };
}

/** The infield edge on the home side (the kerb), for keeping cameras out of the lanes. */
export const INFIELD_Z = KERB_R;
