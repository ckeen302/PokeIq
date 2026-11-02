import { ROOF_Y } from "./world";

/**
 * The camera rig of /pokedex/sizes, as plain math (unit-tested): from where
 * the glide is on the line (x), how far back it stands (d) and the framed
 * figure's height, to a camera position and the point it looks at. The
 * camera looks across the boulevard and a little down it, towards Prism
 * Tower; figures face it. Holds add a small orbit (±20° at most) so the
 * relief shows, and the finale pulls back to just above the roofline.
 */

export const BASE_YAW = (36 * Math.PI) / 180;
export const MAX_ORBIT = (20 * Math.PI) / 180;

export interface View {
  /** Point on the line the camera frames (m). */
  x: number;
  /** Distance from the camera to the framed point (m). */
  d: number;
  /** Height of the framed figure (m): the camera aims at its middle. */
  h: number;
  /** Extra yaw around the framed figure (radians, clamped to ±MAX_ORBIT). */
  orbit: number;
  /** Downward tilt (radians). */
  pitch: number;
  /** 0..1: the finale's rise over the rooftops. */
  rise: number;
}

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Direction the figures face (towards the camera's side of the boulevard). */
export const FACING = BASE_YAW + Math.PI;

/** The side-on pose: looking across the boulevard (and a little down it) at the framed point. */
function sidePose(v: View): Pose {
  const yaw = BASE_YAW + Math.max(-MAX_ORBIT, Math.min(MAX_ORBIT, v.orbit));
  const target: [number, number, number] = [v.x, v.h * 0.5, 0];
  const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const dx = Math.sin(yaw) * cp, dy = -sp, dz = Math.cos(yaw) * cp;
  let y = target[1] - dy * v.d;
  // Never under the pavement: keep a little air below the lens.
  y = Math.max(y, Math.min(0.06, v.h * 0.25) + 0.012);
  return { position: [target[0] - dx * v.d, y, target[2] - dz * v.d], target };
}

/** Extra yaw of the finale (inside MAX_ORBIT, so the relief figures still face the lens). */
export const FINALE_YAW = (16 * Math.PI) / 180;

/**
 * The finale's pose: pulled back and down to just above the city's roofline,
 * so the giant towers into the sky over the rooftops with Prism Tower
 * behind it, seen a little from below.
 */
export function finalePose(v: View): Pose {
  const yaw = BASE_YAW + FINALE_YAW;
  const D = v.d * 1.06;
  const target: [number, number, number] = [v.x, v.h * 0.46, 0];
  const camY = Math.max(ROOF_Y + 14, v.h * 0.36);
  const dy = target[1] - camY;
  const horiz = Math.sqrt(Math.max(1, D * D - dy * dy));
  return { position: [target[0] - Math.sin(yaw) * horiz, camY, -Math.cos(yaw) * horiz], target };
}

const smooth01 = (f: number) => { const k = Math.max(0, Math.min(1, f)); return k * k * (3 - 2 * k); };
const lerp3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export function poseFor(v: View): Pose {
  const side = sidePose(v);
  const k = smooth01(v.rise);
  if (k <= 0) return side;
  const fin = finalePose(v);
  return { position: lerp3(side.position, fin.position, k), target: lerp3(side.target, fin.target, k) };
}

/**
 * A natural tilt for a figure's height: looking a little down at the
 * smallest (the pavement around them), level for people-sized and bigger
 * ones (so the facades and sky show behind), a little down on giants.
 */
export function pitchFor(h: number): number {
  const lh = Math.log10(Math.max(0.05, h));
  if (lh < 0) return 0.03 + 0.06 * Math.min(1, -lh);
  if (lh < 1) return 0.03 - 0.02 * lh;
  return 0.01 + 0.04 * Math.min(1, lh - 1);
}
