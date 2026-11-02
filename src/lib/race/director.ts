import type { Camera } from "./broadcast";
import { LANE_W, laneCentre, OUTER_R, X0, KERB_R, type Distance } from "./track";

/**
 * Where each broadcast camera stands and what it frames, as plain math
 * (unit-tested). Every shot looks at the runners from the front or three
 * quarters (the relief figures are flat edge-on), with focal lengths like a
 * real athletics broadcast: long lenses on the rail and head-on cameras,
 * wider ones at the start and the line.
 */

export type Vec3 = [number, number, number];

export interface CamPose {
  pos: Vec3;
  target: Vec3;
  /** Vertical field of view (degrees). */
  fov: number;
}

/** What the director needs of a runner at an instant. */
export interface Spot {
  lane: number;
  x: number;
  y: number;
  z: number;
  /** Running direction (unit, ground plane). */
  dx: number;
  dz: number;
  /** Race distance covered (m) and speed (m/s). */
  s: number;
  v: number;
  /** Figure size (m). */
  w: number;
  h: number;
}

export interface DirectorContext {
  distance: Distance;
  /** Viewport width / height. */
  aspect: number;
  /** Lane in focus (intros, a chased straggler). */
  lane?: number;
  /** The field's start spots (for the crane and marks shots). */
  starts: Spot[];
}

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (k: number) => { const t = clamp(k, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** Vertical FOV that fits `width` metres across and `height` metres up at `dist` metres, for this aspect. */
export function fovToFit(width: number, height: number, dist: number, aspect: number, min = 6, max = 70): number {
  const d = Math.max(0.5, dist);
  const byH = 2 * Math.atan(height / 2 / d);
  const byW = 2 * Math.atan(Math.tan(Math.atan(width / 2 / d)) / Math.max(0.2, aspect));
  return clamp(Math.max(byH, byW) / DEG, min, max);
}

/** Typical figure height in the field (the median, capped so one giant doesn't push every shot back). */
export function fieldHeight(spots: Spot[]): number {
  if (!spots.length) return 1;
  const hs = spots.map((s) => s.h).sort((a, b) => a - b);
  return clamp(hs[Math.floor(hs.length / 2)], 0.35, 3.2);
}

/** Middle of the field across the lanes (z of the occupied lanes' centre on the home straight). */
export function fieldMidZ(spots: Spot[]): number {
  if (!spots.length) return laneCentre(4.5);
  const lanes = spots.map((s) => s.lane);
  return (laneCentre(Math.min(...lanes)) + laneCentre(Math.max(...lanes))) / 2;
}

/** Lateral span of the occupied lanes plus room for the figures (m). */
export function fieldSpan(spots: Spot[]): number {
  if (!spots.length) return 8 * LANE_W;
  const lanes = spots.map((s) => s.lane);
  const wide = Math.max(...spots.map((s) => Math.max(s.w, s.h * 0.6)));
  return (Math.max(...lanes) - Math.min(...lanes) + 1) * LANE_W + Math.min(8, wide);
}

export function leader(spots: Spot[]): Spot {
  return spots.reduce((a, b) => (b.s > a.s ? b : a), spots[0]);
}

/** The pack around the leader: runners within `gap` metres of it. */
export function pack(spots: Spot[], gap = 7): Spot[] {
  const l = leader(spots);
  const near = spots.filter((s) => l.s - s.s <= gap);
  return near.length ? near : [l];
}

const centroid = (ss: Spot[]): Vec3 => {
  const n = Math.max(1, ss.length);
  return [ss.reduce((a, s) => a + s.x, 0) / n, ss.reduce((a, s) => a + s.y, 0) / n, ss.reduce((a, s) => a + s.z, 0) / n];
};

/** Outward normal of a running direction (towards the stands: +z on the home straight). */
const outward = (dx: number, dz: number): [number, number] => [-dz, dx];

/** Rotates a ground vector by `a` radians (counter-clockwise seen from above, +x towards −z). */
function rot(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

export function cameraFor(cam: Camera, k: number, spots: Spot[], ctx: DirectorContext): CamPose {
  const H = fieldHeight(spots);
  const zMid = fieldMidZ(spots);
  const span = fieldSpan(spots);
  const portrait = ctx.aspect < 0.9;
  switch (cam) {
    case "crane": {
      const c = centroid(ctx.starts);
      const e = ease(k);
      const from: Vec3 = [-38, 74, 150];
      const fromT: Vec3 = [4, 0, 6];
      const [ox, oz] = ctx.distance === 100 ? [18, 15] : rot(14, 0, 0);
      const to: Vec3 = ctx.distance === 100 ? [c[0] + ox, 4 + H, c[2] + oz] : [c[0] + 4, 9 + H, c[2] + (c[2] >= 0 ? 22 : -22)];
      const toT: Vec3 = [c[0], 0.5 * H, c[2]];
      const pos = lerp3(from, to, e);
      const target = lerp3(fromT, toT, ease(Math.min(1, k * 1.15)));
      return { pos, target, fov: lerp(portrait ? 62 : 46, portrait ? 52 : 34, e) };
    }
    case "intro": {
      const r = spots.find((s) => s.lane === ctx.lane) ?? spots[0];
      const h = Math.max(0.5, r.h);
      const [nx, nz] = outward(r.dx, r.dz);
      const a = (38 + 8 * k) * DEG;
      const ux = r.dx * Math.cos(a) + nx * Math.sin(a), uz = r.dz * Math.cos(a) + nz * Math.sin(a);
      const D = (2.4 + 2.3 * h) * (1 - 0.08 * k) * (portrait ? 1.25 : 1);
      const target: Vec3 = [r.x, r.y + 0.5 * h, r.z];
      const pos: Vec3 = [r.x + ux * D, r.y + 0.42 * h + 0.25, r.z + uz * D];
      return { pos, target, fov: fovToFit(Math.max(r.w, h) * 1.9, h * 1.9, D, ctx.aspect, 10, 60) };
    }
    case "marks": {
      const c = centroid(ctx.starts);
      const d = ctx.starts[0] ?? spots[0];
      const [nx, nz] = outward(d.dx, d.dz);
      const spread = Math.max(...ctx.starts.map((s) => Math.hypot(s.x - c[0], s.z - c[2])), span / 2);
      const D = (13 + spread * 1.2) * (1 - 0.06 * k) * (portrait ? 1.35 : 1);
      const a = 34 * DEG;
      const ux = d.dx * Math.cos(a) + nx * Math.sin(a), uz = d.dz * Math.cos(a) + nz * Math.sin(a);
      const pos: Vec3 = [c[0] + ux * D, 1.6 + 0.9 * H, c[2] + uz * D];
      const target: Vec3 = [c[0], 0.45 * H, c[2]];
      return { pos, target, fov: fovToFit(span + spread * 1.2, H * 2.2, D, ctx.aspect, 12, 62) };
    }
    case "rail": {
      const p = pack(spots);
      const l = leader(spots);
      const c = centroid(p);
      // Long lens from the outside rail, a little ahead: the runners at about 55° from head-on.
      const ahead = portrait ? 8 : 11;
      const side = portrait ? 19 : 16;
      const pos: Vec3 = [l.x + ahead, 1.4 + 0.5 * H, zMid + side];
      const target: Vec3 = [(c[0] + l.x) / 2 + 0.3, 0.55 * H, zMid];
      const D = Math.hypot(pos[0] - target[0], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(span * 1.05 + 2, H * 2.4, D, ctx.aspect, 8, 50) };
    }
    case "bend": {
      const p = pack(spots, 9);
      const l = leader(spots);
      const c = centroid(p);
      const cx = l.x >= 0 ? X0 : -X0;
      const onBend = Math.abs(l.x) > X0 - 0.01;
      // From the infield, a little ahead of the leader round the bend (running counter-clockwise, the angle about the bend's centre falls).
      const ang = Math.atan2(l.z, l.x - cx);
      const a2 = ang - 30 * DEG;
      const R = KERB_R - 12;
      const [nx, nz] = outward(l.dx, l.dz);
      const pos: Vec3 = onBend ? [cx + R * Math.cos(a2), 2.4 + 0.6 * H, R * Math.sin(a2)] : [l.x + l.dx * 13 - nx * 13, 2.4 + 0.6 * H, l.z + l.dz * 13 - nz * 13];
      const target: Vec3 = [c[0], 0.5 * H, c[2]];
      const D = Math.hypot(pos[0] - target[0], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(span * 1.2 + 3, H * 2.4, D, ctx.aspect, 10, 55) };
    }
    case "wide": {
      const p = pack(spots, 12);
      const l = leader(spots);
      const c = centroid(p);
      const [nx, nz] = outward(l.dx, l.dz);
      const pos: Vec3 = [l.x + l.dx * 16 + nx * 26, 15, l.z + l.dz * 16 + nz * 26];
      const target: Vec3 = [c[0], 0.4 * H, c[2]];
      const D = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(span * 1.6 + 6, H * 3, D, ctx.aspect, 10, 50) };
    }
    case "headon": {
      const p = pack(spots, 10);
      const c = centroid(p);
      const pos: Vec3 = [X0 + 30, 1.25 + 0.35 * H, zMid];
      const target: Vec3 = [Math.min(c[0], X0 + 6), 0.55 * H, zMid];
      const D = Math.max(6, pos[0] - target[0]);
      return { pos, target, fov: fovToFit(span * 1.08, H * 2.1, D, ctx.aspect, 5, 55) };
    }
    case "line": {
      const pos: Vec3 = [X0 + 4.5, 5 + 1.2 * H, OUTER_R + 12 + 2 * H];
      const target: Vec3 = [X0 - 2.2, 0.45 * H, zMid - 0.4];
      const D = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(span * 1.25 + 4, H * 2.6, D, ctx.aspect, 14, 60) };
    }
    case "winner":
    case "chase": {
      const r = spots.find((s) => s.lane === ctx.lane) ?? leader(spots);
      const h = Math.max(0.5, r.h);
      const [nx, nz] = outward(r.dx, r.dz);
      const D = 3.5 + 3.2 * h;
      const pos: Vec3 = [r.x + r.dx * D * 0.62 + nx * D * 0.78, r.y + 0.8 + 0.6 * h, r.z + r.dz * D * 0.62 + nz * D * 0.78];
      const target: Vec3 = [r.x + r.dx * 0.3, r.y + 0.5 * h, r.z + r.dz * 0.3];
      return { pos, target, fov: fovToFit(Math.max(r.w, h) * 2.6, h * 2.6, D, ctx.aspect, 10, 60) };
    }
    case "replay": {
      const pos: Vec3 = [X0 + 5.2 - 1.2 * k, 0.55 + 0.32 * H, zMid + 8.5 + 1.5 * H];
      const target: Vec3 = [X0 - 0.6, 0.5 * H, zMid - 0.3];
      const D = Math.hypot(pos[0] - target[0], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(span * 0.95, H * 2.2, D, ctx.aspect, 10, 60) };
    }
    case "results": {
      const a = (-30 + 50 * k) * DEG;
      const R = 34;
      const pos: Vec3 = [X0 + 6 + R * Math.sin(a), 15, zMid + R * Math.cos(a)];
      const target: Vec3 = [X0 + 8, 0.5, zMid - 2];
      return { pos, target, fov: portrait ? 60 : 42 };
    }
  }
}

/** A smooth blend between two poses (for cuts that dissolve and for the free camera taking over). */
export function blendPose(a: CamPose, b: CamPose, k: number): CamPose {
  const e = ease(k);
  return { pos: lerp3(a.pos, b.pos, e), target: lerp3(a.target, b.target, e), fov: lerp(a.fov, b.fov, e) };
}
