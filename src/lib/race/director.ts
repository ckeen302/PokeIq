import type { Camera } from "./broadcast";
import { BOWL, LANE_W, barrierZ, laneCentre, X0, KERB_R, type Distance } from "./track";

/**
 * Where each broadcast camera stands and what it frames, as plain math
 * (unit-tested). Every shot looks at the runners from the front or three
 * quarters, where the 3D figures read best (never a pure side view), with
 * focal lengths like a real athletics broadcast: long lenses on the
 * tracking and head-on cameras, wider ones at the start and the line,
 * framed tight on the runners.
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
  /** How far out from the kerb it is drawn (m; negative in the big pool inside the kerb). Default: its lane's middle. */
  across?: number;
  /** Height of its highest point above the track (m; a flier rides above it, a swimmer is mostly under water). Default: h. */
  top?: number;
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

/** How far from the infield's long axis a runner is drawn on the home straight (its lane's middle, or its place in the big pool). */
const radiusOf = (s: Spot) => (s.across == null ? laneCentre(s.lane) : KERB_R + s.across);

/** Middle of the field across the lanes (z of the occupied lanes' centre on the home straight). */
export function fieldMidZ(spots: Spot[]): number {
  if (!spots.length) return laneCentre(4.5);
  const rs = spots.map(radiusOf);
  return (Math.min(...rs) + Math.max(...rs)) / 2;
}

/** Lateral span of the occupied lanes plus room for the figures (m). */
export function fieldSpan(spots: Spot[]): number {
  if (!spots.length) return 8 * LANE_W;
  const rs = spots.map(radiusOf);
  const wide = Math.max(...spots.map((s) => Math.max(s.w, s.h * 0.6)));
  return Math.max(...rs) - Math.min(...rs) + LANE_W + Math.min(8, wide);
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

/** Shots that frame the field: tall runners in them (a giant flier) are kept in the frame, clear of the clock in its top corner. */
const FIELD_SHOTS = new Set<Camera>(["rail", "bend", "wide", "headon", "line", "replay"]);

export function cameraFor(cam: Camera, k: number, spots: Spot[], ctx: DirectorContext): CamPose {
  const pose = shotFor(cam, k, spots, ctx);
  if (ctx.aspect < 0.9 && cam !== "crane") return tallShot(cam, pose, spots, ctx);
  return FIELD_SHOTS.has(cam) ? keepInFrame(pose, spots, ctx.aspect) : pose;
}

/** How much of a tall frame's width and height the subjects may fill, and where their middle sits (share of the height from the top). */
const TALL_W = 0.8, TALL_H = 0.46, TALL_MID = 0.56;

/**
 * Re-aims a camera and sets its lens so the subjects fill a tall frame:
 * their box (as the camera sees it) spans up to most of the width or about
 * half the height, whichever comes first, and sits a little below the
 * middle, clear of the clock. `weights` (0..1 per subject) fade a subject
 * out of the framing smoothly (a runner dropping off the pack) by
 * shrinking it towards the first subject.
 */
export function fillTall(pos: Vec3, subjects: Pick<Spot, "x" | "y" | "z" | "w" | "h" | "top">[], aspect: number, o: { weights?: number[]; minFov?: number; maxFov?: number; fillH?: number } = {}): CamPose {
  const lead = subjects[0];
  const mid = (s: (typeof subjects)[number]): Vec3 => [s.x, s.y + (s.top ?? s.h) * 0.5, s.z];
  const anchor = mid(lead);
  const pts: Vec3[] = [];
  subjects.forEach((s, i) => {
    const w = clamp(o.weights?.[i] ?? 1, 0, 1);
    if (w <= 0) return;
    const top = s.top ?? s.h;
    const half = Math.max(s.w, top * 0.5) * 0.5;
    for (const y of [s.y, s.y + top]) for (const [ox, oz] of [[-half, 0], [half, 0], [0, -half], [0, half], [-half * 0.7, -half * 0.7], [half * 0.7, -half * 0.7], [-half * 0.7, half * 0.7], [half * 0.7, half * 0.7]]) pts.push(lerp3(anchor, [s.x + ox, y, s.z + oz], w));
  });
  let target = anchor;
  let tanV = Math.tan(((o.maxFov ?? 58) * DEG) / 2);
  const lo = Math.tan(((o.minFov ?? 5) * DEG) / 2), hi = tanV;
  for (let pass = 0; pass < 3; pass++) {
    const f: Vec3 = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
    const F: Vec3 = [f[0] / fl, f[1] / fl, f[2] / fl];
    const rl = Math.hypot(F[0], F[2]) || 1;
    const R: Vec3 = [-F[2] / rl, 0, F[0] / rl];
    const U: Vec3 = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const d: Vec3 = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
      const zc = Math.max(0.3, d[0] * F[0] + d[1] * F[1] + d[2] * F[2]);
      const xc = (d[0] * R[0] + d[2] * R[2]) / zc, yc = (d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / zc;
      x0 = Math.min(x0, xc); x1 = Math.max(x1, xc); y0 = Math.min(y0, yc); y1 = Math.max(y1, yc);
    }
    tanV = clamp(Math.max((x1 - x0) / 2 / (TALL_W * aspect), (y1 - y0) / 2 / (o.fillH ?? TALL_H)), lo, hi);
    // Aim at the box's middle, raised so the box sits a little below the frame's middle.
    const ax = (x0 + x1) / 2, ay = (y0 + y1) / 2 + (TALL_MID - 0.5) * 2 * tanV;
    target = [pos[0] + (F[0] + R[0] * ax + U[0] * ay) * fl, pos[1] + (F[1] + R[1] * ax + U[1] * ay) * fl, pos[2] + (F[2] + R[2] * ax + U[2] * ay) * fl];
  }
  return { pos, target, fov: (2 * Math.atan(tanV)) / DEG };
}

/**
 * A tall frame (a phone held upright, a 9:16 video): the cameras come in
 * closer and lower, three quarters from the front, and frame the leader
 * and the runners with it so they fill the frame, instead of fitting every
 * lane across a narrow picture and leaving it half empty track.
 */
function tallShot(cam: Camera, pose: CamPose, spots: Spot[], ctx: DirectorContext): CamPose {
  const H = fieldHeight(spots);
  const l = leader(spots);
  // The leader first, then the others: each counts fully within `gap` metres of the leader, fading out over the next few.
  const group = (gap: number, fade = 4) => {
    const ss = [l, ...spots.filter((s) => s !== l)];
    return { ss, weights: ss.map((s) => 1 - ease((l.s - s.s - gap) / fade)) };
  };
  const [nx, nz] = outward(l.dx, l.dz);
  const from = (ahead: number, out: number, y: number): Vec3 => [l.x + l.dx * ahead + nx * out, y, l.z + l.dz * ahead + nz * out];
  switch (cam) {
    case "intro":
    case "winner":
    case "chase": {
      const r = spots.find((s) => s.lane === ctx.lane) ?? l;
      return fillTall(pose.pos, [r], ctx.aspect, { fillH: cam === "intro" ? 0.42 : 0.4, maxFov: 60 });
    }
    case "marks": {
      const c = centroid(ctx.starts);
      const d = ctx.starts[0] ?? l;
      const [mx, mz] = outward(d.dx, d.dz);
      // Well round to the side and up a little: the lanes stack up the frame instead of across it.
      const D = 7 + 2.2 * H + fieldSpan(ctx.starts) * 0.5;
      const pos: Vec3 = [c[0] + (d.dx * 0.5 + mx * 0.87) * D, 1.1 + 0.8 * H + D * 0.3, c[2] + (d.dz * 0.5 + mz * 0.87) * D];
      return fillTall(pos, spots, ctx.aspect);
    }
    case "rail": {
      const g = group(4);
      const D = 6 + 2.4 * H;
      return fillTall(from(D * 0.8, D * 0.75, 0.9 + 0.7 * H + D * 0.1), g.ss, ctx.aspect, { weights: g.weights });
    }
    case "headon": {
      // Nearly head-on and low, just outside the leader's lane.
      const g = group(2.5, 3);
      const D = 9 + 3 * H;
      return fillTall(from(D, D * 0.22, 0.7 + 0.5 * H), g.ss, ctx.aspect, { weights: g.weights });
    }
    case "bend":
    case "wide": {
      const g = group(5);
      return fillTall(pose.pos, g.ss, ctx.aspect, { weights: g.weights });
    }
    case "line":
    case "replay": {
      // The finish cameras stay where they stand; whoever is coming in (or just through) fills the frame.
      const near = spots.filter((s) => Math.abs(s.x - X0) < 14 || s === l);
      const first = near.reduce((a, b) => (Math.abs(b.x - X0) < Math.abs(a.x - X0) ? b : a), near[0]);
      const ss = [first, ...near.filter((s) => s !== first)];
      return fillTall(pose.pos, ss, ctx.aspect, { weights: ss.map((s) => 1 - ease((Math.abs(s.x - first.x) - 4) / 5)), maxFov: 50 });
    }
    case "results":
      return fillTall(pose.pos, [l, ...spots.filter((s) => s !== l)], ctx.aspect, { weights: spots.map((_, i) => (i === 0 ? 1 : 0.85)), maxFov: 62 });
    default:
      return pose;
  }
}

/**
 * Widens a shot (a little), then pulls the camera back along its line of
 * sight (as far as it must, up to about twice as far), until the tops of
 * the runners it shows (any part of them) sit below the top tenth of the
 * frame and their sides (bar a wingtip) inside it. Small runners stay as big as the shot made them unless
 * a much taller one shares the frame.
 */
export function keepInFrame(pose: CamPose, spots: Spot[], aspect: number): CamPose {
  const t = pose.target;
  const off: Vec3 = [pose.pos[0] - t[0], pose.pos[1] - t[1], pose.pos[2] - t[2]];
  const near = spots;
  const need = (pos: Vec3, fovDeg: number): number => {
    const f = [t[0] - pos[0], t[1] - pos[1], t[2] - pos[2]];
    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
    const F = [f[0] / fl, f[1] / fl, f[2] / fl];
    // right = F × up, up' = right × F
    let R = [-F[2], 0, F[0]];
    const rl = Math.hypot(R[0], R[2]) || 1;
    R = [R[0] / rl, 0, R[2] / rl];
    const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
    const tv = Math.tan((fovDeg * DEG) / 2), th = tv * aspect;
    let req = 0;
    for (const s of near) {
      const top = s.top ?? s.h;
      const d = [s.x - pos[0], s.y + top * 0.55 - pos[1], s.z - pos[2]];
      const zc = d[0] * F[0] + d[1] * F[1] + d[2] * F[2];
      if (zc < 1) continue;
      const half = Math.max(s.w, top * 0.6) * 0.5;
      // Only runners the shot shows, if only a wing of them.
      if (Math.abs(d[0] * R[0] + d[2] * R[2]) - half > th * zc || Math.abs((d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / zc) > tv) continue;
      const hy = s.y + top * 1.06 - pos[1];
      const yc = (d[0] * U[0] + hy * U[1] + d[2] * U[2]) / zc;
      const xc = (Math.abs(d[0] * R[0] + d[2] * R[2]) + half * 0.8) / zc;
      req = Math.max(req, yc / 0.78, xc / aspect);
    }
    return req;
  };
  let pos = pose.pos;
  let fov = pose.fov;
  const tanOf = (f: number) => Math.tan((f * DEG) / 2);
  const req = need(pos, fov);
  if (req <= tanOf(fov)) return pose;
  fov = Math.min(Math.max(fov, (2 * Math.atan(req) / DEG)), pose.fov * 1.25, 62);
  // Back along the line of sight, but never further into the stands than the shot already stood (some stand at the barrier).
  const into = (p: Vec3) => Math.max(Math.abs(p[0]) - (BOWL.A - 4), Math.abs(p[2]) - (barrierZ(p[0]) - 1.5));
  const limit = Math.max(0, into(pose.pos));
  for (let k = 1; k <= 12 && need(pos, fov) > tanOf(fov); k++) {
    const m = 1 + 0.1 * k;
    const next: Vec3 = [t[0] + off[0] * m, t[1] + off[1] * m, t[2] + off[2] * m];
    if (into(next) > limit) break;
    pos = next;
  }
  // Where the camera can't go further back, the lens widens instead.
  // (A wider lens shows more of the field, which may ask for wider still: settle it.)
  for (let k = 0; k < 4; k++) {
    const left = need(pos, fov);
    if (left <= tanOf(fov) || fov >= 62) break;
    fov = Math.min(62, (2 * Math.atan(left)) / DEG + 0.01);
  }
  return { pos, target: t, fov };
}

function shotFor(cam: Camera, k: number, spots: Spot[], ctx: DirectorContext): CamPose {
  const H = fieldHeight(spots);
  // Swimmers in the big pool inside the kerb count towards where the shot looks only while they race with the leader.
  const inPack = new Set(pack(spots, 15));
  const lanesNear = spots.filter((s) => (s.across ?? 0) >= 0 || inPack.has(s));
  const zMid = fieldMidZ(lanesNear.length ? lanesNear : spots);
  const span = fieldSpan(lanesNear.length ? lanesNear : spots);
  const portrait = ctx.aspect < 0.9;
  switch (cam) {
    case "crane": {
      // The establishing shot: from high at the west end, across the whole bowl, sweeping down to the start.
      const c = centroid(ctx.starts);
      // Hold the wide view, then swoop in.
      const e = ease((k - 0.32) / 0.68);
      const e2 = e * e * (3 - 2 * e);
      // On a phone (or a 9:16 video) the frame is tall: start higher and look down the bowl's length, so it fills the frame instead of the dark ground outside.
      // It starts inside the bowl, under the roof's edge: the lit field and the far stand fill the frame (from over the roof, half of it was the dark roof).
      const from: Vec3 = portrait ? [-92 + 10 * k, 44 - 5 * k, 20] : [-90 + 10 * k, 30 - 3 * k, 30];
      const fromT: Vec3 = portrait ? [0, 0, -2] : [24, 6, -6];
      const to: Vec3 = ctx.distance === 100 ? [c[0] + 15, 3.2 + H, c[2] + 11] : [c[0] * 0.8, 10 + H, c[2] * 0.62];
      const toT: Vec3 = [c[0], 0.5 * H, c[2]];
      const pos = lerp3(from, to, e2);
      const target = lerp3(fromT, toT, ease(Math.min(1, k * 1.25)));
      return { pos, target, fov: lerp(portrait ? 66 : 50, portrait ? 52 : 34, e) };
    }
    case "intro": {
      const r = spots.find((s) => s.lane === ctx.lane) ?? spots[0];
      const h = Math.max(0.5, r.h);
      const [nx, nz] = outward(r.dx, r.dz);
      const a = (5 + 5 * k) * DEG;
      const ux = r.dx * Math.cos(a) + nx * Math.sin(a), uz = r.dz * Math.cos(a) + nz * Math.sin(a);
      const D = (2.7 + 2.4 * h) * (1 - 0.08 * k) * (portrait ? 1.3 : 1);
      const target: Vec3 = [r.x, r.y + 0.5 * h, r.z];
      const pos: Vec3 = [r.x + ux * D, r.y + 0.55 * h + 0.35, r.z + uz * D];
      return { pos, target, fov: fovToFit(Math.max(r.w, h) * 1.3, h * 1.4, D, ctx.aspect, 8, 60) };
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
      // The tracking camera on its rail outside the track, running ahead of the pack: three quarters from the front, on a long lens.
      const p = pack(spots);
      const l = leader(spots);
      const c = centroid(p);
      const xs = p.map((s) => s.x);
      const spreadX = Math.max(...xs) - Math.min(...xs);
      const [nx, nz] = outward(l.dx, l.dz);
      const ahead = 10 + 2.2 * H + spreadX * 0.4;
      const out = 6.5 + 1.6 * H + (portrait ? 2 : 0);
      const cx = (c[0] + l.x) / 2, cz = zMid;
      const pos: Vec3 = [cx + l.dx * ahead + nx * out, 1.5 + 0.75 * H, cz + l.dz * ahead + nz * out];
      const target: Vec3 = [cx + l.dx * 0.6, 0.55 * H, cz];
      const D = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(Math.max(4, (span * 0.6 + spreadX * 0.5) * (portrait ? 0.7 : 1)), H * 1.6, D, ctx.aspect, 6, 50) };
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
      // A tall frame can't hold every lane on a long lens without shrinking the runners: it keeps the middle lanes (where the fastest are drawn).
      return { pos, target, fov: fovToFit(span * (portrait ? 0.62 : 1.08), H * 2.1, D, ctx.aspect, 5, 55) };
    }
    case "line": {
      // The finish-line camera: low, just past the line and outside the track, looking back at them coming in.
      const pos: Vec3 = [X0 + 13 + 1.5 * H, 2.4 + 1.1 * H, zMid + 8 + 1.6 * H];
      const target: Vec3 = [X0 - 3.2, 0.5 * H, zMid - 0.3];
      const D = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(span * 0.72 + 2, H * 1.8, D, ctx.aspect, 9, 55) };
    }
    case "winner":
    case "chase": {
      const r = spots.find((s) => s.lane === ctx.lane) ?? leader(spots);
      const h = Math.max(0.5, r.h);
      const [nx, nz] = outward(r.dx, r.dz);
      const D = 3.2 + 2.8 * h;
      const pos: Vec3 = [r.x + r.dx * D * 0.7 + nx * D * 0.71, r.y + 0.7 + 0.55 * h, r.z + r.dz * D * 0.7 + nz * D * 0.71];
      const target: Vec3 = [r.x + r.dx * 0.3, r.y + 0.5 * h, r.z + r.dz * 0.3];
      return { pos, target, fov: fovToFit(Math.max(r.w, h) * 2.1, h * 2.2, D, ctx.aspect, 10, 60) };
    }
    case "replay": {
      // Low, in front of the line and to the outside: the finish from three quarters, following the leader in.
      const l = leader(spots);
      const fx = Math.max(X0 - 14, Math.min(X0 + 2, l.x));
      const pos: Vec3 = [fx + 8.5, 1.0 + 0.45 * H, zMid + 6.5 + 1.4 * H];
      const target: Vec3 = [fx - 0.6, 0.5 * H, zMid - 0.3];
      const D = Math.hypot(pos[0] - target[0], pos[2] - target[2]);
      return { pos, target, fov: fovToFit(span * 0.8 + 2, H * 2, D, ctx.aspect, 10, 60) };
    }
    case "results": {
      // From the infield, over the runners stopped in the run-out, the main stand behind them.
      const l = leader(spots);
      const a = (-20 + 26 * k) * DEG;
      const R = 13 + 2.6 * H;
      const pos: Vec3 = [l.x - 5 + R * Math.sin(a), 3.4 + 1.1 * H, zMid - R * Math.cos(a)];
      const target: Vec3 = [l.x - 4, 0.6 * H, zMid + 0.5];
      return { pos, target, fov: portrait ? 60 : 44 };
    }
  }
}

/**
 * A crane's start, brought inside the stadium's bowl and under its roof: a
 * point out over the roof looks down on a dark roof and the night outside,
 * so it moves in along its bearing to where the lit field fills the frame.
 * (A point already inside, or in one of the halls, is returned as it is.)
 */
export function insideBowl(p: Vec3): Vec3 {
  const lim = 0.8;
  const k = Math.pow(Math.pow(Math.abs(p[0]) / BOWL.A, BOWL.N) + Math.pow(Math.abs(p[2]) / BOWL.B, BOWL.N), 1 / BOWL.N);
  const f = k > lim ? lim / k : 1;
  return [p[0] * f, Math.min(p[1], 34), p[2] * f];
}

/** A smooth blend between two poses (for cuts that dissolve and for the free camera taking over). */
export function blendPose(a: CamPose, b: CamPose, k: number): CamPose {
  const e = ease(k);
  return { pos: lerp3(a.pos, b.pos, e), target: lerp3(a.target, b.target, e), fov: lerp(a.fov, b.fov, e) };
}
