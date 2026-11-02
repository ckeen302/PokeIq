import { MAX_ORBIT, pitchFor, type View } from "./camera";
import { buildGlide, framer, glideAt, naturalDuration, type GlidePlan, type GlideState, type Lens, type Placed } from "./glide";
import { MILESTONES } from "./presets";

/**
 * Play mode, as plain math: the glide plan for a line (milestone holds and
 * the finale), and the camera at any moment of it. Holds orbit slowly
 * round the figure (never more than MAX_ORBIT, so its relief shows without
 * turning its back), legs drift a touch for parallax, and the finale rises
 * over the rooftops. Shared by the live page and the video recorder, so a
 * video is exactly what Play shows.
 */

export interface PlayPlan {
  glide: GlidePlan;
  placed: Placed[];
}

export function planPlay(placed: Placed[], lens: Lens, opts: { duration?: number; intro?: number; hold?: number; finale?: number } = {}): PlayPlan {
  const fr = framer(placed, lens);
  const holds = holdsFor(placed);
  const duration = opts.duration ?? naturalDuration(placed.length, holds.length + 1);
  return { glide: buildGlide(placed, fr, lens, { duration, holds, intro: opts.intro, hold: opts.hold, finale: opts.finale }), placed };
}

/**
 * Where Play pauses: the milestone Pokémon in the line (Pikachu, Snorlax,
 * Onix, Wailord, Eternatus); a line with fewer than three of them pauses
 * at evenly spaced figures instead (never a real-world reference, never
 * the last figure, which gets the finale).
 */
export function holdsFor(placed: { key: string }[]): string[] {
  const keys = placed.map((p) => p.key);
  const named = MILESTONES.filter((k) => keys.includes(k) && keys.indexOf(k) < keys.length - 1);
  if (named.length >= 3 || placed.length < 5) return [...named];
  const picks = new Set<string>(named);
  for (const q of [0.3, 0.55, 0.8]) {
    let i = Math.round((placed.length - 1) * q);
    while (i > 0 && keys[i].startsWith("ref-")) i--;
    if (i > 0 && i < placed.length - 1) picks.add(keys[i]);
  }
  return [...picks];
}

const smooth = (f: number) => { const k = Math.max(0, Math.min(1, f)); return k * k * (3 - 2 * k); };

export interface PlayFrame {
  view: View;
  state: GlideState;
  /** The figure held on (or rising over in the finale), if any. */
  focus: string | null;
}

/** The camera at time t of a play plan. `heightAt` is the scene's smoothed figure height along the line. */
export function playAt(plan: PlayPlan, t: number, heightAt: (x: number) => number): PlayFrame {
  const st = glideAt(plan.glide, t);
  const h = heightAt(st.x);
  let orbit = 0.05 * Math.sin(t * 0.35);
  let rise = 0;
  const stop = plan.glide.stops.find((s) => t >= s.t0 && t <= s.t1);
  if (stop) {
    const f = stop.t1 > stop.t0 ? (t - stop.t0) / (stop.t1 - stop.t0) : 1;
    if (stop.finale) {
      rise = smooth((f - 0.18) / 0.72);
      orbit = 0;
    } else {
      // Alternate sides from one hold to the next.
      const dir = plan.glide.stops.indexOf(stop) % 2 ? -1 : 1;
      orbit = dir * MAX_ORBIT * 0.8 * Math.sin(Math.PI * smooth(f));
    }
  }
  const focusKey = stop?.key ?? (plan.placed.length ? plan.placed[Math.max(0, nearestIndex(plan.placed, st.x))].key : null);
  return { view: { x: st.x, d: st.d, h, orbit, pitch: pitchFor(h), rise }, state: st, focus: focusKey };
}

export function nearestIndex(placed: { x: number }[], x: number): number {
  let lo = 0, hi = placed.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (placed[mid].x <= x) lo = mid; else hi = mid;
  }
  return Math.abs(placed[lo].x - x) <= Math.abs(placed[hi].x - x) ? lo : hi;
}
