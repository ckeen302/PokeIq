/**
 * Relief figures for /pokedex/sizes: how a flat Pokémon HOME render becomes
 * a solid 3D figure. Pure and unit-tested; the bake runs at build time
 * (scripts/sizes-depth.ts), the mesh builder in the browser.
 *
 * A relief map covers the render's visible box. Each cell stores the
 * figure's front surface and back surface (as z / L + 0.5, where L is the
 * box's longest side) and whether any of the render's pixels in that cell
 * are visible. The front comes from a monocular depth estimate (which
 * parts are nearer), the thickness behind it from an inflation of the
 * silhouette: a rounded profile that is 0 on the outline, so front and
 * back meet there and the figure is closed.
 */

/** Relief maps are baked at this size on the box's longest side. */
export const DEPTH_RES = 128;

/** Bake tuning (shares of L, the box's longest side). */
export const RELIEF = {
  /** How far apart the nearest and farthest parts stand. */
  depth: 0.3,
  /** Largest half-thickness of a part (caps big flat parts such as wings). */
  cap: 0.11,
  /** Thickness as a share of the part's width (1 would be perfectly round). */
  round: 0.85,
  /** Share of the thickness in front of the depth surface (the rest is behind). */
  front: 0.38,
  /** Outline band (px at the bake size) kept at zero thickness, so the mesh closes inside the visible edge. */
  margin: 0.7,
} as const;

export interface BakeInput {
  w: number;
  h: number;
  /** Relative nearness, 0 (far) to 1 (near), any affine scale. */
  depth: Float32Array;
  /** Area-averaged alpha (0..1). */
  alpha: Float32Array;
  /** 1 where any source pixel in the cell is visible. */
  cover: Float32Array;
}

/** Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher) of a binary mask: distance to the nearest outside pixel. */
export function distanceField(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? INF : 0;
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  // Columns, then rows. Pixels beyond the border count as outside, so pad by treating the edges as outside.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    // Distance to the image border also bounds it (the box is tight around the figure).
    const x = i % w, y = (i / w) | 0;
    const border = Math.min(x + 1, y + 1, w - x, h - y);
    out[i] = Math.min(Math.sqrt(grid[i]), border);
  }
  return out;
}

/** Local part radius: the radius of the largest inscribed disc covering each pixel (from the distance field's ridge). */
export function partRadius(dist: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = dist[y * w + x];
      if (r < 0.5) continue;
      // Only ridge pixels (local maxima along some direction) matter; skip pixels with a strictly bigger neighbour on both sides of an axis.
      const l = x > 0 ? dist[y * w + x - 1] : 0, rr = x < w - 1 ? dist[y * w + x + 1] : 0;
      const u = y > 0 ? dist[(y - 1) * w + x] : 0, dn = y < h - 1 ? dist[(y + 1) * w + x] : 0;
      if ((l > r && rr > r) || (u > r && dn > r) || (l > r + 0.5 && rr >= r) || (u > r + 0.5 && dn >= r) || (rr > r + 0.5 && l >= r) || (dn > r + 0.5 && u >= r)) continue;
      const R = Math.ceil(r);
      const r2 = r * r;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || dx * dx + dy * dy > r2) continue;
          const j = yy * w + xx;
          if (out[j] < r) out[j] = r;
        }
      }
    }
  }
  return out;
}

/** Gaussian blur of `v` weighted by `m` (values outside the mask don't leak in). */
function maskedBlur(v: Float32Array, m: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const R = Math.max(1, Math.ceil(sigma * 2.5));
  const k: number[] = [];
  for (let i = -R; i <= R; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const tmpV = new Float32Array(w * h), tmpM = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sv = 0, sm = 0;
      for (let i = -R; i <= R; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        const j = y * w + xx;
        sv += v[j] * m[j] * k[i + R];
        sm += m[j] * k[i + R];
      }
      tmpV[y * w + x] = sv;
      tmpM[y * w + x] = sm;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sv = 0, sm = 0;
      for (let i = -R; i <= R; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        const j = yy * w + x;
        sv += tmpV[j] * k[i + R];
        sm += tmpM[j] * k[i + R];
      }
      out[y * w + x] = sm > 1e-6 ? sv / sm : 0;
    }
  }
  return out;
}

const quantile = (vals: number[], q: number) => {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

const enc = (zOverL: number) => Math.max(0, Math.min(255, Math.round((zOverL + 0.5) * 255)));
export const decodeZ = (byte: number) => byte / 255 - 0.5;

/** Bakes a relief map: RGB bytes (front, back, coverage), w × h. */
export function bakeRelief(input: BakeInput, tune = RELIEF): { rgb: Uint8Array; front: Float32Array; back: Float32Array } {
  const { w, h, depth, alpha, cover } = input;
  const n = w * h;
  const L = Math.max(w, h);
  const mask = new Uint8Array(n);
  const mf = new Float32Array(n);
  for (let i = 0; i < n; i++) if (alpha[i] >= 0.5) { mask[i] = 1; mf[i] = 1; }

  // Nearness inside the silhouette, normalised robustly and smoothed.
  const inside: number[] = [];
  for (let i = 0; i < n; i++) if (mask[i]) inside.push(depth[i]);
  const lo = quantile(inside, 0.02), hi = quantile(inside, 0.98);
  const span = Math.max(1e-4, hi - lo);
  const near = new Float32Array(n);
  for (let i = 0; i < n; i++) near[i] = Math.max(0, Math.min(1, (depth[i] - lo) / span));
  const nearS = maskedBlur(near, mf, w, h, 1.1);
  const mid = quantile(inside.map((v) => Math.max(0, Math.min(1, (v - lo) / span))), 0.5);

  // Thickness: a round profile across each part, capped for broad flat parts.
  const dist = distanceField(mask, w, h);
  const radius = partRadius(dist, w, h);
  const cap = tune.cap * L;
  const front = new Float32Array(n), back = new Float32Array(n);
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const d = Math.max(0, dist[i] - tune.margin);
    const r = Math.max(0.5, Math.min(radius[i] || dist[i], cap));
    const half = d >= r ? r : Math.sqrt(Math.max(0, 2 * r * d - d * d));
    const thick = 2 * half * tune.round;
    const c = (nearS[i] - mid) * tune.depth * L;
    front[i] = (c + thick * tune.front) / L;
    back[i] = (c - thick * (1 - tune.front)) / L;
    known[i] = 1;
  }
  // Outside the silhouette: carry the outline's surface outwards (front = back), so cells across the edge don't fold to z = 0.
  let frontier = true;
  for (let pass = 0; pass < 6 && frontier; pass++) {
    frontier = false;
    const add: [number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let s = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (known[j] === 1 || (known[j] === 2 && pass > 0)) { s += (front[j] + back[j]) / 2; c++; }
        }
        if (c) add.push([i, s / c]);
      }
    }
    for (const [i, v] of add) { front[i] = v; back[i] = v; known[i] = 2; frontier = true; }
  }
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = enc(front[i]);
    rgb[i * 3 + 1] = enc(back[i]);
    rgb[i * 3 + 2] = cover[i] > 0 || mask[i] ? 255 : 0;
  }
  return { rgb, front, back };
}

/** Separable [1 4 6 4 1] blur of grid values over covered vertices only (coverage-weighted), `passes` times. */
export function smoothGrid(z: Float32Array, cov: Float32Array, cols: number, rows: number, passes: number) {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(z.length);
  for (let p = 0; p < passes; p++) {
    for (const horizontal of [true, false]) {
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const c = j * cols + i;
          if (cov[c] <= 2) { tmp[c] = z[c]; continue; }
          let s = 0, w = 0;
          for (let t = -2; t <= 2; t++) {
            const ii = horizontal ? i + t : i, jj = horizontal ? j : j + t;
            if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
            const q = jj * cols + ii;
            if (cov[q] <= 2) continue;
            s += z[q] * k[t + 2];
            w += k[t + 2];
          }
          tmp[c] = w ? s / w : z[c];
        }
      }
      z.set(tmp);
    }
  }
}

export interface ReliefMap {
  w: number;
  h: number;
  /** RGBA or RGB bytes as decoded (front, back, coverage). */
  data: Uint8Array | Uint8ClampedArray;
  channels: 3 | 4;
}

export interface ReliefMesh {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array | Uint16Array;
  /** Box size in units of L (the longest side = 1). */
  width: number;
  height: number;
  /** Nearest and farthest z (units of L). */
  zMin: number;
  zMax: number;
}

/**
 * The figure's mesh: a front and a back sheet over the box, only over cells
 * that touch the visible figure. Units: the box's longest side is 1; x is
 * centred, y runs up from the figure's lowest pixel (y = 0, the ground),
 * the front faces +z. UVs address the full render (`box` in its pixels,
 * `size` its width), flipped for WebGL.
 */
export function buildReliefMesh(map: ReliefMap, box: { x: number; y: number; w: number; h: number; size: number }, segments: number): ReliefMesh {
  const L = Math.max(box.w, box.h);
  const W = box.w / L, H = box.h / L;
  const nx = Math.max(2, Math.round(segments * W)), ny = Math.max(2, Math.round(segments * H));
  const { w: mw, h: mh, data, channels } = map;
  const sample = (fx: number, fy: number, ch: number) => {
    // Bilinear in map pixel centres.
    const px = Math.max(0, Math.min(mw - 1, fx * mw - 0.5)), py = Math.max(0, Math.min(mh - 1, fy * mh - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1);
    const ax = px - x0, ay = py - y0;
    const at = (x: number, y: number) => data[(y * mw + x) * channels + ch];
    return (at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay) + (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay;
  };
  const cols = nx + 1, rows = ny + 1;
  const zf = new Float32Array(cols * rows), zb = new Float32Array(cols * rows), cov = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const fx = i / nx, fy = j / ny; // fy = 0 at the top of the box
      const k = j * cols + i;
      zf[k] = decodeZ(sample(fx, fy, 0));
      zb[k] = decodeZ(sample(fx, fy, 1));
      cov[k] = sample(fx, fy, 2);
    }
  }
  // Smooth over covered vertices: 8-bit maps leave contour steps that would show as ripples in the lighting.
  // The centre surface and the thickness are smoothed apart, and the outline keeps zero thickness so the figure stays closed.
  {
    const n = zf.length;
    const mid = new Float32Array(n), half = new Float32Array(n), half0 = new Float32Array(n);
    for (let k = 0; k < n; k++) { mid[k] = (zf[k] + zb[k]) / 2; half[k] = half0[k] = (zf[k] - zb[k]) / 2; }
    smoothGrid(mid, cov, cols, rows, 2);
    smoothGrid(half, cov, cols, rows, 2);
    for (let k = 0; k < n; k++) {
      const h = half[k] * Math.min(1, Math.max(0, half0[k] / 0.004));
      zf[k] = mid[k] + h;
      zb[k] = mid[k] - h;
    }
  }
  // Cells touching the figure.
  const keep = new Uint8Array(nx * ny);
  const used = new Int32Array(cols * rows).fill(-1);
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
  const position = new Float32Array(nv * 2 * 3), normal = new Float32Array(nv * 2 * 3), uv = new Float32Array(nv * 2 * 2);
  const dx = W / nx, dy = H / ny;
  let zMin = Infinity, zMax = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const v = used[k];
      if (v < 0) continue;
      const x = -W / 2 + i * dx, y = H - j * dy;
      const u = (box.x + (i / nx) * box.w) / box.size, t = 1 - (box.y + (j / ny) * box.h) / box.size;
      for (let side = 0; side < 2; side++) {
        const z = side ? zb : zf;
        const o = v + side * nv;
        position[o * 3] = x;
        position[o * 3 + 1] = y;
        position[o * 3 + 2] = z[k];
        uv[o * 2] = u;
        uv[o * 2 + 1] = t;
        // Surface gradient by central differences (one-sided at the border).
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
      // Front (counter-clockwise seen from +z): a (top-left), c (bottom-left), b (top-right) …
      index[p++] = a; index[p++] = c; index[p++] = b;
      index[p++] = b; index[p++] = c; index[p++] = d;
      // Back: reversed.
      index[p++] = a + nv; index[p++] = b + nv; index[p++] = c + nv;
      index[p++] = b + nv; index[p++] = d + nv; index[p++] = c + nv;
    }
  }
  return { position, normal, uv, index, width: W, height: H, zMin: Number.isFinite(zMin) ? zMin : 0, zMax: Number.isFinite(zMax) ? zMax : 0 };
}
