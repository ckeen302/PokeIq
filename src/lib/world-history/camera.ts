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
  /** The camera comes to rest at this key and leaves it gently (a weighted hold), instead of flowing through. */
  stop?: boolean;
  /** Partial weight (0 flows through … 1 like stop): eases in to and out of the key. */
  ease?: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function hermite(p0: number, m0: number, p1: number, m1: number, u: number, h: number): number {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1;
}

/** Keys closer than this are a cut: the camera jumps, and neither side's curve leans on the other. */
export const CUT_GAP = 0.4;

/** Interpolates one channel of keyed values at time t (tangents: finite differences; zero at the ends; one-sided at a cut). */
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
    const prev = keys[j - 1], cur = keys[j], next = keys[j + 1];
    const w = cur.stop ? 0 : 1 - clamp(cur.ease ?? 0, 0, 1);
    if (w <= 0) return 0;
    const before = cur.t - prev.t > CUT_GAP, after = next.t - cur.t > CUT_GAP;
    if (before && after) return (w * (get(next) - get(prev))) / Math.max(1e-6, next.t - prev.t);
    if (before) return (w * (get(cur) - get(prev))) / (cur.t - prev.t);
    if (after) return (w * (get(next) - get(cur))) / (next.t - cur.t);
    return 0;
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
// Camera language: handheld drift, orbit arcs, and shots joined by cuts
// ---------------------------------------------------------------------------

/**
 * A slight handheld drift for intimate beats: slow layered sways of the
 * camera and its aim (never periodic to the eye), scaled by the distance
 * to what it looks at, so a close-up and a wide shot breathe alike.
 * `k` 0 is locked off, 1 a gentle operator, 2 nervous.
 */
export function handheld(p: Pose, t: number, k: number, seed = 0): Pose {
  if (k <= 0) return p;
  const d = Math.max(0.5, Math.hypot(p.pos[0] - p.look[0], p.pos[1] - p.look[1], p.pos[2] - p.look[2]));
  const n = (f: number, o: number) => Math.sin(t * f + o + seed) * 0.6 + Math.sin(t * f * 2.31 + o * 1.7 + seed * 1.3) * 0.3 + Math.sin(t * f * 5.13 + o * 0.6) * 0.1;
  const a = 0.004 * d * k, b = 0.006 * d * k;
  return {
    ...p,
    pos: [p.pos[0] + n(0.71, 0.2) * a, p.pos[1] + n(0.93, 1.9) * a * 0.7, p.pos[2] + n(0.57, 3.1) * a * 0.5],
    look: [p.look[0] + n(0.63, 4.4) * b, p.look[1] + n(0.81, 2.6) * b * 0.8, p.look[2] + n(0.49, 5.3) * b * 0.4],
    roll: (p.roll ?? 0) + n(0.44, 0.9) * 0.0035 * k,
  };
}

/**
 * Keys for an arc around a point (a crane or orbit reveal): from angle a0
 * to a1 (radians about y, 0 looking from +z), rising from y0 to y1, over
 * t0 → t1, weighted at both ends.
 */
export function arcKeys(o: { center: Vec3; radius: [number, number]; y: [number, number]; angle: [number, number]; t: [number, number]; fov: [number, number]; look?: Vec3; steps?: number }): Key[] {
  const n = Math.max(2, o.steps ?? 5);
  const out: Key[] = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const e = smooth(k);
    const a = lerp(o.angle[0], o.angle[1], e), r = lerp(o.radius[0], o.radius[1], e);
    out.push({
      t: lerp(o.t[0], o.t[1], k),
      pos: [o.center[0] + Math.sin(a) * r, lerp(o.y[0], o.y[1], e), o.center[2] + Math.cos(a) * r],
      look: o.look ?? o.center,
      fov: lerp(o.fov[0], o.fov[1], e),
      stop: i === 0 || i === n - 1,
    });
  }
  return out;
}

/** How a shot begins. */
export type ShotEnter = "cut" | "match" | "whip" | "dip";

export interface Shot {
  /** Anim time the shot begins (the first shot's is ignored). */
  at: number;
  /** Its own camera path (or a function of anim time). */
  keys: Key[] | ((t: number) => Pose);
  /**
   * "cut": a hard cut. "match": a hard cut with a breath of light on the
   * frame (for cuts whose shapes rhyme). "whip": a whip-pan, the outgoing
   * shot swings away and the incoming one swings in, smeared. "dip": a
   * quick dip through black.
   */
  enter?: ShotEnter;
  /** Length of the whip or dip (s; default 0.34 and 0.5). */
  span?: number;
  /** Which way the whip swings (1 turns left about y, −1 right; default toward where the next shot looks). */
  dir?: 1 | -1;
}

export interface ShotFx {
  /** A whip smear for the Look (screen direction and strength). */
  whip?: { dir: [number, number]; k: number };
  /** A fade (0..1) and a flash (0..1) to add to the Look. */
  fade: number;
  flash: number;
  /** The index of the shot on screen. */
  shot: number;
}

const yawOf = (p: Pose) => Math.atan2(p.look[0] - p.pos[0], p.look[2] - p.pos[2]);
function turned(p: Pose, ang: number): Pose {
  const dx = p.look[0] - p.pos[0], dz = p.look[2] - p.pos[2];
  const c = Math.cos(ang), s = Math.sin(ang);
  return { ...p, look: [p.pos[0] + dx * c + dz * s, p.look[1], p.pos[2] - dx * s + dz * c] };
}

/**
 * A sequence of shots: each its own path, joined by hard cuts, match cuts,
 * whip-pans or dips (instead of always fading). `pose(t)` is the camera;
 * `fx(t)` what to add to the chapter's look at that moment (the whip's
 * smear, a dip's fade, a match cut's flash).
 */
export function shots(list: Shot[]) {
  if (!list.length) throw new Error("world-history: no shots");
  const at = (s: Shot, t: number): Pose => (typeof s.keys === "function" ? s.keys(t) : poseOnPath(s.keys, t));
  const index = (t: number) => {
    let i = 0;
    while (i < list.length - 1 && t >= list[i + 1].at) i++;
    return i;
  };
  const whipDir = (i: number) => {
    const s = list[i];
    if (s.dir) return s.dir;
    const a = at(list[i - 1], s.at), b = at(s, s.at);
    return wrapAngle(yawOf(b) - yawOf(a)) >= 0 ? 1 : -1;
  };
  function pose(t: number): Pose {
    const i = index(t);
    const next = list[i + 1];
    if (next?.enter === "whip") {
      const w = (next.span ?? 0.34) / 2;
      if (t > next.at - w) {
        const k = (t - (next.at - w)) / w;
        return turned(at(list[i], t), whipDir(i + 1) * 0.9 * k * k);
      }
    }
    const cur = list[i];
    if (i > 0 && cur.enter === "whip") {
      const w = (cur.span ?? 0.34) / 2;
      if (t < cur.at + w) {
        const k = 1 - (t - cur.at) / w;
        return turned(at(cur, t), -whipDir(i) * 0.9 * k * k);
      }
    }
    return at(cur, t);
  }
  function fx(t: number): ShotFx {
    const i = index(t);
    const out: ShotFx = { fade: 0, flash: 0, shot: i };
    for (let j = 1; j < list.length; j++) {
      const s = list[j];
      const d = t - s.at;
      if (s.enter === "whip") {
        const w = (s.span ?? 0.34) / 2;
        if (Math.abs(d) < w) {
          const k = 1 - Math.abs(d) / w;
          out.whip = { dir: [whipDir(j), 0], k: k * k };
        }
      } else if (s.enter === "dip") {
        const w = (s.span ?? 0.5) / 2;
        if (Math.abs(d) < w) out.fade = Math.max(out.fade, smooth(1 - Math.abs(d) / w));
      } else if (s.enter === "match" && d >= 0 && d < 0.35) {
        out.flash = Math.max(out.flash, 0.16 * (1 - d / 0.35) ** 2);
      }
    }
    return out;
  }
  return { pose, fx, index };
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
