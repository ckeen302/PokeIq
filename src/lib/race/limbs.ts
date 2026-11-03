import { contactShare, froude } from "./gait";
import type { PartKind } from "./parts";
import type { Motion } from "./types";

/**
 * How each moving part swings, timed by the gait (lib/race/gait). Pure
 * and unit-tested (tests/race-parts.test.ts).
 *
 * `phase` is the gait's cycle count from the race model (footfalls for
 * runners and scuttlers, strides for gallopers, wingbeats, tail beats), so
 * the legs keep exactly the stride Alexander's relation gives: a small
 * Pokémon patters, a giant lopes.
 *
 * - Running legs alternate. Each is on the ground for the stance share
 *   of its step (about 40% at a sprint), sweeping back under the body,
 *   then swings forward through the air with the knee folding the foot up
 *   behind. Arms pump against the legs.
 * - Gallopers bound: the hind pair, then the front pair half a stride
 *   later, each pair a little apart (a rotary gallop's lead).
 * - Wings beat once per cycle, the tips lagging the stroke. Tails wag once
 *   a stride and bounce with each step.
 *
 * Angles are radians. `a` turns the part about its joint (legs and arms:
 * forward is positive about the stride axis; wings and tails: see
 * `JointAngles`), `b` bends its far half (knees, elbows, wingtips, the
 * tail's curl).
 */

export interface LimbClock {
  motion: Motion;
  /** Gait cycles completed (the race model's phase). */
  phase: number;
  /** Speed (m/s) and hip height (m). */
  v: number;
  hip: number;
  /** Seconds, for idle motion. */
  time: number;
}

export interface JointAngles {
  /** Legs and arms: forward swing about the stride axis. Wings: the stroke in the render's plane (+ raises a wing that points to +x). Tails: the wag about the vertical. */
  a: number;
  /** Knees and elbows (− folds the foot back), wingtips (lag), the tail's bounce in the render's plane. */
  b: number;
}

export interface LimbPart {
  kind: PartKind;
  side: 0 | 1;
  front: 0 | 1;
  /** +1 if the part points to +x in the render (its tip right of its joint), −1 if left. */
  out: number;
  /** Stubby feet: the lower body taking small steps (no pair of legs was found). */
  stub?: boolean;
  /** The part's length as a share of the figure's height (a leg found only below the knee swings less). */
  reach?: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const frac = (x: number) => x - Math.floor(x);

/** Side-to-side sway (radians) of a runner on stubby feet: it rocks over each foot as it steps. */
export function swayAt(c: LimbClock): number {
  const steps = c.motion === "gallop" ? c.phase * 2 : c.phase;
  return 0.07 * ease(c.v / 1.4) * Math.sin(Math.PI * steps);
}

/** How hard the runner is going: 0 standing … 1 a flat-out sprint (Froude number 6 and up). */
export const effortOf = (v: number, hip: number) => Math.min(1, froude(v, hip) / 6);

/** A leg's swing over one stride `u` (0..1), on the ground for `stance` of it: hip (forward +) and knee (fold −). */
export function legSwing(u: number, stance: number, fwd: number, back: number, fold: number): JointAngles {
  const s = Math.max(0.05, Math.min(0.95, stance));
  if (u < s) {
    // Stance: planted, the body passes over it; the knee gives a little under the load.
    const k = u / s;
    return { a: fwd + (-back - fwd) * k, b: -0.12 * fold * Math.sin(Math.PI * k) };
  }
  // Swing: forward through the air, the heel folding up behind early in it.
  const k = (u - s) / (1 - s);
  return { a: -back + (fwd + back) * ease(k), b: -fold * Math.pow(Math.sin(Math.PI * Math.pow(k, 0.8)), 1.3) };
}

export function jointAngles(p: LimbPart, c: LimbClock): JointAngles {
  const e = effortOf(c.v, c.hip);
  const go = ease(c.v / 1.4);
  const cyc = frac(c.phase);
  const idle = Math.sin(c.time * 1.7 + p.side * 2.1);
  switch (p.kind) {
    case "leg": {
      if (p.stub) {
        // Small alternating steps of the feet under the body (or a skirt's sway for hoverers).
        if (c.motion === "hover") return { a: 0.1 * Math.sin(c.time * 2 * Math.PI * 0.7 + p.side * Math.PI), b: 0 };
        const steps = c.motion === "gallop" ? c.phase * 2 : c.phase;
        const u = frac((steps + p.side) / 2);
        return { a: legSwing(u, 0.5, (0.2 + 0.08 * e) * go, (0.18 + 0.06 * e) * go, 0).a, b: 0 };
      }
      // A leg found only from the knee down swings less and barely folds.
      const k = Math.max(0.4, Math.min(1, (p.reach ?? 0.4) / 0.32));
      if (c.motion === "gallop") {
        // One cycle a stride: hind pair, then the front pair half a stride on, each pair's legs a little apart.
        const u = frac(c.phase + (p.front ? 0.5 : 0) + p.side * 0.1);
        const r = legSwing(u, 0.36, (0.32 + 0.22 * e) * go * k, (0.3 + 0.2 * e) * go * k, Math.min(0.9, (0.3 + 0.6 * e) * go) * k * k);
        return { a: r.a, b: p.front ? r.b : -r.b * 0.7 };
      }
      if (c.motion === "bounce") {
        // Feet tuck up in each hop and reach for the landing.
        const s = Math.sin(Math.PI * cyc);
        return { a: 0.22 * s * go, b: -0.5 * s * go };
      }
      // Running and scuttling: one footfall per cycle, the legs taking turns.
      const u = frac((c.phase + p.side) / 2);
      const duty = c.motion === "scuttle" ? 0.5 : contactShare(e);
      const ks = (c.motion === "scuttle" ? 0.55 : 1) * k;
      // Stance share of a stride is half the share of a step; the knee folds up to about 60°.
      return legSwing(u, duty / 2, (0.3 + 0.32 * e) * go * ks, (0.26 + 0.26 * e) * go * ks, Math.min(1.05, (0.35 + 0.8 * e) * go) * ks * k);
    }
    case "arm": {
      if (c.motion === "run" || c.motion === "scuttle") {
        // Pump against the leg on the same side.
        const u = frac((c.phase + p.side) / 2);
        const leg = legSwing(u, contactShare(e) / 2, 0.3 + 0.32 * e, 0.26 + 0.26 * e, 0);
        return { a: -0.75 * leg.a * go + 0.03 * idle * (1 - go), b: -0.18 * go * Math.sin(Math.PI * 2 * u) };
      }
      if (c.motion === "fly" || c.motion === "hover") return { a: 0.06 * Math.sin(2 * Math.PI * cyc - 1) + 0.03 * idle, b: 0 };
      return { a: 0.08 * Math.sin(Math.PI * c.phase) * go + 0.03 * idle, b: 0 };
    }
    case "wing": {
      if (c.motion === "fly") {
        const s = Math.sin(2 * Math.PI * cyc);
        return { a: p.out * (0.5 * s + 0.05), b: p.out * 0.32 * Math.sin(2 * Math.PI * cyc - 0.9) };
      }
      // Hoverers and walkers hold their wings out, with a slow flutter.
      const s = Math.sin(c.time * 2 * Math.PI * 1.6 + p.side);
      return { a: p.out * 0.14 * s, b: p.out * 0.08 * Math.sin(c.time * 2 * Math.PI * 1.6 - 0.8) };
    }
    case "tail": {
      if (c.motion === "fly" || c.motion === "hover") return { a: 0.12 * Math.sin(2 * Math.PI * cyc - 1.1) + 0.05 * idle, b: p.out * 0.08 * Math.sin(2 * Math.PI * cyc - 1.6) };
      const stride = c.motion === "gallop" ? frac(c.phase) : frac(c.phase / 2);
      // Wags once a stride (lagging the hips), bounces with each footfall.
      return {
        a: (0.16 + 0.18 * e) * go * Math.sin(2 * Math.PI * stride - 0.7) + 0.07 * idle * (1 - go),
        b: p.out * (0.1 + 0.08 * e) * go * Math.sin(2 * Math.PI * cyc - 1.1),
      };
    }
  }
}

/**
 * The finish: how far into its dip a runner is at race time t, finishing
 * at T. Sprinters throw the torso forward over the last stride and come
 * up again a stride after the line (0 … 1 at the line).
 */
export function dipAt(t: number, T: number): number {
  if (!Number.isFinite(T)) return 0;
  const s = t - (T - 0.03);
  return Math.exp(-(s * s) / (2 * (s < 0 ? 0.11 : 0.2) ** 2));
}

/**
 * The winner's celebration, `s` seconds after it crossed the line: it
 * eases off first, then jumps for joy (hops of `period` seconds), arms up.
 * Returns the jump's height share (0..1), the arms' raise (0..1) and the
 * turn (radians) it makes on the first jump.
 */
export function celebrationAt(s: number, period = 0.62): { jump: number; raise: number; turn: number } {
  const start = 1.5;
  if (s < start) return { jump: 0, raise: ease((s - 0.9) / 0.6) * 0.6, turn: 0 };
  const k = (s - start) / period;
  const hop = frac(k);
  // A few hops, then a rest, then again.
  const set = Math.floor(k) % 5;
  const jump = set < 3 ? Math.sin(Math.PI * hop) : 0;
  return { jump, raise: 1, turn: k < 1 ? ease(hop) * Math.PI * 2 : 0 };
}
