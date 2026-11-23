/**
 * The ball's shape, in millimetres (1 unit = 1 mm): a 60 mm ball whose halves are closed lathe profiles with a real
 * wall, so the same profile draws the ball on screen and prints.
 *
 * Each half, from its pole: the shell's outer surface down to the band; the band (a shallow groove, or raised on a
 * Hisuian ball); the rim; a recess inside the rim; the inner surface back up to the pole. Printing, a coupler ring
 * sits in both recesses with 0.25 mm of clearance, so the halves join without glue and each prints flat on its rim
 * with no supports. The button is two small pieces (a ring and the button through it, 0.25 mm clearance) whose
 * backs follow the ball's curve. Everything is built without booleans.
 *
 * Pure functions (three.js only for BufferGeometry), so the tests can check every printed piece is watertight.
 */
import * as THREE from "three";
import { bandHeight, type ButtonStyle, type Design, type Shape } from "./design";

export const R = 30;
/** Inner surface radius (a 3 mm wall). */
export const RI = 27;
/** The recess inside the rim: its radius and depth. */
export const REC_R = 27.8;
export const REC_H = 3;
/** Fit clearance for the coupler ring and the button. */
export const CLEAR = 0.25;
/** The coupler ring's wall. */
const COUPLER_W = 1.5;
/** The button's ring and the button. */
export const RING_R = 10.8;
export const BUTTON_R = 6.4;
/** How far the ring and the button stand out in front of the ball. */
const RING_OUT = 1.7;
const BUTTON_OUT = 2.9;

export type P = [r: number, y: number];
export type Region = "shell" | "band" | "inner";
export interface Seg {
  region: Region;
  pts: P[];
}

export interface Dims {
  /** Band height (the whole band, both halves) and how far it sits in (negative: stands out). */
  bandH: number;
  groove: number;
  /** Segments round the ball and along a quarter circle. */
  radial: number;
  arc: number;
  faceted: boolean;
}

export function dimsOf(d: Pick<Design, "shape" | "band">, quality: "screen" | "print" = "screen"): Dims {
  const faceted = d.shape === "faceted";
  const print = quality === "print";
  return {
    bandH: bandHeight(d.band),
    groove: d.shape === "hisui" ? -0.9 : faceted ? 0.6 : 0.5,
    radial: faceted ? 12 : print ? 144 : 112,
    arc: faceted ? 5 : print ? 56 : 44,
    faceted,
  };
}

function arc(rad: number, from: number, to: number, steps: number, skipFirst = false): P[] {
  const out: P[] = [];
  const n = Math.max(1, Math.ceil((Math.abs(to - from) / (Math.PI / 2)) * steps));
  for (let k = skipFirst ? 1 : 0; k <= n; k++) {
    const a = from + ((to - from) * k) / n;
    out.push([Math.abs(rad * Math.sin(a)) < 1e-9 ? 0 : rad * Math.sin(a), rad * Math.cos(a)]);
  }
  return out;
}

/** The top half's profile (y ≥ 0), from the outer pole round to the inner pole, in regions. */
export function halfProfile(dm: Dims): Seg[] {
  const yb = Math.min(dm.bandH / 2, R * 0.4);
  const tb = Math.acos(yb / R);
  const shell = arc(R, 0, tb, dm.arc);
  const rb = R - dm.groove;
  // The band follows its own sphere (a little inside the shell's, or outside on a Hisuian ball) down to the rim.
  const band: P[] = [shell[shell.length - 1]];
  const rows = dm.faceted ? 1 : Math.max(2, Math.round(dm.arc * 0.25));
  for (let k = 0; k <= rows; k++) {
    const y = yb * (1 - k / rows);
    band.push([Math.sqrt(Math.max(0, rb * rb - y * y)), y]);
  }
  const ri0 = Math.sqrt(RI * RI - REC_H * REC_H);
  const inner: P[] = [[rb, 0], [REC_R, 0], [REC_R, REC_H], [ri0, REC_H], ...arc(RI, Math.acos(REC_H / RI), 0, dm.arc, true)];
  return [
    { region: "shell", pts: shell },
    { region: "band", pts: band },
    { region: "inner", pts: inner },
  ];
}

/** The coupler ring's cross-section (a closed loop, no point on the axis). */
export function couplerProfile(): P[] {
  const ro = REC_R - CLEAR, ri = ro - COUPLER_W, h = REC_H - 0.1;
  return [[ro, -h], [ro, h], [ri, h], [ri, -h]];
}

/** The ball's surface height (z) at distance r from the button's axis. */
const surfaceZ = (r: number) => Math.sqrt(R * R - r * r);

/** The button's ring (a washer whose back follows the ball): (r, z) round the button's axis, a closed loop. */
export function ringProfile(style: ButtonStyle, steps = 10): P[] {
  const ro = style === "glow" ? RING_R * 0.92 : RING_R, ri = BUTTON_R + CLEAR;
  const zf = R + RING_OUT;
  const back: P[] = [];
  for (let k = 0; k <= steps; k++) {
    const r = ri + ((ro - ri) * k) / steps;
    back.push([r, surfaceZ(r)]);
  }
  // Back from the hole outward, up the outer side, the front inward, the hole's wall back down.
  return [...back, [ro, zf - 0.5], [ro - 0.5, zf], [ri + 0.3, zf], [ri, zf - 0.3]];
}

/** The button: its back follows the ball, its front is flat with a bevel. From the back's centre round to the front's. */
export function buttonProfile(steps = 10): P[] {
  const zf = R + BUTTON_OUT;
  const pts: P[] = [];
  for (let k = 0; k <= steps; k++) {
    const r = (BUTTON_R * k) / steps;
    pts.push([r, surfaceZ(r)]);
  }
  return [...pts, [BUTTON_R, zf - 0.6], [BUTTON_R - 0.6, zf], [0, zf]];
}

/** A gem in place of the button: eight facets rising to a table. */
export function gemProfile(): P[] {
  const zf = R + BUTTON_OUT + 1.2;
  return [[0, surfaceZ(0)], [BUTTON_R, surfaceZ(BUTTON_R)], [BUTTON_R, R + 1.2], [BUTTON_R * 0.55, zf], [0, zf]];
}

// ---------------------------------------------------------------------------------------------------------------
// Meshes for the screen: one BufferGeometry per region, smooth within it, sharp where regions (or corners) meet.
// ---------------------------------------------------------------------------------------------------------------

/**
 * A lathe of an open profile round the y axis (x = r sin φ, z = r cos φ, φ = 0 at the front), with normals from the
 * profile itself (no seam where φ wraps) and sharp corners where the profile turns by more than `crease`. `flip`
 * reverses which side faces out (a mirrored half). UVs: u round, v along the profile.
 */
export function latheGeometry(pts: P[], radial: number, flip = false, crease = 0.6): THREE.BufferGeometry {
  // Split at sharp corners so each run gets its own smooth normals.
  const runs: P[][] = [];
  let cur: P[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    cur.push(pts[i]);
    if (i < pts.length - 1) {
      const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]], b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
      const ang = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1))));
      if (ang > crease) {
        runs.push(cur);
        cur = [pts[i]];
      }
    }
  }
  runs.push(cur);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let along = 0;
  for (const run of runs) {
    const base = pos.length / 3;
    // Profile normals: the edges' normals averaged at each point.
    const en = run.slice(0, -1).map((p, i) => {
      const dr = run[i + 1][0] - p[0], dy = run[i + 1][1] - p[1], l = Math.hypot(dr, dy) || 1;
      return flip ? [dy / l, -dr / l] : [-dy / l, dr / l];
    });
    for (let i = 0; i < run.length; i++) {
      const a = en[Math.max(0, i - 1)], b = en[Math.min(en.length - 1, i)];
      let nr = a[0] + b[0], ny = a[1] + b[1];
      const l = Math.hypot(nr, ny) || 1;
      nr /= l;
      ny /= l;
      if (i > 0) along += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      for (let j = 0; j <= radial; j++) {
        const phi = (j / radial) * Math.PI * 2, s = Math.sin(phi), c = Math.cos(phi);
        pos.push(run[i][0] * s, run[i][1], run[i][0] * c);
        nor.push(nr * s, ny, nr * c);
        uv.push(j / radial, total ? along / total : 0);
      }
    }
    for (let i = 0; i < run.length - 1; i++)
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j, b = a + radial + 1;
        if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A half's regions as screen meshes (`bottom`: mirrored below the band). */
export function halfGeometries(dm: Dims, bottom: boolean): Record<Region, THREE.BufferGeometry> {
  const segs = halfProfile(dm);
  const out = {} as Record<Region, THREE.BufferGeometry>;
  for (const s of segs) {
    const pts = bottom ? s.pts.map(([r, y]): P => [r, -y]) : s.pts;
    out[s.region] = latheGeometry(pts, dm.radial, bottom);
  }
  return out;
}

/** A lathe round the z axis (the button's), facing the front. */
export function frontLathe(pts: P[], radial: number, closedLoop: boolean): THREE.BufferGeometry {
  const loop = closedLoop ? [...pts, pts[0]] : pts;
  const g = latheGeometry(loop, radial, true, 0.5);
  g.rotateX(Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Solids for printing: welded, closed and outward-facing.
// ---------------------------------------------------------------------------------------------------------------

export interface Solid {
  /** xyz per vertex. */
  pos: number[];
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  tri: number[];
}

/** Signed volume (positive when the triangles face out). */
export function volume(s: Solid): number {
  let v = 0;
  for (let i = 0; i < s.tri.length; i += 3) {
    const a = s.tri[i] * 3, b = s.tri[i + 1] * 3, c = s.tri[i + 2] * 3;
    const p = s.pos;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

function orient(s: Solid): Solid {
  if (volume(s) < 0) for (let i = 0; i < s.tri.length; i += 3) [s.tri[i + 1], s.tri[i + 2]] = [s.tri[i + 2], s.tri[i + 1]];
  return s;
}

/**
 * A closed solid of revolution round the y axis. `pts` either runs from one point on the axis to another (a solid
 * like a ball's half or the button) or, with `loop`, is a closed cross-section off the axis (a ring).
 */
export function latheSolid(pts: P[], radial: number, loop = false): Solid {
  const clean: P[] = [];
  for (const p of pts) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-7) clean.push([Math.abs(p[0]) < 1e-7 ? 0 : p[0], p[1]]);
  }
  if (loop && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 1e-7) clean.pop();
  const pos: number[] = [], tri: number[] = [];
  // Each profile point becomes a ring of vertices, or one vertex on the axis.
  const rings: number[][] = clean.map(([r, y]) => {
    if (r === 0) {
      pos.push(0, y, 0);
      return [pos.length / 3 - 1];
    }
    const ring: number[] = [];
    for (let j = 0; j < radial; j++) {
      const phi = (j / radial) * Math.PI * 2;
      pos.push(r * Math.sin(phi), y, r * Math.cos(phi));
      ring.push(pos.length / 3 - 1);
    }
    return ring;
  });
  const join = (a: number[], b: number[]) => {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      if (a.length === 1 && b.length === 1) continue;
      if (a.length === 1) tri.push(a[0], b[j], b[j1]);
      else if (b.length === 1) tri.push(a[j], b[0], a[j1]);
      else tri.push(a[j], b[j], a[j1], a[j1], b[j], b[j1]);
    }
  };
  for (let i = 0; i < rings.length - 1; i++) join(rings[i], rings[i + 1]);
  if (loop) join(rings[rings.length - 1], rings[0]);
  return orient({ pos, tri });
}

/** Moves (and turns) a solid: `f` maps a point. Mirroring flips the triangles back to facing out. */
export function mapSolid(s: Solid, f: (x: number, y: number, z: number) => [number, number, number]): Solid {
  const pos: number[] = [];
  for (let i = 0; i < s.pos.length; i += 3) pos.push(...f(s.pos[i], s.pos[i + 1], s.pos[i + 2]));
  return orient({ pos, tri: s.tri.slice() });
}

/** A box (the Hisuian clasp, printed separately). */
export function boxSolid(w: number, h: number, d: number): Solid {
  const pos: number[] = [];
  for (const z of [0, d]) for (const y of [0, h]) for (const x of [0, w]) pos.push(x - w / 2, y - h / 2, z);
  const tri = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
  return orient({ pos, tri });
}

/**
 * Checks a solid is watertight: after welding coincident vertices, no triangle is degenerate and every edge is
 * shared by exactly two triangles, once in each direction (so it also faces out consistently).
 */
export function watertight(s: Solid): { ok: boolean; edges: number; bad: number } {
  const key = new Map<string, number>();
  const remap: number[] = [];
  for (let i = 0; i < s.pos.length; i += 3) {
    const k = `${Math.round(s.pos[i] * 1e4)},${Math.round(s.pos[i + 1] * 1e4)},${Math.round(s.pos[i + 2] * 1e4)}`;
    let v = key.get(k);
    if (v === undefined) key.set(k, (v = key.size));
    remap.push(v);
  }
  const edges = new Map<string, number>();
  let bad = 0;
  for (let i = 0; i < s.tri.length; i += 3) {
    const t = [remap[s.tri[i]], remap[s.tri[i + 1]], remap[s.tri[i + 2]]];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) {
      bad++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const e = `${t[k]}>${t[(k + 1) % 3]}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split(">");
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) bad++;
  }
  return { ok: bad === 0 && edges.size > 0, edges: edges.size / 2, bad };
}

/** The whole profile of a half as one polyline (shared points once). */
export function fullProfile(dm: Dims): P[] {
  const out: P[] = [];
  for (const s of halfProfile(dm)) for (const p of s.pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-7) out.push(p);
  }
  return out;
}

export interface PrintPart {
  key: "top" | "bottom" | "coupler" | "ring" | "button" | "latch";
  solid: Solid;
}

/**
 * Every printed piece, laid flat on the bed (z up, z = 0 the bed): the halves on their rims side by side, the coupler
 * ring, the button's ring on its front and the button on its face in front of them.
 */
export function printParts(d: Pick<Design, "shape" | "band" | "button">): PrintPart[] {
  const dm = dimsOf(d, "print");
  const half = latheSolid(fullProfile(dm), dm.radial);
  const gap = R + Math.max(0, -dm.groove) + 4;
  // Lathe y (up the half) becomes print z; the top half stands on its rim, the bottom half is the same shape.
  const top = mapSolid(half, (x, y, z) => [x - gap, z, y]);
  const bottom = mapSolid(half, (x, y, z) => [x + gap, z, y]);
  const cp = couplerProfile();
  const coupler = mapSolid(latheSolid(cp, dm.radial, true), (x, y, z) => [x - 16, z - R - 22, y + (REC_H - 0.1)]);
  const radial = dm.faceted ? 8 : 64;
  const parts: PrintPart[] = [
    { key: "top", solid: top },
    { key: "bottom", solid: bottom },
    { key: "coupler", solid: coupler },
  ];
  if (d.button === "latch") {
    parts.push({ key: "latch", solid: mapSolid(boxSolid(14, 18, 3), (x, y, z) => [x + 22, y - R - 18, z]) });
  } else {
    const rp = ringProfile(d.button);
    const zf = R + RING_OUT;
    // The ring on its flat front: lathe y (the button's axis) flipped so the front is the bed.
    parts.push({ key: "ring", solid: mapSolid(latheSolid(rp, radial, true), (x, y, z) => [x + 14, z - R - 20, zf - y]) });
    const bz = R + BUTTON_OUT;
    parts.push({ key: "button", solid: mapSolid(latheSolid(buttonProfile(), radial), (x, y, z) => [x + 34, z - R - 20, bz - y]) });
  }
  return parts;
}

/** Binary STL of several solids (one file; slicers split it into its pieces). */
export function stlBytes(parts: Solid[], header = "PokeIQ Poke Ball Maker - 1 unit = 1 mm"): Uint8Array {
  const n = parts.reduce((a, s) => a + s.tri.length / 3, 0);
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(header.slice(0, 80));
  new Uint8Array(buf, 0, head.length).set(head);
  dv.setUint32(80, n, true);
  let o = 84;
  for (const s of parts) {
    const p = s.pos;
    for (let i = 0; i < s.tri.length; i += 3) {
      const a = s.tri[i] * 3, b = s.tri[i + 1] * 3, c = s.tri[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) {
        dv.setFloat32(o, v, true);
        o += 4;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

export type { Shape };
