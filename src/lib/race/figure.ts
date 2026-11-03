import { decodeZ, distanceField, partRadius, smoothGrid, type ReliefMap } from "@/lib/sizes/relief";
import type { PartKind, PartMap } from "./parts";

/**
 * A runner's mesh: the Sizes relief figure (lib/sizes/relief's
 * buildReliefMesh, copied here to change it) with a sculpted back and the
 * moving parts the part finder (lib/race/parts) found. Pure and
 * unit-tested; built in a worker while the race loads.
 *
 * - The front is the relief from the HOME render's depth estimate, as in
 *   Sizes. The back is inflated from the silhouette: a rounded profile
 *   from its distance field (as deep as each part is wide, up to a fifth
 *   of the figure), behind a heavily smoothed copy of the front's middle
 *   surface, so the figure looks solid from the side instead of like a
 *   cut-out. Front and back still meet on the outline, so the rim is
 *   closed. Wings stay thin.
 * - Every vertex carries its part (0: the body), how much it follows the
 *   part (ramping from 0 at the joint) and how far along the part it is.
 *   Where two parts come within a few cells of each other, both stop
 *   following there, so their triangles never stretch across the gap.
 */

/** Back inflation (units of L, the box's longest side). */
export const BODY = {
  /** Largest half-depth of the back (a fifth of the figure). */
  cap: 0.2,
  /** Depth as a share of the part's width (1: round). */
  round: 0.95,
  /** Smoothing passes for the surface the back is inflated behind (it shouldn't copy the front's detail). */
  soften: 6,
} as const;

export interface Joint {
  kind: PartKind;
  side: 0 | 1;
  front: 0 | 1;
  /** Stubby feet (the lower body stepping) rather than a found leg. */
  stub: boolean;
  /** The part's length as a share of the figure's height. */
  reach: number;
  /** In mesh units: the hinge, the middle (knee, elbow, mid-wing) and the tip. */
  pivot: [number, number, number];
  knee: [number, number, number];
  tip: [number, number, number];
}

export interface FigureMesh {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array | Uint16Array;
  /** Per vertex: part slot (0 = body, k = joints[k − 1]), follow weight, distance along the part. */
  part: Float32Array;
  joints: Joint[];
  /** Which way the head points in the render: −1 left, 1 right. */
  facing: -1 | 1;
  width: number;
  height: number;
  zMin: number;
  zMax: number;
  /** Mean thickness of the figure (units of L), front to back, over its covered vertices. */
  thickness: number;
}

const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };

export function buildFigureMesh(map: ReliefMap, box: { x: number; y: number; w: number; h: number; size: number }, segments: number, parts: PartMap | null, tune: { cap: number; round: number; soften: number } = BODY): FigureMesh {
  const L = Math.max(box.w, box.h);
  const W = box.w / L, H = box.h / L;
  const nx = Math.max(2, Math.round(segments * W)), ny = Math.max(2, Math.round(segments * H));
  const { w: mw, h: mh, data, channels } = map;
  const sample = (fx: number, fy: number, ch: number) => {
    const px = Math.max(0, Math.min(mw - 1, fx * mw - 0.5)), py = Math.max(0, Math.min(mh - 1, fy * mh - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1);
    const ax = px - x0, ay = py - y0;
    const at = (x: number, y: number) => data[(y * mw + x) * channels + ch];
    return (at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay) + (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay;
  };
  const cols = nx + 1, rows = ny + 1;
  const nGrid = cols * rows;
  const zf = new Float32Array(nGrid), zb = new Float32Array(nGrid), cov = new Float32Array(nGrid);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const fx = i / nx, fy = j / ny;
      const k = j * cols + i;
      zf[k] = decodeZ(sample(fx, fy, 0));
      zb[k] = decodeZ(sample(fx, fy, 1));
      cov[k] = sample(fx, fy, 2);
    }
  }

  // ---- Parts per grid vertex: the nearest labelled map pixel within ~1.5 px (so a part's outline cells move with it).
  const slot = new Uint8Array(nGrid), follow = new Float32Array(nGrid), along = new Float32Array(nGrid);
  if (parts && parts.parts.length && parts.w === mw && parts.h === mh) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const px = (i / nx) * mw - 0.5, py = (j / ny) * mh - 0.5;
        let best = Infinity, bl = 0, bw = 0, ba = 0;
        const x0 = Math.floor(px) - 1, y0 = Math.floor(py) - 1;
        for (let y = y0; y <= y0 + 3; y++) {
          if (y < 0 || y >= mh) continue;
          for (let x = x0; x <= x0 + 3; x++) {
            if (x < 0 || x >= mw) continue;
            const q = y * mw + x;
            const d = Math.hypot(x - px, y - py);
            if (d > 1.6) continue;
            const lab = parts.label[q];
            // Inside the figure, the pixel's own label wins (0 included); outside it, the nearest labelled pixel.
            const inside = cov[k] > 127;
            const score = lab ? d : inside ? d + 0.01 : Infinity;
            if (score < best) { best = score; bl = lab; bw = parts.weight[q]; ba = parts.along[q]; }
          }
        }
        slot[k] = bl;
        follow[k] = bl ? bw : 0;
        along[k] = bl ? ba : 0;
      }
    }
    // Where a part meets a different part (or the body) inside the figure, it eases to a stop over a few cells.
    const R = 3;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (!slot[k] || follow[k] <= 0) continue;
        let dmin = Infinity;
        for (let dj = -R; dj <= R; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= rows) continue;
          for (let di = -R; di <= R; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= cols) continue;
            const q = jj * cols + ii;
            if (slot[q] === slot[k]) continue;
            if (!slot[q] && cov[q] <= 127) continue;
            dmin = Math.min(dmin, Math.hypot(di, dj));
          }
        }
        if (dmin < Infinity) follow[k] *= smoothstep(0.9, 2.6, dmin);
      }
    }
  }

  // ---- Surfaces: smooth the 8-bit steps (as Sizes does), then sculpt the back.
  {
    const mid = new Float32Array(nGrid), half = new Float32Array(nGrid), half0 = new Float32Array(nGrid);
    for (let k = 0; k < nGrid; k++) { mid[k] = (zf[k] + zb[k]) / 2; half[k] = half0[k] = (zf[k] - zb[k]) / 2; }
    smoothGrid(mid, cov, cols, rows, 2);
    smoothGrid(half, cov, cols, rows, 2);
    const closed = new Float32Array(nGrid);
    for (let k = 0; k < nGrid; k++) {
      closed[k] = Math.min(1, Math.max(0, half0[k] / 0.004));
      const h = half[k] * closed[k];
      zf[k] = mid[k] + h;
      zb[k] = mid[k] - h;
    }
    // Inflation: the silhouette's distance field on the grid (cells → units of L) and each part's radius.
    const solid = new Uint8Array(nGrid);
    for (let k = 0; k < nGrid; k++) if (cov[k] > 127 && half0[k] > 0.0015) solid[k] = 1;
    const cell = W / nx;
    const dist = distanceField(solid, cols, rows);
    const rad = partRadius(dist, cols, rows);
    const soft = mid.slice();
    smoothGrid(soft, cov, cols, rows, tune.soften);
    for (let k = 0; k < nGrid; k++) {
      if (!solid[k]) continue;
      const d = dist[k] * cell;
      const r = Math.max(cell * 0.5, Math.min((rad[k] || dist[k]) * cell, tune.cap));
      const hb = (d >= r ? r : Math.sqrt(Math.max(0, 2 * r * d - d * d))) * tune.round;
      // Wings stay thin membranes.
      const s = slot[k] && parts ? parts.parts[slot[k] - 1] : null;
      const keep = s && s.kind === "wing" ? 0 : 1;
      const target = soft[k] - hb;
      // Ease in from the outline (where front and back meet), and never in front of the existing back.
      const k2 = smoothstep(0, 2.2, dist[k]) * keep;
      zb[k] = Math.min(zb[k], zb[k] + (target - zb[k]) * k2);
      // The front never sinks behind the new back.
      if (zf[k] < zb[k]) zf[k] = zb[k];
    }
  }

  // ---- Cells touching the figure (as Sizes).
  const keep = new Uint8Array(nx * ny);
  const used = new Int32Array(nGrid).fill(-1);
  let cells = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * cols + i;
      if (cov[a] > 2 || cov[a + 1] > 2 || cov[a + cols] > 2 || cov[a + cols + 1] > 2) {
        keep[j * nx + i] = 1;
        cells++;
        used[a] = used[a + 1] = used[a + cols] = used[a + cols + 1] = 0;
      }
    }
  }
  let nv = 0;
  for (let k = 0; k < used.length; k++) if (used[k] === 0) used[k] = nv++;
  const position = new Float32Array(nv * 2 * 3), normal = new Float32Array(nv * 2 * 3), uv = new Float32Array(nv * 2 * 2), part = new Float32Array(nv * 2 * 3);
  const dx = W / nx, dy = H / ny;
  let zMin = Infinity, zMax = -Infinity, thick = 0, thickN = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const v = used[k];
      if (v < 0) continue;
      const x = -W / 2 + i * dx, y = H - j * dy;
      const u = (box.x + (i / nx) * box.w) / box.size, t = 1 - (box.y + (j / ny) * box.h) / box.size;
      if (cov[k] > 127) { thick += zf[k] - zb[k]; thickN++; }
      for (let side = 0; side < 2; side++) {
        const z = side ? zb : zf;
        const o = v + side * nv;
        position[o * 3] = x;
        position[o * 3 + 1] = y;
        position[o * 3 + 2] = z[k];
        uv[o * 2] = u;
        uv[o * 2 + 1] = t;
        part[o * 3] = slot[k];
        part[o * 3 + 1] = follow[k];
        part[o * 3 + 2] = along[k];
        const il = Math.max(0, i - 1), ir = Math.min(nx, i + 1), ju = Math.max(0, j - 1), jd = Math.min(ny, j + 1);
        const dzdx = (z[j * cols + ir] - z[j * cols + il]) / ((ir - il) * dx);
        const dzdy = (z[ju * cols + i] - z[jd * cols + i]) / ((jd - ju) * dy);
        const s = side ? -1 : 1;
        const nxv = -dzdx * s, nyv = -dzdy * s, nzv = s;
        const len = Math.hypot(nxv, nyv, nzv) || 1;
        normal[o * 3] = nxv / len;
        normal[o * 3 + 1] = nyv / len;
        normal[o * 3 + 2] = nzv / len;
        if (z[k] < zMin) zMin = z[k];
        if (z[k] > zMax) zMax = z[k];
      }
    }
  }
  const total = cells * 12;
  const index = nv * 2 > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let p = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!keep[j * nx + i]) continue;
      const a = used[j * cols + i], b = used[j * cols + i + 1], c = used[(j + 1) * cols + i], d = used[(j + 1) * cols + i + 1];
      index[p++] = a; index[p++] = c; index[p++] = b;
      index[p++] = b; index[p++] = c; index[p++] = d;
      index[p++] = a + nv; index[p++] = b + nv; index[p++] = c + nv;
      index[p++] = b + nv; index[p++] = d + nv; index[p++] = c + nv;
    }
  }
  // Joints in mesh units, at the depth of the body's middle there.
  const toMesh = (px: number, py: number): [number, number, number] => {
    const fx = (px + 0.5) / mw, fy = (py + 0.5) / mh;
    const mx = Math.max(0, Math.min(mw - 1, Math.round(px))), my = Math.max(0, Math.min(mh - 1, Math.round(py)));
    const z = parts ? parts.mid[my * mw + mx] : 0;
    return [-W / 2 + fx * W, H - fy * H, z];
  };
  const joints: Joint[] = (parts?.parts ?? []).map((q) => {
    const pivot = toMesh(q.px, q.py), tip = toMesh(q.tx, q.ty);
    const knee: [number, number, number] = [(pivot[0] + tip[0]) / 2, (pivot[1] + tip[1]) / 2, (pivot[2] + tip[2]) / 2];
    return { kind: q.kind, side: q.side, front: q.front, stub: !!q.stub, reach: Math.hypot(tip[0] - pivot[0], tip[1] - pivot[1]) / Math.max(1e-6, H), pivot, knee, tip };
  });
  return {
    position, normal, uv, index, part, joints,
    facing: parts?.facing ?? -1,
    width: W, height: H,
    zMin: Number.isFinite(zMin) ? zMin : 0, zMax: Number.isFinite(zMax) ? zMax : 0,
    thickness: thickN ? thick / thickN : 0,
  };
}
