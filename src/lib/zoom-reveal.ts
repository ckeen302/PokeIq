/**
 * Zoom Reveal, client-safe rules: a Pokémon's official artwork starts as an
 * extreme close-up and zooms out one step after every wrong guess or skip,
 * over ZOOM_STEPS steps, ending on the whole artwork. Fewer steps, more points.
 */

export const ZOOM_STEPS = 6;

/** Points for a right name on step 1..6 (before any streak bonus). */
export const ZOOM_POINTS = [150, 120, 95, 70, 50, 30] as const;

export const zoomPoints = (step: number): number => ZOOM_POINTS[Math.min(ZOOM_STEPS, Math.max(1, step)) - 1];

/** The guess sent for "Skip": zoom out without guessing. */
export const ZOOM_SKIP = "";

/**
 * A square window onto the artwork, as shares of the (square) canvas:
 * left, top and side.
 */
export interface ZoomWindow {
  x: number;
  y: number;
  s: number;
}

/**
 * The window shown on `step` (1..ZOOM_STEPS) for a start crop. Each edge
 * moves monotonically out to the canvas edge, so every step contains the one
 * before (the zoom-out animation needs that), and the side grows by the same
 * factor each step, which reads as an even zoom.
 */
export function stepWindow(start: ZoomWindow, step: number): ZoomWindow {
  const k = Math.min(ZOOM_STEPS, Math.max(1, step)) - 1;
  if (k === ZOOM_STEPS - 1) return { x: 0, y: 0, s: 1 };
  const side = start.s * Math.pow(1 / start.s, k / (ZOOM_STEPS - 1));
  const t = start.s >= 1 ? 1 : (side - start.s) / (1 - start.s);
  return { x: start.x * (1 - t), y: start.y * (1 - t), s: side };
}

/** Where `inner` sits inside `outer`, as shares of `outer`: the frame the next step zooms out from. */
export function innerRect(inner: ZoomWindow, outer: ZoomWindow): ZoomWindow {
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return { x: r((inner.x - outer.x) / outer.s), y: r((inner.y - outer.y) / outer.s), s: r(inner.s / outer.s) };
}

/** What the browser gets for the step in play. Nothing in it names the Pokémon. */
export interface ZoomView {
  step: number;
  steps: number;
  /** Opaque /api/media URL of this step's crop. */
  url: string;
  /** Where the previous step's crop sits in this one (from step 2). */
  from?: ZoomWindow;
}

/**
 * The Wordle-style line for one Pokémon: a 🔍 per zoom-out, then ✅ and the
 * step it was named on, or ❌ X/6 when all six steps went by.
 */
export function zoomShareLine(step: number, solved: boolean): string {
  const s = Math.min(ZOOM_STEPS, Math.max(1, step));
  return solved ? `${"🔍".repeat(s - 1)}✅ ${s}/${ZOOM_STEPS}` : `${"🔍".repeat(ZOOM_STEPS - 1)}❌ X/${ZOOM_STEPS}`;
}
