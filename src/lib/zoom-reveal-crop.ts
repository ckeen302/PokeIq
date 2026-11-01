/**
 * Zoom Reveal's start crops: where the extreme close-up of a Pokémon's
 * official artwork begins.
 *
 * A random close-up is usually useless: transparent background, or a flat
 * patch of body colour. Every candidate square is therefore scored by how
 * much *detail* it holds, counted only inside the Pokémon's opaque pixels:
 * colour edges (line art, eyes, patterns, markings) and how many distinct
 * colours appear. Squares that are not almost entirely opaque, or that are
 * nearly one colour, are rejected outright. The best few non-overlapping
 * squares become the Pokémon's candidates; a round's seed picks one, so the
 * daily and duels show everyone the same crop.
 *
 * Pure (no image library), so it runs in the precompute script
 * (scripts/zoom-reveal/crops.ts) and in tests on synthetic images alike.
 */

export interface CropCandidate {
  /** Left, top and side of the square, as shares of the (square) canvas. */
  x: number;
  y: number;
  s: number;
  /** Share of the square's pixels that are opaque Pokémon. */
  opaque: number;
  /** Distinct colours that each cover a real share of the square. */
  colours: number;
  /** Share of the square's pixels on a colour edge. */
  edges: number;
}

/** Side of the start crop, as a share of the Pokémon's longer side. */
export const START_SHARE = 0.17;
/** Never smaller than this share of the canvas (tiny sprites would turn to mush). */
export const MIN_START_SHARE = 0.11;
const ALPHA_SOLID = 200;
/** Colour distance (mean of |Δr|, |Δg|, |Δb|) that counts as an edge. */
const EDGE_STEP = 22;
/** A colour must cover this share of the square to count. */
const COLOUR_SHARE = 0.02;

/** The acceptance tiers, strictest first. The last one always finds something on any visible sprite. */
export const CROP_TIERS = [
  { opaque: 0.95, colours: 4, edges: 0.1 },
  { opaque: 0.9, colours: 3, edges: 0.06 },
  { opaque: 0.8, colours: 3, edges: 0.03 },
  { opaque: 0.65, colours: 2, edges: 0 },
] as const;

/** What a picked start crop is guaranteed to clear: never mostly blank, never flat. */
export const CROP_FLOOR = CROP_TIERS[CROP_TIERS.length - 1];

export const MAX_CANDIDATES = 3;

/**
 * @param rgba   RGBA bytes, row-major, of a square canvas `size` × `size`
 * @returns up to MAX_CANDIDATES crops, best first (empty only for a blank image)
 */
export function pickCrops(rgba: Uint8Array | Uint8ClampedArray, size: number): CropCandidate[] {
  // A very thin Pokémon may have no square that big inside it: try closer.
  for (const scale of [1, 0.75, 0.55]) {
    const found = cropsAt(rgba, size, scale);
    if (found.length) return found;
  }
  return [];
}

function cropsAt(rgba: Uint8Array | Uint8ClampedArray, size: number, scale: number): CropCandidate[] {
  const n = size * size;
  const solid = new Uint8Array(n);
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] >= ALPHA_SOLID) {
      solid[i] = 1;
      const x = i % size;
      const y = (i - x) / size;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return [];

  // An edge pixel: opaque, with an opaque right or lower neighbour of a clearly different colour.
  // Edges against the transparent background don't count: the outline isn't detail.
  const dist = (a: number, b: number) =>
    (Math.abs(rgba[a * 4] - rgba[b * 4]) + Math.abs(rgba[a * 4 + 1] - rgba[b * 4 + 1]) + Math.abs(rgba[a * 4 + 2] - rgba[b * 4 + 2])) / 3;
  const W = size + 1;
  const solidSum = new Float64Array(W * W);
  const edgeSum = new Float64Array(W * W);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let edge = 0;
      if (solid[i]) {
        const r = x + 1 < size && solid[i + 1] ? dist(i, i + 1) : 0;
        const d = y + 1 < size && solid[i + size] ? dist(i, i + size) : 0;
        edge = Math.max(r, d) >= EDGE_STEP ? 1 : 0;
      }
      const j = (y + 1) * W + (x + 1);
      solidSum[j] = solid[i] + solidSum[j - 1] + solidSum[j - W] - solidSum[j - W - 1];
      edgeSum[j] = edge + edgeSum[j - 1] + edgeSum[j - W] - edgeSum[j - W - 1];
    }
  }
  const box = (sum: Float64Array, l: number, t: number, s: number) =>
    sum[(t + s) * W + l + s] - sum[t * W + l + s] - sum[(t + s) * W + l] + sum[t * W + l];

  const longer = Math.max(maxX - minX + 1, maxY - minY + 1);
  const side = Math.min(size, Math.max(3, Math.round(Math.max(longer * START_SHARE, size * MIN_START_SHARE) * scale)));
  const stride = Math.max(1, Math.round(side / 6));
  const area = side * side;
  const bins = new Uint16Array(512);

  const colourCount = (l: number, t: number) => {
    bins.fill(0);
    for (let y = t; y < t + side; y++) {
      for (let x = l; x < l + side; x++) {
        const i = y * size + x;
        if (!solid[i]) continue;
        bins[((rgba[i * 4] >> 5) << 6) | ((rgba[i * 4 + 1] >> 5) << 3) | (rgba[i * 4 + 2] >> 5)]++;
      }
    }
    const min = area * COLOUR_SHARE;
    let count = 0;
    for (let b = 0; b < 512; b++) if (bins[b] >= min) count++;
    return count;
  };

  interface Scored { l: number; t: number; opaque: number; edges: number; colours: number; score: number }
  const all: Scored[] = [];
  const lo = (a: number) => Math.max(0, a);
  for (let t = lo(minY - side); t <= Math.min(size - side, maxY); t += stride) {
    for (let l = lo(minX - side); l <= Math.min(size - side, maxX); l += stride) {
      const opaque = box(solidSum, l, t, side) / area;
      if (opaque < CROP_FLOOR.opaque) continue;
      const edges = box(edgeSum, l, t, side) / area;
      const colours = colourCount(l, t);
      if (colours < CROP_FLOOR.colours) continue;
      all.push({ l, t, opaque, edges, colours, score: edges * Math.sqrt(Math.min(colours, 10)) * opaque });
    }
  }

  for (const tier of CROP_TIERS) {
    const ok = all.filter((c) => c.opaque >= tier.opaque && c.colours >= tier.colours && c.edges >= tier.edges);
    if (!ok.length) continue;
    ok.sort((a, b) => b.score - a.score || a.t - b.t || a.l - b.l);
    const picked: Scored[] = [];
    for (const c of ok) {
      if (c.score < ok[0].score * 0.55) break;
      // Distinct regions: an eye and a tail, not the same eye three times.
      if (picked.some((p) => Math.abs(p.l - c.l) < side * 0.9 && Math.abs(p.t - c.t) < side * 0.9)) continue;
      picked.push(c);
      if (picked.length === MAX_CANDIDATES) break;
    }
    const r = (v: number) => Math.round(v * 10_000) / 10_000;
    return picked.map((c) => ({
      x: r(c.l / size),
      y: r(c.t / size),
      s: r(side / size),
      opaque: r(c.opaque),
      colours: c.colours,
      edges: r(c.edges),
    }));
  }
  return [];
}
