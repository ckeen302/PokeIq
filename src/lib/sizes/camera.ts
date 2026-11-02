/**
 * The camera rig of /pokedex/sizes, as plain math (unit-tested): from where
 * the glide is on the line (x), how far back it stands (d) and the framed
 * figure's height, to a camera position and the point it looks at. The
 * camera looks across the boulevard and a little down it, towards Prism
 * Tower; figures face it. Holds add a small orbit (±20° at most) so the
 * relief shows, and the finale lifts the camera over the rooftops.
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

export function poseFor(v: View): Pose {
  // The finale swings round to look down the boulevard (the whole line, the plaza, the tower), climbing over the rooftops.
  const rise = Math.max(0, Math.min(1, v.rise));
  const yaw = BASE_YAW + Math.max(-MAX_ORBIT, Math.min(MAX_ORBIT, v.orbit)) + rise * ((24 * Math.PI) / 180);
  const pitch = v.pitch + rise * 0.17;
  const d = v.d * (1 + 0.85 * rise);
  const ty = v.h * (0.5 - 0.2 * rise);
  const target: [number, number, number] = [v.x - rise * v.d * 0.35, ty, 0];
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const dx = Math.sin(yaw) * cp, dy = -sp, dz = Math.cos(yaw) * cp;
  let y = target[1] - dy * d;
  // Never under the pavement: keep a little air below the lens.
  y = Math.max(y, Math.min(0.06, v.h * 0.25) + 0.012);
  return { position: [target[0] - dx * d, y, target[2] - dz * d], target };
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
