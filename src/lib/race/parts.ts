import { decodeZ, distanceField } from "@/lib/sizes/relief";
import type { Motion } from "./types";

/**
 * Finds a runner's moving parts (legs, arms, wings, tail) from its relief
 * map: the silhouette (coverage and thickness) and the depth estimate of
 * its HOME render. Pure and unit-tested (tests/race-parts.test.ts); it
 * runs in a worker while a race loads (scene/figure.worker.ts), never
 * mid-race.
 *
 * - Legs: built up from the ground, row by row. Columns that stand on the
 *   ground and stay apart are legs, up to the row where two of them join
 *   (the crotch, or the belly of a quadruped) or a much bigger mass meets
 *   them (a round body sitting on two feet). Their hips are there.
 * - Arms, wings, ears, tails: a morphological opening of the silhouette by
 *   a disc about half the torso's thickness keeps the torso and head;
 *   what it removes are the thin parts that stick out. Each is hinged where
 *   it meets the torso and classified by where it is and which way it
 *   points: sideways from the upper body are arms (wings on fliers),
 *   upwards from the top are ears and crests (they stay put), and a thin
 *   part on the side away from the head is the tail.
 * - Which way the figure faces: the head end of a long figure is nearer
 *   the camera in the depth estimate (renders are three-quarter views); a
 *   four-legged runner's head is its high end; otherwise left, as most
 *   HOME renders face.
 *
 * Each pixel of the map gets a part (0: the body), a follow weight that
 * ramps smoothly from 0 at the joint to 1 along the part, so the mesh
 * bends there instead of tearing, and its distance along the part (0 at
 * the joint, 1 at the tip) for knees and flexing wingtips and tails.
 */

export type PartKind = "leg" | "arm" | "wing" | "tail";

export interface Part {
  kind: PartKind;
  /** The joint (hip, shoulder, tail root) and the tip, in map pixels (x right, y down). */
  px: number;
  py: number;
  tx: number;
  ty: number;
  /** Which beat it moves on: alternate legs (and the arm opposite each leg) have opposite sides. */
  side: 0 | 1;
  /** Legs of a four-legged runner: 1 front, 0 hind. */
  front: 0 | 1;
  /** Pixels in the part. */
  area: number;
}

export interface PartMap {
  w: number;
  h: number;
  /** 0 = the body, k = parts[k − 1]. */
  label: Uint8Array;
  /** How much each pixel follows its part (0 at the joint … 1). */
  weight: Float32Array;
  /** Distance along the part, 0 at the joint … 1 at the tip. */
  along: Float32Array;
  parts: Part[];
  /** Which way the head points in the render: −1 left, 1 right. */
  facing: -1 | 1;
  /** Mean front depth (z / L) at each map pixel inside the figure, for joint depth. */
  mid: Float32Array;
  /** The torso the parts hang off (for audits). */
  torso?: Uint8Array;
}

export interface ReliefPixels {
  w: number;
  h: number;
  data: Uint8Array | Uint8ClampedArray;
  channels: 3 | 4;
}

/** Most parts a figure can move (shader slots). */
export const MAX_PARTS = 8;

/** Gaits whose runners use their legs. */
const LEGGED = new Set<Motion>(["run", "gallop", "scuttle", "bounce"]);
/** Gaits that keep the whole body moving instead (balls, serpents, swimmers). */
const WHOLE_BODY = new Set<Motion>(["roll", "slither", "flop", "swim"]);

export function partMask(m: ReliefPixels): { mask: Uint8Array; cover: Uint8Array; mid: Float32Array; depth: Float32Array } {
  const { w, h, data, channels } = m;
  const n = w * h;
  const mask = new Uint8Array(n), cover = new Uint8Array(n);
  const mid = new Float32Array(n);
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = data[i * channels], b = data[i * channels + 1], c = data[i * channels + 2];
    mid[i] = (decodeZ(f) + decodeZ(b)) / 2;
    // The depth estimate's surface, without the rounding the bake adds near the outline (front = centre + 0.38 · thickness, back = centre − 0.62 · thickness).
    depth[i] = mid[i] + 0.12 * (decodeZ(f) - decodeZ(b));
    // Solid: the render is opaque enough to be thick there. Cover: any visible pixel (see-through wings too).
    if (c > 127 && f - b >= 1) mask[i] = 1;
    if (c > 127) cover[i] = 1;
  }
  return { mask, cover, mid, depth };
}

/** 8-connected components of a mask: labels (0 outside) and sizes (index = label). */
export function components(mask: Uint8Array, w: number, h: number): { lab: Int32Array; size: number[] } {
  const lab = new Int32Array(w * h);
  const size = [0];
  const stack: number[] = [];
  let next = 1;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    let count = 0;
    lab[i] = next;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !lab[q]) { lab[q] = next; stack.push(q); }
        }
      }
    }
    size.push(count);
    next++;
  }
  return { lab, size };
}

/** Keeps the figure's largest piece and any piece at least 2% of it (drops specks). */
function clean(mask: Uint8Array, w: number, h: number): Uint8Array {
  const { lab, size } = components(mask, w, h);
  const big = Math.max(0, ...size);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (lab[i] && size[lab[i]] >= Math.max(3, big * 0.02)) out[i] = 1;
  return out;
}

interface LegSeed {
  id: number;
  hip: number;
  active: boolean;
  /** Lowest row (the foot). */
  bottom: number;
  widths: number[];
  pixels: number;
  /** Seeds merged into this one (toes of one foot). */
  into: number;
}

/**
 * Legs, from the feet up: each pixel of a leg gets its leg's id
 * (1-based), the rest 0; plus each leg's hip row. A leg starts at the
 * bottom end of a column in the lower half of the figure (a foot on the
 * ground or lifted mid-stride); toes and claws that join within a short
 * way are one foot; the leg ends where it meets another leg, a much
 * bigger mass (the body), or flares into it.
 */
export function findLegs(mask: Uint8Array, w: number, h: number, hipCap = 0.62): { owner: Int32Array; legs: LegSeed[] } {
  const owner = new Int32Array(w * h);
  const legs: LegSeed[] = [];
  let top = h, bottom = -1, area = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { top = Math.min(top, y); bottom = Math.max(bottom, y); area++; }
  if (bottom < 0) return { owner, legs };
  const H = bottom - top + 1;
  const minLen = Math.max(2, H * 0.06);
  // Feet stand on the ground or are lifted a little mid-stride.
  const footBand = bottom - H * 0.22;
  const hipTop = bottom - H * hipCap;
  // Thickness across a run (orientation-free, so a diagonal leg isn't "wide").
  const df = distanceField(mask, w, h);
  let maxT = 0;
  for (let i = 0; i < w * h; i++) maxT = Math.max(maxT, 2 * df[i]);
  const root = (id: number): number => { let L = legs[id - 1]; while (L.into) L = legs[L.into - 1]; return L.id; };
  // Union-find over body blobs (runs not on a leg), with their sizes.
  const parent: number[] = [0];
  const bsize: number[] = [0];
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  type Run = { x0: number; x1: number; leg: number; blob: number };
  let below: Run[] = [];
  for (let y = bottom; y >= top; y--) {
    const runs: Run[] = [];
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let x1 = x;
      while (x1 + 1 < w && mask[y * w + x1 + 1]) x1++;
      runs.push({ x0: x, x1, leg: 0, blob: 0 });
      x = x1;
    }
    for (const r of runs) {
      const width = r.x1 - r.x0 + 1;
      let thick = 0;
      for (let x = r.x0; x <= r.x1; x++) thick = Math.max(thick, 2 * df[y * w + x]);
      const touching = below.filter((b) => b.x0 <= r.x1 + 1 && b.x1 >= r.x0 - 1);
      let legIds = [...new Set(touching.filter((b) => b.leg).map((b) => root(b.leg)).filter((id) => legs[id - 1].active))];
      const blobs = [...new Set(touching.filter((b) => !b.leg || !legs[root(b.leg) - 1].active).map((b) => (b.blob ? find(b.blob) : 0)).filter(Boolean))];
      const blobMass = blobs.reduce((a, b) => a + bsize[b], 0);
      const endLegs = (ids: number[]) => { for (const id of ids) { const L = legs[id - 1]; L.active = false; L.hip = y; } };
      const lenOf = (id: number) => legs[id - 1].bottom - y;
      if (legIds.length >= 2) {
        // Toes of one foot: all but one still short. Fold them into the longest.
        const long = legIds.filter((id) => lenOf(id) >= minLen);
        if (long.length <= 1) {
          const keep = [...legIds].sort((a, b) => lenOf(b) - lenOf(a))[0];
          for (const id of legIds) if (id !== keep) { const L = legs[id - 1]; L.into = keep; L.active = false; legs[keep - 1].pixels += L.pixels; legs[keep - 1].bottom = Math.max(legs[keep - 1].bottom, L.bottom); }
          legIds = [keep];
        }
      }
      if (!touching.length) {
        if (y >= footBand) {
          legs.push({ id: legs.length + 1, hip: -1, active: true, bottom: y, widths: [thick], pixels: 0, into: 0 });
          r.leg = legs.length;
        }
      } else if (legIds.length >= 2) {
        endLegs(legIds);
      } else if (legIds.length === 1) {
        const L = legs[legIds[0] - 1];
        // Its usual width: the lower half of the leg so far (feet and shins).
        const low = L.widths.slice(0, Math.max(3, Math.ceil(L.widths.length / 2))).sort((a, b) => a - b);
        // Never narrower than a modest limb (feet taper to claw tips).
        const med = Math.max(low[Math.floor(low.length / 2)], H * 0.08, 3);
        const long = L.bottom - y >= minLen;
        // The body meets it, it flares into the body, or it reaches hip height: the leg ends at its hip.
        if (long && (blobMass > Math.max(L.pixels * 1.5, area * 0.12) || thick > med * 2.1 + 2 || thick > maxT * 0.78 || y < hipTop)) endLegs(legIds);
        else { r.leg = legIds[0]; L.widths.push(thick); }
      }
      if (r.leg) {
        legs[r.leg - 1].pixels += width;
        for (let x = r.x0; x <= r.x1; x++) owner[y * w + x] = r.leg;
      } else {
        let id: number;
        if (blobs.length) {
          id = blobs[0];
          for (const b of blobs.slice(1)) { const rb = find(b); if (rb !== id) { parent[rb] = id; bsize[id] += bsize[rb]; } }
        } else {
          id = parent.length;
          parent.push(id);
          bsize.push(0);
        }
        bsize[id] += width;
        r.blob = id;
      }
    }
    below = runs;
  }
  // A column as thick as the body is the body standing on the ground, not a leg.
  for (const L of legs) {
    const ws = [...L.widths].sort((a, b) => a - b);
    if (ws.length && ws[Math.floor(ws.length / 2)] > maxT * 0.6) L.hip = -1;
  }
  // Pixels of folded toes belong to their foot's leg.
  for (let i = 0; i < w * h; i++) if (owner[i]) owner[i] = root(owner[i]);
  // Legs that never met the body (a figure that is all legs, a separate piece) aren't hinged.
  for (const L of legs) if (L.active) { L.active = false; L.hip = -1; }
  return { owner, legs: legs.filter((L) => !L.into) };
}

/** Distance (px) from every pixel to the nearest pixel of `seed` (Euclidean). */
function distanceTo(seed: Uint8Array, w: number, h: number): Float32Array {
  // distanceField measures to the nearest unset pixel and is bounded by the image border: invert, and pad far enough that the border never binds.
  const P = Math.max(w, h);
  const pw = w + 2 * P, ph = h + 2 * P;
  const inv = new Uint8Array(pw * ph).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (seed[y * w + x]) inv[(y + P) * pw + x + P] = 0;
  const d = distanceField(inv, pw, ph);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = seed[y * w + x] ? 0 : d[(y + P) * pw + x + P];
  return out;
}

/** Geodesic distance (px, 8-neighbour steps) inside `region` from the `from` pixels. */
function geodesic(region: Uint8Array, from: number[], w: number, h: number): Float32Array {
  const dist = new Float32Array(w * h).fill(Infinity);
  // Dial's algorithm on two step costs (1 and √2) is overkill here: a small Dijkstra with a binary heap.
  const heap: [number, number][] = [];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (const i of from) { dist[i] = 0; push(0, i); }
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (!region[j]) continue;
        const nd = d + (dx && dy ? Math.SQRT2 : 1);
        if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
      }
    }
  }
  return dist;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };

/** Which way the head points: the nearer end of a long figure in the depth estimate, else opposite the tail, else left (most HOME renders). */
function facingOf(mask: Uint8Array, depth: Float32Array, w: number, h: number): { facing: -1 | 1; sure: boolean } {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw < 4) return { facing: -1, sure: false };
  // Mean depth of the upper two thirds of each end third (the head is up; legs and feet are excluded).
  let sl = 0, nl = 0, sr = 0, nr = 0;
  for (let y = y0; y < y0 + bh * 0.67; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const u = (x - x0) / bw;
      if (u < 0.3) { sl += depth[i]; nl++; } else if (u > 0.7) { sr += depth[i]; nr++; }
    }
  }
  if (nl < 4 || nr < 4) return { facing: -1, sure: false };
  const diff = sr / nr - sl / nl;
  const wide = bw / bh;
  // Only a clear difference on a figure that is long enough to have ends.
  if (wide > 0.85 && Math.abs(diff) > 0.05) return { facing: diff > 0 ? 1 : -1, sure: true };
  return { facing: -1, sure: false };
}

export interface FindOptions {
  motion: Motion;
  shape: string | null;
}

/** Multi-source geodesic labelling inside `region`: each pixel gets the label of the nearest seed pixel (by 8-neighbour steps). */
function nearestLabel(region: Uint8Array, seeds: Int32Array, w: number, h: number): Int32Array {
  const n = w * h;
  const out = new Int32Array(n);
  const dist = new Float32Array(n).fill(Infinity);
  // A bucketed queue on quantised distance (steps of 1 and √2 at most a few hundred).
  const buckets: number[][] = [];
  const Q = 4;
  const push = (d: number, i: number) => { const b = Math.round(d * Q); (buckets[b] ??= []).push(i); };
  for (let i = 0; i < n; i++) if (seeds[i]) { out[i] = seeds[i]; dist[i] = 0; push(0, i); }
  for (let b = 0; b < buckets.length; b++) {
    const list = buckets[b];
    if (!list) continue;
    for (let q = 0; q < list.length; q++) {
      const i = list[q];
      const d = dist[i];
      if (Math.round(d * Q) !== b) continue;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (!region[j]) continue;
          const nd = d + (dx && dy ? Math.SQRT2 : 1);
          if (nd < dist[j] - 1e-6) { dist[j] = nd; out[j] = out[i]; push(nd, j); }
        }
      }
    }
  }
  return out;
}

/** Otsu's threshold of the values at the set pixels of a mask. */
export function otsu(values: Float32Array, mask: Uint8Array, bins = 64): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { lo = Math.min(lo, values[i]); hi = Math.max(hi, values[i]); }
  if (!(hi > lo)) return lo;
  const hist = new Float64Array(bins);
  let total = 0, sum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const b = Math.min(bins - 1, Math.floor(((values[i] - lo) / (hi - lo)) * bins));
    hist[b]++;
    total++;
    sum += b;
  }
  let wB = 0, sumB = 0, best = -1, bestB = bins / 2;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += b * hist[b];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestB = b; }
  }
  return lo + ((bestB + 1) / bins) * (hi - lo);
}

/** The moving parts of a figure, from its relief map. */
export function findParts(map: ReliefPixels, o: FindOptions): PartMap {
  const { w, h } = map;
  const n = w * h;
  const pm = partMask(map);
  const winged = o.shape === "wings" || o.shape === "bug-wings" || o.motion === "fly";
  // Fliers keep their see-through wings in the silhouette.
  const mask = clean(winged ? pm.cover : pm.mask, w, h);
  const label = new Uint8Array(n), weight = new Float32Array(n), along = new Float32Array(n);
  const parts: Part[] = [];
  const face = facingOf(mask, pm.depth, w, h);
  let facing = face.facing;
  let sure = face.sure;
  const out = (): PartMap => ({ w, h, label, weight, along, parts, facing, mid: pm.mid });
  let area = 0;
  let top = h, bottom = -1, left = w, right = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { area++; top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
  if (!area) return out();
  const H = bottom - top + 1, W = right - left + 1;
  // Four-legged runners: the head is the high end of a long body.
  if (!sure && o.motion === "gallop" && W > H * 0.95) {
    let tx = 0;
    for (let y = top; y <= top + Math.max(1, H * 0.06); y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { tx = x; y = h; break; }
    const u = (tx - left) / W;
    if (u > 0.62) { facing = 1; sure = true; } else if (u < 0.38) { facing = -1; sure = true; }
  }
  if (WHOLE_BODY.has(o.motion)) return out();
  let cx = 0;
  for (let i = 0; i < n; i++) if (mask[i]) cx += i % w;
  cx /= area;
  const vOf = (y: number) => (bottom - y) / H; // 0 at the ground, 1 at the top

  // ---- The torso (before legs): an opening of the silhouette by a disc half the thickest part's radius.
  const openOf = (m: Uint8Array) => {
    const dist = distanceField(m, w, h);
    let maxD = 0;
    for (let i = 0; i < n; i++) if (dist[i] > maxD) maxD = dist[i];
    const r = Math.max(1.5, maxD * 0.5);
    const core = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (dist[i] >= r) core[i] = 1;
    const toCore = distanceTo(core, w, h);
    const opened = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (m[i] && toCore[i] <= r + 0.75) opened[i] = 1;
    return opened;
  };

  // ---- Legs.
  const rest = mask.slice();
  if (LEGGED.has(o.motion)) {
    const { owner, legs } = findLegs(mask, w, h, o.motion === "gallop" ? 0.66 : 0.6);
    const minLen = Math.max(2, H * 0.06);
    let bodyDepth = 0, bn = 0;
    for (let i = 0; i < n; i++) if (mask[i] && !owner[i]) { bodyDepth += pm.depth[i]; bn++; }
    bodyDepth = bn ? bodyDepth / bn : 0;
    for (const L of legs) {
      if (L.hip < 0 || L.bottom - L.hip < minLen || L.pixels < Math.max(4, area * 0.004)) continue;
      let sx = 0, sn = 0, fx = 0, fn = 0, px = 0, x0 = w, x1 = -1, dz = 0;
      const idx: number[] = [];
      for (let y = L.hip + 1; y <= L.bottom; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (owner[i] !== L.id) continue;
          idx.push(i);
          px++;
          dz += pm.depth[i];
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          if (y <= L.hip + 2) { sx += x; sn++; }
          if (y >= L.bottom - 1) { fx += x; fn++; }
        }
      }
      const len = L.bottom - L.hip;
      const atEnd = x1 < left + W * 0.25 || x0 > right - W * 0.25;
      // Wider than tall and out at one end: a tail lying on the ground, not a leg.
      if (x1 - x0 + 1 > len * (atEnd ? 2.2 : 3)) continue;
      // Far behind the body and out at one end: a tail reaching down (Mewtwo's).
      if (atEnd && dz / px < bodyDepth - 0.04) continue;
      if (parts.length >= MAX_PARTS) break;
      parts.push({ kind: "leg", px: sn ? sx / sn : (x0 + x1) / 2, py: L.hip + 0.5, tx: fn ? fx / fn : (x0 + x1) / 2, ty: L.bottom, side: 0, front: 0, area: px });
      const k = parts.length;
      // The hip bends over the top of the leg; the rest of the leg follows it.
      const ramp = Math.max(1.5, Math.min(len * 0.4, H * 0.06));
      for (const i of idx) {
        const y = (i / w) | 0;
        label[i] = k;
        weight[i] = smooth(0, ramp, y - L.hip);
        along[i] = Math.min(1, (y - L.hip) / Math.max(1, len));
        rest[i] = 0;
      }
    }
    // Sides: alternate along the body; a four-legged runner pairs front and hind legs.
    const legsIdx = parts.map((p, i) => (p.kind === "leg" ? i : -1)).filter((i) => i >= 0);
    legsIdx.sort((a, b) => parts[a].px - parts[b].px);
    if (o.motion === "gallop" && legsIdx.length >= 2) {
      const mx = legsIdx.reduce((a, i) => a + parts[i].px, 0) / legsIdx.length;
      const fr = legsIdx.filter((i) => (parts[i].px - mx) * facing > 0);
      const hi = legsIdx.filter((i) => (parts[i].px - mx) * facing <= 0);
      fr.forEach((i, k) => { parts[i].front = 1; parts[i].side = (k % 2) as 0 | 1; });
      hi.forEach((i, k) => { parts[i].front = 0; parts[i].side = (k % 2) as 0 | 1; });
    } else {
      legsIdx.forEach((i, k) => { parts[i].side = (k % 2) as 0 | 1; });
    }
  }

  // ---- Everything else that sticks out of the torso.
  let opened = openOf(rest);
  if (winged) {
    // A flier's wings spread behind its body: the torso is the near side of the depth (Otsu's split), cleaned by a small opening.
    const t = otsu(pm.depth, rest);
    const nearSide = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (rest[i] && pm.depth[i] >= t) nearSide[i] = 1;
    const dn = distanceField(nearSide, w, h);
    let md = 0;
    for (let i = 0; i < n; i++) md = Math.max(md, dn[i]);
    const rr = Math.max(1.5, md * 0.3);
    const core = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (dn[i] >= rr) core[i] = 1;
    const back = distanceTo(core, w, h);
    const op = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (nearSide[i] && back[i] <= rr + 0.75) op[i] = 1;
    const cc = components(op, w, h);
    const big = Math.max(0, ...cc.size.slice(1));
    if (big > area * 0.08) {
      // The rim round the body reads as far too (the estimate falls away at outlines): it belongs to the body.
      const dOp = distanceTo(op, w, h);
      for (let i = 0; i < n; i++) if (rest[i] && dOp[i] <= 2.5) op[i] = 1;
      opened = op;
    }
  }
  const oc = components(opened, w, h);
  const ocDepth = new Float64Array(oc.size.length), ocX = new Float64Array(oc.size.length);
  for (let i = 0; i < n; i++) if (oc.lab[i]) { ocDepth[oc.lab[i]] += pm.depth[i]; ocX[oc.lab[i]] += i % w; }
  // The torso is the biggest piece, or a nearer one nearly as big (a small body between big wings).
  let torsoK = 0, bestScore = -Infinity;
  const biggest = Math.max(0, ...oc.size.slice(1));
  for (let k = 1; k < oc.size.length; k++) {
    if (oc.size[k] < biggest * 0.25) continue;
    const score = oc.size[k] / biggest + (ocDepth[k] / oc.size[k]) * 12;
    if (score > bestScore) { bestScore = score; torsoK = k; }
  }
  if (!torsoK) return out();
  const torsoMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (oc.lab[i] === torsoK) torsoMask[i] = 1;
  let td = 0, torsoCx = 0;
  td = ocDepth[torsoK] / oc.size[torsoK];
  torsoCx = ocX[torsoK] / oc.size[torsoK];
  // Each leftover pixel goes with its nearest piece: the torso's thin parts (arms, ears, tails), or a big piece hanging off it (a wing, a head on a neck).
  const seeds = new Int32Array(n);
  for (let i = 0; i < n; i++) if (oc.lab[i]) seeds[i] = oc.lab[i];
  const near = nearestLabel(rest, seeds, w, h);
  const cand = new Uint8Array(n);
  const piece = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!rest[i] || near[i] === torsoK) continue;
    cand[i] = 1;
    piece[i] = near[i] || 0;
  }
  // Thin parts of the torso.
  const thinTorso = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (rest[i] && near[i] === torsoK && !opened[i]) thinTorso[i] = 1;
  const fly = o.motion === "fly" || o.motion === "hover";
  type Cand = { px: number; py: number; tx: number; ty: number; len: number; area: number; attach: number[]; depth: number; mx: number; pix: number[] };
  const cands: Cand[] = [];
  const torsoSide = (j: number) => opened[j] && oc.lab[j] === torsoK;
  const gather = (pix: number[]) => {
    if (pix.length < Math.max(5, area * 0.006)) return;
    const attach: number[] = [];
    let dz = 0, mx = 0;
    const own = new Set(pix);
    for (const i of pix) {
      dz += pm.depth[i];
      mx += i % w;
      const x = i % w, y = (i / w) | 0;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1 && !touch; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!own.has(j) && rest[j] && (torsoSide(j) || near[j] === torsoK)) touch = true;
      }
      if (touch) attach.push(i);
    }
    // A piece that doesn't meet the torso (a floating wing or fin) stays rigid.
    if (!attach.length) return;
    let px = 0, py = 0;
    for (const i of attach) { px += i % w; py += (i / w) | 0; }
    px /= attach.length; py /= attach.length;
    let tx = px, ty = py, best = -1;
    for (const i of pix) {
      const d = Math.hypot((i % w) - px, ((i / w) | 0) - py);
      if (d > best) { best = d; tx = i % w; ty = (i / w) | 0; }
    }
    if (best < Math.max(2.5, H * 0.07)) return;
    cands.push({ px, py, tx, ty, len: best, area: pix.length, attach, depth: dz / pix.length, mx: mx / pix.length, pix });
  };
  {
    const c1 = components(thinTorso, w, h);
    const lists: number[][] = c1.size.map(() => []);
    for (let i = 0; i < n; i++) if (c1.lab[i]) lists[c1.lab[i]].push(i);
    lists.slice(1).forEach(gather);
    const c2 = components(cand, w, h);
    const lists2 = new Map<string, number[]>();
    for (let i = 0; i < n; i++) if (c2.lab[i]) { const key = `${c2.lab[i]}:${piece[i]}`; (lists2.get(key) ?? lists2.set(key, []).get(key)!).push(i); }
    for (const pix of lists2.values()) gather(pix);
  }
  const wideBox = W > H * 1.15;
  const classify = (c: Cand, faceDir: number): PartKind | null => {
    const dx = c.tx - c.px, dy = c.ty - c.py;
    const pv = vOf(c.py), tv = vOf(c.ty);
    const lateral = Math.abs(dx) > Math.abs(dy) * 0.7;
    const elong = (c.len * c.len) / Math.max(1, c.area);
    const rearSide = (c.px - cx) * faceDir < 0;
    const far = c.depth < td - 0.025;
    const big = c.area > area * 0.05;
    const aside = Math.abs(c.mx - torsoCx) > W * 0.16;
    // Wings: a flier's big pieces out to the side of the upper body.
    if (winged && big && pv > 0.3 && aside && c.area < area * 0.4) return "wing";
    // Upwards out of the top: ears, horns, crests, hair, a head on a neck.
    if (pv > 0.55 && tv > pv + 0.08) return null;
    // Head features at the front end of a long body (jaws, horns, manes).
    if (wideBox && pv > 0.45 && (c.px - (faceDir < 0 ? left : right)) * -faceDir < W * 0.3) return null;
    // A thin part held behind the body, or out from the rear low down: the tail.
    if (elong > 1.6 && pv < 0.75 && c.area < area * 0.25 && ((rearSide && (dx * faceDir < 0 || dy < 0) && (far || pv < 0.55)) || (far && c.len > H * 0.25))) return "tail";
    if (c.area > area * 0.4) return null;
    if (lateral && pv > 0.3 && pv < 0.92 && tv > 0.15) return winged && c.area > area * 0.035 ? "wing" : "arm";
    // Hanging down from the upper body (arms held low).
    if (pv > 0.35 && dy > 0 && Math.abs(dy) > Math.abs(dx) && tv > 0.08 && !fly) return "arm";
    return null;
  };
  const kinds = cands.map((c) => ({ c, kind: classify(c, facing) })).filter((x) => x.kind) as { c: Cand; kind: PartKind }[];
  // Keep the biggest few: wings and tails first, then arms.
  const rank: Record<PartKind, number> = { wing: 0, tail: 1, arm: 2, leg: 3 };
  kinds.sort((a, b) => rank[a.kind] - rank[b.kind] || b.c.area - a.c.area);
  let tails = 0, arms = 0, wings = 0;
  for (const { c, kind } of kinds) {
    if (parts.length >= MAX_PARTS) break;
    if (kind === "tail" && tails >= 1) continue;
    if (kind === "arm" && arms >= 2) continue;
    if (kind === "wing" && wings >= 4) continue;
    if (kind === "tail") tails++;
    if (kind === "arm") arms++;
    if (kind === "wing") wings++;
    parts.push({ kind, px: c.px, py: c.py, tx: c.tx, ty: c.ty, side: 0, front: 0, area: c.area });
    const k = parts.length;
    const region = new Uint8Array(n);
    for (const i of c.pix) region[i] = 1;
    const g = geodesic(region, c.attach, w, h);
    let gmax = 1;
    for (const i of c.pix) if (Number.isFinite(g[i]) && g[i] > gmax) gmax = g[i];
    const ramp = Math.max(1.5, Math.min(gmax * 0.35, H * 0.06));
    for (const i of c.pix) {
      const d = Number.isFinite(g[i]) ? g[i] : gmax;
      label[i] = k;
      weight[i] = smooth(0, ramp, d);
      along[i] = Math.min(1, d / gmax);
    }
  }
  // Arms swing opposite the leg on their side of the body: alternate by position.
  const armIdx = parts.map((p, i) => (p.kind === "arm" ? i : -1)).filter((i) => i >= 0).sort((a, b) => parts[a].px - parts[b].px);
  armIdx.forEach((i, k) => { parts[i].side = (k % 2) as 0 | 1; });
  return { ...out(), torso: torsoMask };
}

/** Short description of what was found, for audits ("2 legs, 1 tail"). */
export function describeParts(p: Pick<PartMap, "parts">): string {
  const count: Record<string, number> = {};
  for (const x of p.parts) count[x.kind] = (count[x.kind] ?? 0) + 1;
  const order: PartKind[] = ["leg", "arm", "wing", "tail"];
  const bits = order.filter((k) => count[k]).map((k) => `${count[k]} ${k}${count[k] > 1 ? "s" : ""}`);
  return bits.length ? bits.join(", ") : "whole body";
}
