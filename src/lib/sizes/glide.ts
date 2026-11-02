/**
 * The camera on /pokedex/sizes: side-on, framing whatever stands in front
 * of it. Its distance follows the size of the figures it passes (on a log
 * scale, smoothed), so it rises and pulls back as they grow. Play is a
 * planned glide over the line: a slow sideways dolly whose pace balances
 * "a moment per figure" against "a moment per tenfold growth", holding on
 * the milestone Pokémon and ending on a pull-back from the largest. The
 * same plan drives the live Play mode and the exported videos, so both are
 * deterministic: the camera at time t depends on nothing else. Pure and
 * unit-tested.
 */

export interface Placed {
  key: string;
  x: number;
  w: number;
  h: number;
}

export interface Lens {
  /** Vertical field of view, degrees. */
  vfov: number;
  /** Width / height of the frame. */
  aspect: number;
}

/** Share of the frame a framed figure fills, vertically and horizontally. */
export const FILL_H = 0.5;
export const FILL_W = 0.6;
const MIN_D = 0.25;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Camera distance that frames a w × h figure. */
export function frameDistance(w: number, h: number, lens: Lens): number {
  const tv = Math.tan(rad(lens.vfov) / 2);
  const th = tv * lens.aspect;
  return Math.max(h / (FILL_H * 2 * tv), w / (FILL_W * 2 * th), MIN_D);
}

/** Visible width of the frame at distance d. */
export function viewWidth(d: number, lens: Lens): number {
  return 2 * d * Math.tan(rad(lens.vfov) / 2) * lens.aspect;
}

export interface Framer {
  /** Smoothed ln(distance) per figure. */
  logD: number[];
  xs: number[];
  /** Framing distance at a point on the line. */
  at(x: number): number;
  /** The index of the figure nearest x. */
  nearest(x: number): number;
}

/** The camera distance along the line: each figure's framing distance, smoothed over its neighbours, interpolated on a log scale. */
export function framer(placed: Placed[], lens: Lens): Framer {
  const raw = placed.map((p) => Math.log(frameDistance(p.w, p.h, lens)));
  const R = 3;
  const logD = raw.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) {
      const j = i + k;
      if (j < 0 || j >= raw.length) continue;
      // Bilateral: neighbours of a very different size barely pull (a 100 m giant must not loosen the framing of a 14 m one).
      const dl = raw[j] - raw[i];
      const wt = Math.exp(-(k * k) / 4) * Math.exp(-(dl * dl) / 0.18);
      s += raw[j] * wt;
      n += wt;
    }
    // Never frame tighter than the figure itself needs, so the big ones are never cut off.
    return Math.max(s / n, raw[i] - 0.05);
  });
  const xs = placed.map((p) => p.x);
  const nearest = (x: number) => {
    let lo = 0, hi = xs.length - 1;
    if (hi < 0) return -1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
  };
  return {
    logD,
    xs,
    nearest,
    at(x) {
      if (!xs.length) return 1;
      if (x <= xs[0]) return Math.exp(logD[0]);
      const last = xs.length - 1;
      if (x >= xs[last]) return Math.exp(logD[last]);
      let i = nearest(x);
      if (xs[i] > x) i--;
      const f = (x - xs[i]) / Math.max(1e-9, xs[i + 1] - xs[i]);
      return Math.exp(logD[i] + (logD[i + 1] - logD[i]) * f);
    },
  };
}

export interface GlideOptions {
  /** Total length of the glide in seconds. */
  duration: number;
  /** Figures to pause on, by key, when they are in the line. */
  holds: string[];
  /** Seconds the camera waits on the first figure before it moves. */
  intro?: number;
  /** Seconds per milestone pause (shortened if the line would be rushed). */
  hold?: number;
  /** Seconds of the final pull-back on the largest figure. */
  finale?: number;
}

export interface GlideStop {
  key: string;
  index: number;
  t0: number;
  t1: number;
  finale: boolean;
}

export interface GlidePlan {
  duration: number;
  stops: GlideStop[];
  /** Moving legs: from cumulative weight a to b, between times t0 and t1. */
  legs: { t0: number; t1: number; a: number; b: number }[];
  cum: number[];
  xs: number[];
  logD: number[];
  lens: Lens;
  intro: number;
}

export interface GlideState {
  x: number;
  d: number;
  /** The figure being paused on, if any. */
  holding: string | null;
  finale: boolean;
  done: boolean;
}

/** Accelerates from rest and settles to rest (zero speed at both ends). */
const ease = (f: number) => f - Math.sin(2 * Math.PI * f) / (2 * Math.PI);
const smooth = (f: number) => f * f * (3 - 2 * f);

/** Plans a glide over a line of placed figures (small to large). */
export function buildGlide(placed: Placed[], fr: Framer, lens: Lens, opts: GlideOptions): GlidePlan {
  const n = placed.length;
  const duration = Math.max(1, opts.duration);
  const intro = Math.min(opts.intro ?? 0.8, duration * 0.12);
  // Pace: one unit per figure passed, and enough per doubling in size that growth gets its share of the time.
  const range = n > 1 ? Math.max(0.5, Math.max(...fr.logD) - Math.min(...fr.logD)) : 1;
  const K = Math.max(6, (n - 1) / range);
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + 1 + K * Math.abs(fr.logD[i] - fr.logD[i - 1]));
  const last = n - 1;
  const stopIdx = [...new Set(opts.holds.map((k) => placed.findIndex((p) => p.key === k)).filter((i) => i > 0 && i < last))].sort((a, b) => a - b);
  let hold = opts.hold ?? 1.4;
  let finale = Math.min(opts.finale ?? 2.5, duration * 0.35);
  // Keep at least 45% of the time moving.
  const budget = duration - intro;
  const pauses = () => stopIdx.length * hold + finale;
  if (pauses() > budget * 0.55) {
    const k = (budget * 0.55) / pauses();
    hold *= k;
    finale *= k;
  }
  const moving = Math.max(0.1, budget - pauses());
  const total = cum[last] || 1;
  const stops: GlideStop[] = [];
  const legs: GlidePlan["legs"] = [];
  let t = intro, from = 0;
  for (const idx of [...stopIdx, last]) {
    const span = cum[idx] - cum[from];
    const dt = n > 1 ? (moving * span) / total : 0;
    if (dt > 0) legs.push({ t0: t, t1: t + dt, a: cum[from], b: cum[idx] });
    t += dt;
    const isFinale = idx === last;
    const ht = isFinale ? duration - t : hold;
    stops.push({ key: placed[idx].key, index: idx, t0: t, t1: t + ht, finale: isFinale });
    t += ht;
    from = idx;
  }
  return { duration, stops, legs, cum, xs: fr.xs, logD: fr.logD, lens, intro };
}

/** Position along the line for a cumulative weight. */
function atWeight(plan: GlidePlan, c: number): { x: number; logD: number } {
  const { cum, xs, logD } = plan;
  if (xs.length < 2 || c <= 0) return { x: xs[0] ?? 0, logD: logD[0] ?? 0 };
  let lo = 0, hi = cum.length - 1;
  if (c >= cum[hi]) return { x: xs[hi], logD: logD[hi] };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= c) lo = mid; else hi = mid;
  }
  const f = (c - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
  return { x: xs[lo] + (xs[hi] - xs[lo]) * f, logD: logD[lo] + (logD[hi] - logD[lo]) * f };
}

/** The camera at time t (seconds) of a glide. */
export function glideAt(plan: GlidePlan, t: number): GlideState {
  const tt = Math.max(0, Math.min(t, plan.duration));
  const done = t >= plan.duration;
  for (const s of plan.stops) {
    if (tt >= s.t0 && tt <= s.t1) {
      const p = atWeight(plan, plan.cum[s.index]);
      let d = Math.exp(p.logD);
      const x = p.x;
      const f = s.t1 > s.t0 ? (tt - s.t0) / (s.t1 - s.t0) : 1;
      if (s.finale) {
        // The reveal: a slow pull back (the camera rig lifts and swings it over the rooftops).
        const k = smooth(Math.min(1, f * 1.4));
        d *= 1 + 0.1 * k;
      } else {
        // A gentle push in while it pauses.
        d *= 1 - 0.05 * Math.sin(Math.PI * f);
      }
      return { x, d, holding: s.key, finale: s.finale, done };
    }
  }
  for (const leg of plan.legs) {
    if (tt >= leg.t0 && tt < leg.t1) {
      const f = ease((tt - leg.t0) / (leg.t1 - leg.t0));
      const p = atWeight(plan, leg.a + (leg.b - leg.a) * f);
      return { x: p.x, d: Math.exp(p.logD), holding: null, finale: false, done };
    }
  }
  // The intro: waiting on the first figure.
  const p = atWeight(plan, 0);
  return { x: p.x, d: Math.exp(p.logD), holding: null, finale: false, done };
}

/** A comfortable length for the live glide over n figures with k pauses. */
export function naturalDuration(n: number, stops: number): number {
  return Math.round(Math.min(80, Math.max(14, 10 + 0.045 * n + 2 * stops)));
}
