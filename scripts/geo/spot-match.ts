/**
 * PokéGuessr exact spots, 2D games: where on a place's full map a sprite
 * game's screenshot was taken. The shot goes back to its native pixels (the
 * stored copy is a whole-number nearest-neighbour enlargement), then it's
 * slid over the map: normalised cross-correlation on brightness, coarse
 * (a quarter size) everywhere, then exact around the best few. A match is
 * kept only when it's clearly better than any other place on the map (the
 * runner-up at least MIN_MARGIN behind) and most of the shot's pixels agree
 * with the map's (people walk around, the player stands in the middle).
 * Deterministic: no randomness, ties go to the first position.
 */

export interface Rgb {
  w: number;
  h: number;
  /** RGB, row-major. */
  data: Uint8Array;
}
export interface Gray {
  w: number;
  h: number;
  px: Float32Array;
}

/** Thresholds for keeping a match. */
export const MATCH = {
  /** Correlation of the best position. */
  MIN_SCORE: 0.7,
  /** The runner-up (anywhere at least half a view away) is at least this much lower. */
  MIN_MARGIN: 0.12,
  /** Share of the shot's pixels within AGREE_TOL of the map's (after matching brightness). */
  MIN_AGREE: 0.6,
  AGREE_TOL: 24,
  /** Coarse search scale, and how many coarse peaks are refined. */
  COARSE: 4,
  PEAKS: 12,
};

/** The largest whole number k (up to max) such that the image is k × k blocks of one colour. */
export function nativeScale(img: Rgb, max = 12): number {
  for (let k = max; k >= 2; k--) {
    if (img.w % k || img.h % k) continue;
    let bad = 0;
    const limit = ((img.w / k) * (img.h / k)) / 500;
    for (let y = 0; y < img.h && bad <= limit; y += k)
      for (let x = 0; x < img.w && bad <= limit; x += k) {
        const i0 = (y * img.w + x) * 3;
        // Corners of the block are enough to rule a scale out quickly; then the whole block.
        let same = true;
        for (let dy = 0; dy < k && same; dy++)
          for (let dx = 0; dx < k && same; dx++) {
            const i = ((y + dy) * img.w + x + dx) * 3;
            same = img.data[i] === img.data[i0] && img.data[i + 1] === img.data[i0 + 1] && img.data[i + 2] === img.data[i0 + 2];
          }
        if (!same) bad++;
      }
    if (bad <= limit) return k;
  }
  return 1;
}

/** Every k-th pixel (the block's top-left): back to native pixels. */
export function shrink(img: Rgb, k: number): Rgb {
  if (k === 1) return img;
  const w = Math.floor(img.w / k);
  const h = Math.floor(img.h / k);
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * k * img.w + x * k) * 3;
      const d = (y * w + x) * 3;
      data[d] = img.data[s];
      data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2];
    }
  return { w, h, data };
}

export function gray(img: Rgb): Gray {
  const px = new Float32Array(img.w * img.h);
  for (let i = 0; i < px.length; i++) px[i] = 0.299 * img.data[i * 3] + 0.587 * img.data[i * 3 + 1] + 0.114 * img.data[i * 3 + 2];
  return { w: img.w, h: img.h, px };
}

/** Box-average down by f. */
export function boxDown(g: Gray, f: number): Gray {
  const w = Math.floor(g.w / f);
  const h = Math.floor(g.h / f);
  const px = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += g.px[(y * f + dy) * g.w + x * f + dx];
      px[y * w + x] = s / (f * f);
    }
  return { w, h, px };
}

/** Integral images of a map (sums and sums of squares) for windowed mean and variance. */
function integrals(g: Gray) {
  const W = g.w + 1;
  const s = new Float64Array(W * (g.h + 1));
  const q = new Float64Array(W * (g.h + 1));
  for (let y = 0; y < g.h; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < g.w; x++) {
      const v = g.px[y * g.w + x];
      rs += v;
      rq += v * v;
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + rs;
      q[(y + 1) * W + x + 1] = q[y * W + x + 1] + rq;
    }
  }
  const box = (a: Float64Array, x: number, y: number, w: number, h: number) => a[(y + h) * W + x + w] - a[y * W + x + w] - a[(y + h) * W + x] + a[y * W + x];
  return { sum: (x: number, y: number, w: number, h: number) => box(s, x, y, w, h), sq: (x: number, y: number, w: number, h: number) => box(q, x, y, w, h) };
}

/** A template ready to correlate: its pixels less their mean, and their norm. */
function prepare(t: Gray) {
  let mean = 0;
  for (const v of t.px) mean += v;
  mean /= t.px.length;
  const z = new Float32Array(t.px.length);
  let norm = 0;
  for (let i = 0; i < z.length; i++) {
    z[i] = t.px[i] - mean;
    norm += z[i] * z[i];
  }
  return { w: t.w, h: t.h, z, norm: Math.sqrt(norm), mean };
}

type Prepared = ReturnType<typeof prepare>;
type Integrals = ReturnType<typeof integrals>;

function ncc(t: Prepared, m: Gray, I: Integrals, x: number, y: number): number {
  const n = t.w * t.h;
  const s = I.sum(x, y, t.w, t.h);
  const varM = I.sq(x, y, t.w, t.h) - (s * s) / n;
  if (varM <= 1e-6 || t.norm <= 1e-6) return 0;
  let dot = 0;
  for (let ty = 0; ty < t.h; ty++) {
    const mo = (y + ty) * m.w + x;
    const to = ty * t.w;
    for (let tx = 0; tx < t.w; tx++) dot += t.z[to + tx] * m.px[mo + tx];
  }
  return dot / (t.norm * Math.sqrt(varM));
}

export interface Candidate {
  x: number;
  y: number;
  score: number;
}

export interface MatchResult {
  /** Native size of the shot as matched. */
  w: number;
  h: number;
  best: Candidate & { agree: number };
  /** The best position at least half a view away from `best`, if any. */
  second: Candidate | null;
  ok: boolean;
  reason?: string;
}

/** Share of the shot's pixels that agree with the map at (x, y), after a brightness fit. */
function agreement(t: Gray, m: Gray, x: number, y: number): number {
  let [st, sm, stt, stm] = [0, 0, 0, 0];
  const n = t.w * t.h;
  for (let ty = 0; ty < t.h; ty++)
    for (let tx = 0; tx < t.w; tx++) {
      const a = m.px[(y + ty) * m.w + x + tx];
      const b = t.px[ty * t.w + tx];
      st += b;
      sm += a;
      stt += b * b;
      stm += b * a;
    }
  const varT = stt - (st * st) / n;
  const gain = varT > 1e-6 ? (stm - (st * sm) / n) / varT : 1;
  const off = (sm - gain * st) / n;
  let ok = 0;
  for (let ty = 0; ty < t.h; ty++)
    for (let tx = 0; tx < t.w; tx++) if (Math.abs(m.px[(y + ty) * m.w + x + tx] - (gain * t.px[ty * t.w + tx] + off)) <= MATCH.AGREE_TOL) ok++;
  return ok / n;
}

/**
 * The shot's place on the map (both native pixels, brightness). Every
 * position is scored coarsely, the best few peaks exactly (±COARSE), and the
 * runner-up is the best exact peak at least half the shot's size away.
 */
export function matchShot(shot: Gray, map: Gray): MatchResult {
  const fail = (reason: string): MatchResult => ({ w: shot.w, h: shot.h, best: { x: 0, y: 0, score: 0, agree: 0 }, second: null, ok: false, reason });
  if (shot.w > map.w || shot.h > map.h) return fail("shot larger than the map");
  if (shot.w < 32 || shot.h < 32) return fail("shot too small");
  // Coarser for a DS / GBA view (bigger), so a big map is searched as fast as a Game Boy one.
  const C = shot.w >= 200 ? MATCH.COARSE * 2 : MATCH.COARSE;
  const cs = boxDown(shot, C);
  const cm = boxDown(map, C);
  const ct = prepare(cs);
  const ci = integrals(cm);
  const nx = cm.w - cs.w + 1;
  const ny = cm.h - cs.h + 1;
  const coarse = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) coarse[y * nx + x] = ncc(ct, cm, ci, x, y);
  // Coarse peaks: local maxima, best first, kept apart by a quarter of the shot.
  const sep = Math.max(2, Math.floor(Math.min(cs.w, cs.h) / 4));
  const order = [...coarse.keys()].sort((a, b) => coarse[b] - coarse[a] || a - b);
  const peaks: Candidate[] = [];
  for (const i of order) {
    if (peaks.length >= MATCH.PEAKS * 3) break;
    const [x, y] = [i % nx, Math.floor(i / nx)];
    if (peaks.some((p) => Math.abs(p.x - x) < sep && Math.abs(p.y - y) < sep)) continue;
    peaks.push({ x, y, score: coarse[i] });
  }
  // Each peak refined at half size (±C/2 + 1), then exactly (±2).
  const hs = boxDown(shot, 2);
  const hm = boxDown(map, 2);
  const ht = prepare(hs);
  const hi = integrals(hm);
  const ft = prepare(shot);
  const fi = integrals(map);
  const search = (t: Prepared, m: Gray, I: Integrals, cx: number, cy: number, r: number): Candidate => {
    let best: Candidate = { x: cx, y: cy, score: -Infinity };
    for (let y = Math.max(0, cy - r); y <= Math.min(m.h - t.h, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(m.w - t.w, cx + r); x++) {
        const s = ncc(t, m, I, x, y);
        if (s > best.score) best = { x, y, score: s };
      }
    return best;
  };
  const refined: Candidate[] = peaks.slice(0, MATCH.PEAKS).map((p) => {
    const half = search(ht, hm, hi, Math.round((p.x * C) / 2), Math.round((p.y * C) / 2), C / 2 + 1);
    return search(ft, map, fi, half.x * 2, half.y * 2, 2);
  });
  refined.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const top = refined[0];
  const away = (c: Candidate) => Math.abs(c.x - top.x) >= shot.w / 2 || Math.abs(c.y - top.y) >= shot.h / 2;
  // The runner-up: the best refined peak away from the top, or failing that the best coarse score away from it.
  let second: Candidate | null = refined.find(away) ?? null;
  const coarseAway = peaks.find((p) => away({ x: p.x * C, y: p.y * C, score: p.score }));
  if (coarseAway && (!second || coarseAway.score > second.score)) second = { x: coarseAway.x * C, y: coarseAway.y * C, score: coarseAway.score };
  const agree = agreement(shot, map, top.x, top.y);
  const best = { ...top, score: round3(top.score), agree: round3(agree) };
  const res: MatchResult = { w: shot.w, h: shot.h, best, second: second ? { ...second, score: round3(second.score) } : null, ok: true };
  if (top.score < MATCH.MIN_SCORE) return { ...res, ok: false, reason: `best ${best.score} below ${MATCH.MIN_SCORE}` };
  if (second && top.score - second.score < MATCH.MIN_MARGIN) return { ...res, ok: false, reason: `ambiguous: runner-up ${round3(second.score)} at ${second.x},${second.y}` };
  if (agree < MATCH.MIN_AGREE) return { ...res, ok: false, reason: `only ${Math.round(agree * 100)}% of pixels agree` };
  return res;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
