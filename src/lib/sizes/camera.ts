import { ROOF_Y, STRAIGHT, type LinePath, type PathPoint } from "./world";

/**
 * The camera rig of /pokedex/sizes, as plain math (unit-tested): from where
 * the glide is on the line (x), how far back it stands (d) and the framed
 * figure's height, to a camera position and the point it looks at. The
 * camera looks across the boulevard and a little down it, towards Prism
 * Tower; figures face it. Holds add a small orbit (±20° at most) so the
 * relief shows, and the finale rises over the rooftops to reveal the round
 * city, Prism Tower behind the giant. Exploring, the visitor may orbit a
 * little further (ORBIT_LIMIT): past about 30° a relief figure starts to
 * show its edge. Every pose is worked out as if the line ran straight
 * along x, then laid on the line's path (lib/sizes/world: down the
 * boulevard, then round the tower), so the camera follows the line round
 * the plaza with the same framing.
 */

export const BASE_YAW = (36 * Math.PI) / 180;
/** Play's orbit at a hold (and the finale's): the relief shows, the figure still faces the lens. */
export const MAX_ORBIT = (20 * Math.PI) / 180;
/** The most any camera orbits round a figure (the visitor's own limit in Explore). */
export const ORBIT_LIMIT = (28 * Math.PI) / 180;

export interface View {
  /** Point on the line the camera frames (m). */
  x: number;
  /** Distance from the camera to the framed point (m). */
  d: number;
  /** Height of the framed figure (m): the camera aims at its middle. */
  h: number;
  /** Extra yaw around the framed figure (radians, clamped to ±ORBIT_LIMIT). */
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
  const yaw = BASE_YAW + Math.max(-ORBIT_LIMIT, Math.min(ORBIT_LIMIT, v.orbit));
  const target: [number, number, number] = [v.x, v.h * 0.5, 0];
  const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const dx = Math.sin(yaw) * cp, dy = -sp, dz = Math.cos(yaw) * cp;
  let y = target[1] - dy * v.d;
  // Never under the pavement: keep a little air below the lens.
  y = Math.max(y, Math.min(0.06, v.h * 0.25) + 0.012);
  return { position: [target[0] - dx * v.d, y, target[2] - dz * v.d], target };
}

/** Extra yaw of the finale (inside MAX_ORBIT, so the relief figures still face the lens): towards the tower, so it stands behind the giant. */
export const FINALE_YAW = (-16 * Math.PI) / 180;

/**
 * The heading the camera turns by at s: the path's own, eased over a stretch
 * that grows with the camera's distance, so where the boulevard meets the
 * ring the camera starts its turn smoothly rather than all at once (on the
 * straight and round the ring it is exactly the path's).
 */
export function cameraHeading(path: LinePath, s: number, d: number): number {
  if (!path.ring) return 0;
  const step = Math.max(2, Math.min(80, d * 0.3));
  const w = [1, 4, 6, 4, 1];
  let h = 0;
  for (let k = -2; k <= 2; k++) h += path.at(s + k * step).heading * w[k + 2];
  return h / 16;
}

/** A pose worked out along a straight line (target on x = s, z = 0) laid on the path at s, turned by `heading`. */
function onPath(p: Pose, s: number, at: PathPoint, heading = at.heading): Pose {
  const c = Math.cos(heading), sn = Math.sin(heading);
  const put = (q: [number, number, number]): [number, number, number] => {
    const dx = q[0] - s, dz = q[2];
    return [at.x + dx * c - dz * sn, q[1], at.z + dx * sn + dz * c];
  };
  return { position: put(p.position), target: put(p.target) };
}

/**
 * The finale's pose: pulled back and up over the rooftops, so the city
 * opens out round the giant: with a ring, the aim drifts towards Prism
 * Tower so the tower, the ring of giants and the avenues beyond stand in
 * the frame with it, seen from above but still nearly face on (the relief
 * figures never turn their edge).
 */
export function finalePose(v: View, path: LinePath = STRAIGHT): Pose {
  const at = path.at(v.x);
  const big = smooth01((v.h - 4) / 30);
  const yaw = BASE_YAW + FINALE_YAW;
  // Up and back over the rooftops: further and higher the bigger the giant, looking down at most about 17°.
  const pitch = 0.12 + 0.17 * big;
  const D = v.d * (1.3 + 0.75 * big);
  const local: Pose = { target: [v.x, v.h * 0.42, 0], position: [0, 0, 0] };
  const cp = Math.cos(pitch);
  local.position = [v.x - Math.sin(yaw) * cp * D, v.h * 0.42 + Math.sin(pitch) * D, -Math.cos(yaw) * cp * D];
  // Never below the roofs for a big finale (the city must open out), never under a small one's head.
  local.position[1] = Math.max(local.position[1], big > 0 ? Math.min(ROOF_Y + 22, v.h * 0.8 + ROOF_Y * big) : v.h * 0.9);
  const pose = onPath(local, v.x, at, cameraHeading(path, v.x, v.d));
  if (path.ring) {
    // Both ends of the sight line drift towards the tower, keeping the camera's direction.
    const k = 0.32 * big;
    const dx = (path.ring.cx - pose.target[0]) * k, dz = (path.ring.cz - pose.target[2]) * k;
    // The aim also lifts, so Prism Tower's crown stands clear in the sky over the giant's head.
    pose.target = [pose.target[0] + dx, pose.target[1] + v.h * 0.42 * big, pose.target[2] + dz];
    pose.position = [pose.position[0] + dx, pose.position[1], pose.position[2] + dz];
  }
  return pose;
}

const smooth01 = (f: number) => { const k = Math.max(0, Math.min(1, f)); return k * k * (3 - 2 * k); };
const lerp3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The camera for a view, on the line's path (straight when none is given). */
export function poseFor(v: View, path: LinePath = STRAIGHT): Pose {
  const side = onPath(sidePose(v), v.x, path.at(v.x), cameraHeading(path, v.x, v.d));
  const k = smooth01(v.rise);
  if (k <= 0) return side;
  const fin = finalePose(v, path);
  if (k >= 1) return fin;
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
