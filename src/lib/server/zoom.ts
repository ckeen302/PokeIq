/**
 * Picks the crop for "zoomed in" silhouettes on Hard.
 *
 * A random crop of a big, round Pokémon is often a solid black square, which
 * turns the question into a coin flip. Instead every candidate window is
 * scored by how much silhouette *outline* it contains (ears, tails, horns and
 * the head's shape are what make a Pokémon recognisable), windows that are
 * almost all body or almost all background are rejected, and one of the
 * best-scoring windows is chosen deterministically per Pokémon.
 *
 * Callers pad the trimmed sprite with transparent margin first (ZOOM_PADDING)
 * so even a shape that fills its bounding box yields windows with outline.
 */

export interface ZoomWindow {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Share of the padded sprite each side of the window covers (≈60% of the Pokémon itself). */
export const ZOOM_FRACTION = 0.5;
/** Transparent margin added around the trimmed sprite, as a share of its longer side. */
export const ZOOM_PADDING = 0.12;
const GRID = 9;
const MIN_FILL = 0.25;
const MAX_FILL = 0.75;

/**
 * @param alpha one byte per pixel (0 = transparent), row-major
 * @param seed  stable per-Pokémon hash, to vary which strong window is used
 */
export function pickZoomWindow(alpha: Uint8Array, width: number, height: number, seed: number): ZoomWindow {
  const w = Math.max(1, Math.round(width * ZOOM_FRACTION));
  const h = Math.max(1, Math.round(height * ZOOM_FRACTION));
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && alpha[y * width + x] > 127;

  // Prefix sums of filled pixels and of outline pixels (filled, with an empty neighbour).
  const fillSum = new Float64Array((width + 1) * (height + 1));
  const edgeSum = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const filled = solid(x, y);
      const edge = filled && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1));
      const i = (y + 1) * (width + 1) + (x + 1);
      fillSum[i] = (filled ? 1 : 0) + fillSum[i - 1] + fillSum[i - width - 1] - fillSum[i - width - 2];
      edgeSum[i] = (edge ? 1 : 0) + edgeSum[i - 1] + edgeSum[i - width - 1] - edgeSum[i - width - 2];
    }
  }
  const area = (sum: Float64Array, l: number, t: number) => {
    const r = l + w;
    const b = t + h;
    return sum[b * (width + 1) + r] - sum[t * (width + 1) + r] - sum[b * (width + 1) + l] + sum[t * (width + 1) + l];
  };

  const all: { left: number; top: number; score: number; fill: number }[] = [];
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const left = Math.round((gx / (GRID - 1)) * (width - w));
      const top = Math.round((gy / (GRID - 1)) * (height - h));
      all.push({ left, top, score: area(edgeSum, left, top), fill: area(fillSum, left, top) / (w * h) });
    }
  }
  let candidates = all.filter((c) => c.fill >= MIN_FILL && c.fill <= MAX_FILL);
  // Very compact shapes (Voltorb is a near-perfect disc) leave no balanced
  // window: fall back to the windows closest to half body, half background.
  if (!candidates.length) {
    const balance = (c: { fill: number }) => Math.abs(c.fill - 0.5);
    const closest = Math.min(...all.map(balance));
    candidates = all.filter((c) => balance(c) <= closest + 0.05);
  }
  candidates.sort((a, b) => b.score - a.score || a.top - b.top || a.left - b.left);
  const strong = candidates.filter((c) => c.score >= candidates[0].score * 0.85).slice(0, 3);
  const pick = strong[seed % strong.length];
  return { left: pick.left, top: pick.top, width: w, height: h };
}
