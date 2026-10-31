/**
 * PokéGuessr exact spots for the DS games' overworld (Diamond / Pearl /
 * Platinum, HeartGold / SoulSilver): the camera. Their overworld is drawn in
 * 3D with a fixed tilted camera, so a screenshot shows the ground in
 * perspective (a row near the top of the screen covers about 18 % more
 * ground than one near the bottom), while the wikis' map rips are flat and
 * top-down. Flat template matching of the screenshot fails; matching the
 * screenshot flattened back to top-down works.
 *
 * The camera is one homography per game family (screen px → rip px, up to
 * where the player stands), fitted once from known pairs:
 * scripts/geo/spot-ds-pairs.json holds, for in-game screenshots, points
 * matched between the screenshot (native px, the top of the DS screen) and
 * its map rip (feature matching with a robust homography, inliers only).
 * `fitCamera` fits one homography to all of them, each screenshot free to sit
 * anywhere on its rip (a translation per shot), and drops screenshots whose
 * points disagree with the rest (another camera: a cutscene, a zoom).
 */
import type { Gray, Rgb } from "./spot-match";

export type H3 = number[][];

/** Applies a homography. */
export const apply = (H: H3, x: number, y: number): [number, number] => {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
};

/** Solves A x = b (n × n) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const mul = (A: H3, B: H3): H3 => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));

export function invert(H: H3): H3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** Least-squares homography src → dst (normalised DLT with h33 = 1). */
export function homography(src: [number, number][], dst: [number, number][]): H3 | null {
  if (src.length < 4) return null;
  const norm = (pts: [number, number][]): H3 => {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const d = pts.reduce((s, p) => s + Math.hypot(p[0] - mx, p[1] - my), 0) / pts.length || 1;
    const k = Math.SQRT2 / d;
    return [
      [k, 0, -k * mx],
      [0, k, -k * my],
      [0, 0, 1],
    ];
  };
  const Ts = norm(src);
  const Td = norm(dst);
  const ATA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const ATb = new Array(8).fill(0);
  const add = (row: number[], v: number) => {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) ATA[i][j] += row[i] * row[j];
      ATb[i] += row[i] * v;
    }
  };
  for (let i = 0; i < src.length; i++) {
    const [x, y] = apply(Ts, ...src[i]);
    const [u, v] = apply(Td, ...dst[i]);
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(ATA, ATb);
  if (!h) return null;
  const Hn: H3 = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
  const H = mul(invert(Td), mul(Hn, Ts));
  return H.map((r) => r.map((v) => v / H[2][2]));
}

export interface PairSet {
  id: string;
  rip: string;
  /** [screen x, screen y, rip x, rip y] (native px). */
  pairs: [number, number, number, number][];
}

/** Where the player stands on the screen (the camera follows them): the middle of the DS top screen. */
export const PLAYER: [number, number] = [128, 96];

export interface Camera {
  /** Screen px → ground px relative to the player (PLAYER maps to 0, 0). */
  H: H3;
  /** The shots it was fitted on, and each one's median residual (px). */
  used: { id: string; medianPx: number }[];
  dropped: { id: string; medianPx: number }[];
}

const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/**
 * One camera for a game family from its pair sets (see the top of the file):
 * alternately each shot's translation (the median offset of its points) and
 * the homography through every point less its shot's translation; a shot
 * whose median residual exceeds `dropPx` is dropped and the fit redone.
 */
export function fitCamera(sets: PairSet[], dropPx = 3): Camera | null {
  let use = sets.filter((s) => s.pairs.length >= 8);
  const dropped: Camera["dropped"] = [];
  for (let round = 0; round < 6; round++) {
    if (use.length < 3) return null;
    const t = new Map(use.map((s) => [s.id, [median(s.pairs.map((p) => p[2] - p[0])), median(s.pairs.map((p) => p[3] - p[1]))]]));
    let H: H3 | null = null;
    for (let it = 0; it < 12; it++) {
      H = homography(
        use.flatMap((s) => s.pairs.map((p) => [p[0], p[1]] as [number, number])),
        use.flatMap((s) => s.pairs.map((p) => [p[2] - t.get(s.id)![0], p[3] - t.get(s.id)![1]] as [number, number]))
      );
      if (!H) return null;
      for (const s of use) {
        const d = s.pairs.map((p) => {
          const [x, y] = apply(H!, p[0], p[1]);
          return [p[2] - x, p[3] - y];
        });
        t.set(s.id, [median(d.map((q) => q[0])), median(d.map((q) => q[1]))]);
      }
    }
    const res = use.map((s) => ({
      id: s.id,
      medianPx:
        Math.round(
          median(
            s.pairs.map((p) => {
              const [x, y] = apply(H!, p[0], p[1]);
              return Math.hypot(x + t.get(s.id)![0] - p[2], y + t.get(s.id)![1] - p[3]);
            })
          ) * 100
        ) / 100,
    }));
    const worst = res.reduce((a, b) => (b.medianPx > a.medianPx ? b : a));
    if (worst.medianPx > dropPx) {
      dropped.push(worst);
      use = use.filter((s) => s.id !== worst.id);
      continue;
    }
    // Re-centre so the player's spot is the ground origin.
    const [cx, cy] = apply(H!, ...PLAYER);
    const T: H3 = [
      [1, 0, -cx],
      [0, 1, -cy],
      [0, 0, 1],
    ];
    const Hc = mul(T, H!);
    return { H: Hc.map((r) => r.map((v) => v / Hc[2][2])), used: res, dropped };
  }
  return null;
}

/**
 * A screenshot (native px, the top of the DS screen, `rows` tall) flattened to
 * top-down ground px through the camera: the largest ground rectangle the
 * screen sees, nearest-neighbour. `origin` is where the player stands in it.
 */
export function flatten(shot: Rgb, cam: Camera): { img: Rgb; g: Gray; origin: [number, number] } {
  const H = cam.H;
  const corners = [apply(H, 0, 0), apply(H, shot.w, 0), apply(H, 0, shot.h), apply(H, shot.w, shot.h)];
  const x0 = Math.ceil(Math.max(corners[0][0], corners[2][0]));
  const x1 = Math.floor(Math.min(corners[1][0], corners[3][0]));
  const y0 = Math.ceil(Math.max(corners[0][1], corners[1][1]));
  const y1 = Math.floor(Math.min(corners[2][1], corners[3][1]));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const inv = invert(H);
  const data = new Uint8Array(w * h * 3);
  const px = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [sx, sy] = apply(inv, x0 + x + 0.5, y0 + y + 0.5);
      const ix = Math.min(shot.w - 1, Math.max(0, Math.floor(sx)));
      const iy = Math.min(shot.h - 1, Math.max(0, Math.floor(sy)));
      const s = (iy * shot.w + ix) * 3;
      const d = (y * w + x) * 3;
      data[d] = shot.data[s];
      data[d + 1] = shot.data[s + 1];
      data[d + 2] = shot.data[s + 2];
      px[y * w + x] = 0.299 * data[d] + 0.587 * data[d + 1] + 0.114 * data[d + 2];
    }
  return { img: { w, h, data }, g: { w, h, px }, origin: [-x0, -y0] };
}
