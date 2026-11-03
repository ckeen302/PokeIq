/**
 * Camera moves for the film: smooth paths through keyed poses (a cubic
 * Hermite spline with time-scaled tangents, so the camera never jerks at a
 * key and eases to rest at the ends), the lens widened for tall screens,
 * and the free look (orbit and zoom within limits that keep the relief
 * figures facing the camera). Plain math, unit-tested.
 */

export type Vec3 = [number, number, number];

export interface Pose {
  pos: Vec3;
  look: Vec3;
  /** Vertical field of view (degrees) as designed for a 16:9 screen. */
  fov: number;
  /** Roll (radians). */
  roll?: number;
}

export interface Key extends Pose {
  /** Anim time (s). */
  t: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function hermite(p0: number, m0: number, p1: number, m1: number, u: number, h: number): number {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1;
}

/** Interpolates one channel of keyed values at time t (tangents: finite differences; zero at the ends). */
function channel(keys: Key[], get: (k: Key) => number, t: number): number {
  const n = keys.length;
  if (n === 1 || t <= keys[0].t) return get(keys[0]);
  if (t >= keys[n - 1].t) return get(keys[n - 1]);
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const h = Math.max(1e-6, b.t - a.t);
  const tangent = (j: number) => {
    if (j <= 0 || j >= n - 1) return 0;
    const prev = keys[j - 1], next = keys[j + 1];
    return (get(next) - get(prev)) / Math.max(1e-6, next.t - prev.t);
  };
  const u = (t - a.t) / h;
  return hermite(get(a), tangent(i), get(b), tangent(i + 1), u, h);
}

/** The camera at time t on a keyed path. */
export function poseOnPath(keys: Key[], t: number): Pose {
  if (!keys.length) throw new Error("world-history: an empty camera path");
  const ch = (f: (k: Key) => number) => channel(keys, f, t);
  return {
    pos: [ch((k) => k.pos[0]), ch((k) => k.pos[1]), ch((k) => k.pos[2])],
    look: [ch((k) => k.look[0]), ch((k) => k.look[1]), ch((k) => k.look[2])],
    fov: ch((k) => k.fov),
    roll: ch((k) => k.roll ?? 0),
  };
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
export const smooth = (k: number) => {
  const x = clamp(k, 0, 1);
  return x * x * (3 - 2 * x);
};

export function blendPose(a: Pose, b: Pose, k: number): Pose {
  const e = smooth(k);
  return { pos: lerp3(a.pos, b.pos, e), look: lerp3(a.look, b.look, e), fov: lerp(a.fov, b.fov, e), roll: lerp(a.roll ?? 0, b.roll ?? 0, e) };
}

/**
 * The field of view for the actual screen: a tall screen (a phone, a 9:16
 * video) widens the lens so most of what a 16:9 frame holds side to side
 * still fits, without the fish-eye a full match would need.
 */
export function fovFor(fov16x9: number, aspect: number): number {
  const design = 16 / 9;
  if (aspect >= design) return fov16x9;
  const half = (fov16x9 * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(half) * design);
  const keepWidth = (2 * Math.atan(Math.tan(hHalf) / aspect) * 180) / Math.PI;
  return clamp(lerp(fov16x9, keepWidth, 0.62), fov16x9, 88);
}

// ---------------------------------------------------------------------------
// Free look
// ---------------------------------------------------------------------------

export interface Orbit {
  target: Vec3;
  /** Around the target (radians; 0 looks from +z toward −z). */
  yaw: number;
  /** Above the horizon (radians). */
  pitch: number;
  dist: number;
  fov: number;
}

export interface OrbitLimits {
  /** Centre of the allowed yaw (the side the figures face) and how far either way. */
  yaw0: number;
  yawSpan: number;
  minPitch: number;
  maxPitch: number;
  minDist: number;
  maxDist: number;
}

export const DEFAULT_LIMITS: OrbitLimits = { yaw0: 0, yawSpan: 1.15, minPitch: -0.25, maxPitch: 1.2, minDist: 2, maxDist: 400 };

/** Wraps an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

export function clampOrbit(o: Orbit, l: OrbitLimits): Orbit {
  const dy = clamp(wrapAngle(o.yaw - l.yaw0), -l.yawSpan, l.yawSpan);
  return { ...o, yaw: l.yaw0 + dy, pitch: clamp(o.pitch, l.minPitch, l.maxPitch), dist: clamp(o.dist, l.minDist, l.maxDist) };
}

export function orbitPose(o: Orbit): Pose {
  const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
  return {
    pos: [o.target[0] + Math.sin(o.yaw) * cp * o.dist, o.target[1] + sp * o.dist, o.target[2] + Math.cos(o.yaw) * cp * o.dist],
    look: [...o.target] as Vec3,
    fov: o.fov,
  };
}

/** The orbit that reproduces a pose (to take over from the film camera without a jump). */
export function orbitFrom(p: Pose, l: OrbitLimits = DEFAULT_LIMITS): Orbit {
  const dx = p.pos[0] - p.look[0], dy = p.pos[1] - p.look[1], dz = p.pos[2] - p.look[2];
  const dist = Math.max(1e-3, Math.hypot(dx, dy, dz));
  return clampOrbit({ target: [...p.look] as Vec3, yaw: Math.atan2(dx, dz), pitch: Math.asin(clamp(dy / dist, -1, 1)), dist, fov: p.fov }, l);
}

/** Drag: pixels across and up turn the camera around its target. */
export function orbitBy(o: Orbit, dxPx: number, dyPx: number, viewH: number, l: OrbitLimits = DEFAULT_LIMITS): Orbit {
  const k = (Math.PI * 1.1) / Math.max(200, viewH);
  return clampOrbit({ ...o, yaw: o.yaw - dxPx * k, pitch: o.pitch + dyPx * k }, l);
}

/** Zoom by a factor (>1 moves in). */
export function zoomBy(o: Orbit, factor: number, l: OrbitLimits = DEFAULT_LIMITS): Orbit {
  return clampOrbit({ ...o, dist: o.dist / Math.max(0.05, factor) }, l);
}

/** A wheel event as a zoom factor: a mouse notch (~100 px) zooms about 12%; a trackpad pinch (ctrl + wheel, small deltas) tracks the fingers. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  const k = ctrlKey ? 0.012 : 0.0012;
  return Math.exp(-clamp(px, -400, 400) * k);
}
