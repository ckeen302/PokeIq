import { pitchFor, type View } from "./camera";
import { frameDistance, viewWidth, type Framer, type Lens } from "./glide";

/**
 * Explore and Compare on /pokedex/sizes, as plain math (unit-tested): the
 * camera follows a point on the line, at the distance that frames whatever
 * stands there; drags, wheel turns and keys move that point; a search flies
 * it to a figure (passing over everything in between, so the camera rises
 * and settles on the way); Compare frames the whole comparison at once.
 */

export interface Flight {
  from: number;
  to: number;
  /** Start time and length (seconds). */
  t0: number;
  dur: number;
}

/** A flight's length: longer for longer trips, but never a chore (1–3.2 s). */
export function flightSeconds(from: number, to: number, viewW: number): number {
  const screens = Math.abs(to - from) / Math.max(0.05, viewW);
  return Math.min(3.2, Math.max(1, 0.9 + 0.55 * Math.log2(1 + screens)));
}

/** Eases out of rest and into rest (smootherstep). */
export const easeFlight = (f: number) => {
  const k = Math.max(0, Math.min(1, f));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

export function flightAt(f: Flight, t: number): { x: number; done: boolean } {
  const k = f.dur > 0 ? (t - f.t0) / f.dur : 1;
  if (k >= 1) return { x: f.to, done: true };
  return { x: f.from + (f.to - f.from) * easeFlight(k), done: false };
}

/** The Explore camera at a point on the line. */
export function exploreView(x: number, fr: Framer, heightAt: (x: number) => number): View {
  const h = heightAt(x);
  return { x, d: fr.at(x), h, orbit: 0, pitch: pitchFor(h), rise: 0 };
}

/** Metres along the line for a drag of `px` screen pixels at the current framing (the line follows the finger). */
export function dragMetres(px: number, screenW: number, d: number, lens: Lens): number {
  return (-px / Math.max(1, screenW)) * viewWidth(d, lens);
}

/** Metres along the line for a wheel turn (`delta` in pixels): about a fifth of a screen per notch. */
export function wheelMetres(delta: number, d: number, lens: Lens): number {
  const k = Math.max(-1, Math.min(1, delta / 500));
  return k * viewWidth(d, lens);
}

/** Keeps the camera's point on the line, with a little room past each end. */
export function clampX(x: number, first: { x: number; w: number }, last: { x: number; w: number }): number {
  return Math.max(first.x - first.w, Math.min(last.x + last.w * 0.5, x));
}

/** The figure to step to from `i` (arrow keys), staying on the line. */
export function stepIndex(i: number, dir: number, n: number): number {
  return Math.max(0, Math.min(n - 1, i + dir));
}

/**
 * Compare's overview: the camera centred on the comparison and far enough
 * back to take in every figure, the biggest filling about half the frame.
 */
export function overviewView(placed: { x: number; w: number; h: number }[], lens: Lens): View {
  if (!placed.length) return { x: 0, d: 2, h: 1, orbit: 0, pitch: pitchFor(1), rise: 0 };
  const left = placed[0].x - placed[0].w / 2;
  const right = placed[placed.length - 1].x + placed[placed.length - 1].w / 2;
  const tall = Math.max(...placed.map((p) => p.h));
  const x = (left + right) / 2;
  // The width fits the frame with a margin; the tallest figure leaves room for its badge.
  const d = Math.max(frameDistance(right - left, tall, lens) * 1.08, frameDistance(0, tall * 1.15, lens));
  return { x, d, h: tall * 0.9, orbit: 0, pitch: pitchFor(tall), rise: 0 };
}

/** The camera eases between two views (a Compare overview and an Explore point): blend in log distance. */
export function blendViews(a: View, b: View, k: number): View {
  const f = easeFlight(k);
  const mix = (p: number, q: number) => p + (q - p) * f;
  return {
    x: mix(a.x, b.x),
    d: Math.exp(mix(Math.log(a.d), Math.log(b.d))),
    h: Math.exp(mix(Math.log(Math.max(0.01, a.h)), Math.log(Math.max(0.01, b.h)))),
    orbit: mix(a.orbit, b.orbit),
    pitch: mix(a.pitch, b.pitch),
    rise: mix(a.rise, b.rise),
  };
}
