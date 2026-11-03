import { FILL_W, FILL_W_PORTRAIT } from "./glide";
import { PLAZA_MARGIN, ROOF_Y, STRAIGHT, TOWER_H, type LinePath, type PathPoint, type Ring } from "./world";

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

/** The lens a pose is drawn with: vertical field of view (degrees) and width / height. */
export interface Frame {
  vfov: number;
  aspect: number;
}

/** What the finale is composed for when no lens is given: a landscape screen. */
const LANDSCAPE: Frame = { vfov: 35, aspect: 16 / 9 };

/**
 * Shares of the frame the finale keeps clear: the page's top bar and bottom
 * controls, and a little at the sides; a tall frame (a phone, the videos)
 * keeps more of its bottom for the caption and the platforms' own text.
 */
export const FINALE_MARGIN = { top: 0.12, bottom: 0.17, bottomTall: 0.3, side: 0.05 } as const;

/** Half-width of Prism Tower that must stay in the frame (m): its shaft, prism and the upper legs. */
const TOWER_HALF = 30;

/** The plaza's buildings face the tower this far out from the ring (m: world.ts PLAZA_MARGIN, then the ring road), and how much higher than their roofs a sight line must pass (chimneys). */
const RING_WALL = PLAZA_MARGIN + 12;
const ROOF_CLEAR = ROOF_Y + 5;

/** Where the sight line from (fx, fz) towards (cx, cz) first crosses the circle of radius r round (ox, oz), as a share of the way (null if it never leaves it). */
function exitShare(fx: number, fz: number, cx: number, cz: number, ox: number, oz: number, r: number): number | null {
  const ux = cx - fx, uz = cz - fz, px = fx - ox, pz = fz - oz;
  const a = ux * ux + uz * uz, b = 2 * (px * ux + pz * uz), c = px * px + pz * pz - r * r;
  const disc = b * b - 4 * a * c;
  if (a < 1e-9 || disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1 ? t : null;
}

/**
 * The finale round Prism Tower: the camera rises over the rooftops and
 * pulls back from the giant (never turning past the relief-safe angle)
 * until the giant stands in the lower part of the frame and the whole
 * tower rises behind it, prism and spire clear of the frame's top, on any
 * screen: a phone's narrow frame pulls back further. The view then turns
 * and tilts to sit the two inside the frame's clear area, and stays focused
 * on the giant (its distance is the aim's).
 */
function towerFinale(v: View, path: LinePath, ring: Ring, lens: Frame): Pose {
  const at = path.at(v.x);
  const big = smooth01((v.h - 4) / 30);
  // The camera's bearing in the world: the side pose's yaw turned towards the tower, on the line's heading.
  const az = BASE_YAW + FINALE_YAW - cameraHeading(path, v.x, v.d);
  const sa = Math.sin(az), ca = Math.cos(az);
  const tv = Math.tan((lens.vfov * Math.PI) / 360), th = tv * lens.aspect;
  // The clear band of the frame, as angles from its centre (a little inside it: the sides of a wide frame stretch).
  const tall = lens.aspect < 0.8;
  const top = Math.atan((1 - 2 * FINALE_MARGIN.top) * tv * 0.97), bottom = -Math.atan((1 - 2 * (tall ? FINALE_MARGIN.bottomTall : FINALE_MARGIN.bottom)) * tv * 0.97);
  const side = Math.atan((1 - 2 * FINALE_MARGIN.side) * th);
  // The giant's width, from its framing distance (exact for a wide one, generous for a tall one).
  const halfW = v.d * th * (lens.aspect < 0.8 ? FILL_W_PORTRAIT : FILL_W);
  // Up over the rooftops: looking down at the giant's middle at most about 17°.
  const q = 0.12 + 0.17 * big;
  const my = v.h * 0.42;
  const floorY = Math.min(ROOF_Y + 22, v.h * 0.8 + ROOF_Y * big);
  let D = v.d * (1.3 + 0.35 * big);
  let pos: [number, number, number] = [0, 0, 0];
  let aimAz = az, aimEl = -q, focus = D;
  for (let i = 0; i < 80; i++, D *= 1.05) {
    const hx = at.x - D * Math.cos(q) * sa, hz = at.z - D * Math.cos(q) * ca;
    // High enough that the giant's feet show over the buildings round the plaza.
    const wall = exitShare(at.x, at.z, hx, hz, ring.cx, ring.cz, ring.r + RING_WALL);
    const y = Math.max(my + D * Math.sin(q), floorY, wall ? ROOF_CLEAR / wall : 0);
    const dg = Math.max(1e-3, Math.hypot(at.x - hx, at.z - hz)), dt = Math.max(1e-3, Math.hypot(ring.cx - hx, ring.cz - hz));
    // Vertically: from the giant's feet to the tip of the spire (or the giant's head, if it stood taller in the frame).
    const hi = Math.max(Math.atan2(TOWER_H + 4 - y, dt), Math.atan2(v.h - y, dg)), lo = Math.atan2(-y, dg);
    // Across: the giant and the tower, each with its width.
    const ag = Math.atan2(at.x - hx, at.z - hz), at2 = Math.atan2(ring.cx - hx, ring.cz - hz);
    const wg = Math.atan2(halfW, dg), wt = Math.atan2(TOWER_HALF, dt);
    const rel = (a: number) => Math.atan2(Math.sin(a - ag), Math.cos(a - ag));
    const left = Math.min(-wg, rel(at2) - wt), right = Math.max(wg, rel(at2) + wt);
    pos = [hx, y, hz];
    aimAz = ag + (left + right) / 2;
    aimEl = (hi + lo) / 2 - (top + bottom) / 2;
    focus = Math.hypot(dg, y - my);
    if (hi - lo <= top - bottom && right - left <= 2 * side) break;
  }
  const ce = Math.cos(aimEl);
  return { position: pos, target: [pos[0] + Math.sin(aimAz) * ce * focus, pos[1] + Math.sin(aimEl) * focus, pos[2] + Math.cos(aimAz) * ce * focus] };
}

/**
 * The finale's pose. Round Prism Tower (a line with giants): the giant in
 * front of the whole tower, over the rooftops, the city opening out round
 * them (towerFinale). A line of small figures: pulled back and a little up,
 * still nearly face on (the relief figures never turn their edge).
 */
export function finalePose(v: View, path: LinePath = STRAIGHT, lens: Frame = LANDSCAPE): Pose {
  if (path.ring) return towerFinale(v, path, path.ring, lens);
  const at = path.at(v.x);
  const big = smooth01((v.h - 4) / 30);
  // Prism Tower stands past the end of a short line: the camera turns (inside the relief-safe angle) so it rises behind the last figure.
  const toTower = path.tower ? Math.atan2(path.tower.x - at.x, path.tower.z - at.z) : BASE_YAW + FINALE_YAW;
  const yaw = Math.max(BASE_YAW - MAX_ORBIT, Math.min(BASE_YAW + MAX_ORBIT, toTower));
  // Up and back over the rooftops: further and higher the bigger the figure, looking down at most about 17°.
  const pitch = 0.12 + 0.17 * big;
  const D = v.d * (1.3 + 0.75 * big);
  const local: Pose = { target: [v.x, v.h * 0.42, 0], position: [0, 0, 0] };
  const cp = Math.cos(pitch);
  local.position = [v.x - Math.sin(yaw) * cp * D, v.h * 0.42 + Math.sin(pitch) * D, -Math.cos(yaw) * cp * D];
  // Never below the roofs for a big finale (the city must open out), never under a small one's head.
  local.position[1] = Math.max(local.position[1], big > 0 ? Math.min(ROOF_Y + 22, v.h * 0.8 + ROOF_Y * big) : v.h * 0.9);
  return onPath(local, v.x, at, cameraHeading(path, v.x, v.d));
}

const smooth01 = (f: number) => { const k = Math.max(0, Math.min(1, f)); return k * k * (3 - 2 * k); };
const lerp3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The camera for a view, on the line's path (straight when none is given); `lens` is the frame it is drawn in (the finale composes for it). */
export function poseFor(v: View, path: LinePath = STRAIGHT, lens?: Frame): Pose {
  const side = onPath(sidePose(v), v.x, path.at(v.x), cameraHeading(path, v.x, v.d));
  const k = smooth01(v.rise);
  if (k <= 0) return side;
  const fin = finalePose(v, path, lens);
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
