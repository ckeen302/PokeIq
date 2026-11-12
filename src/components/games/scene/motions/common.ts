import { cycleRate, hipHeight, poseFor } from "@/lib/race/gait";
import { motionAt, profileFor, runnerFor, type Profile } from "@/lib/race/model";
import { figureSize } from "@/lib/race/types";
import type { Athlete } from "@/lib/games/athlete";
import type { ActorPose } from "../pose";

/**
 * Shared pieces of the event motions: the figure's size, a run-up on the
 * Race's sprint curve with its gait, and easing curves. Pure (no three.js).
 */

export interface Dims {
  /** Figure width and standing height, hip height, body length (m). */
  w: number;
  h: number;
  hip: number;
  len: number;
}

export function dims(a: Athlete): Dims {
  const { w, h } = figureSize(a.entrant);
  return { w, h, hip: hipHeight(h, a.entrant.shape), len: Math.max(w, h) };
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const ease = (x: number) => smooth(0, 1, x);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** A bump: 0 → 1 → 0 over [a, b]. */
export const bump = (a: number, b: number, x: number) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));
/** Damped oscillation after t0. */
export const wobble = (t: number, t0: number, freq: number, decay: number) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay) * Math.sin((t - t0) * freq * 2 * Math.PI));

/** A run-up on the Race's sprint curve (from standing), sampled with the athlete's gait. */
export interface RunUp {
  profile: Profile;
  /** Time to cover the run-up (s). */
  T: number;
  distance: number;
}

export function runUp(a: Athlete, distance: number, form = 1, keep = 1): RunUp {
  const base = runnerFor(a.stats, a.kg);
  const runner = { ...base, vmax: base.vmax * form * keep };
  const d = dims(a);
  const profile = profileFor(runner, distance, (v) => cycleRate(a.entrant.motion, v, d.hip, a.kg, d.len));
  return { profile, T: profile.finish, distance };
}

/** Where the run-up is `t` seconds after it began: metres covered, speed, acceleration, gait cycles. */
export function runAt(r: RunUp, t: number) {
  const m = motionAt(r.profile, Math.min(t, r.T));
  if (t > r.T) {
    // Carry on at the take-off speed (the plant decides what happens next).
    const v = m.v;
    return { s: r.distance + v * (t - r.T), v, a: 0, phase: m.phase + (t - r.T) * cycleRateOf(r, v) };
  }
  return { s: m.x, v: m.v, a: m.a, phase: m.phase };
}

const cycleRateOf = (r: RunUp, v: number) => r.profile.rateFinish * (v / Math.max(1e-3, r.profile.vFinish || v || 1));

/** An athlete moving along a straight line in its gait, at a point and direction. */
export function gaitActor(a: Athlete, d: Dims, x: number, z: number, dx: number, dz: number, st: { v: number; a: number; phase: number; s: number }, time: number): ActorPose {
  const g = poseFor(a.entrant.motion, { phase: st.phase, v: st.v, a: st.a, h: d.h, hip: d.hip, distance: st.s, time });
  return {
    visible: true,
    x,
    y: g.lift,
    z,
    dx,
    dz,
    lean: g.lean + g.pitch,
    roll: a.entrant.motion === "roll" ? -g.spin : 0,
    squash: g.squash,
    sway: g.roll,
    turn: g.twist,
    gait: { motion: a.entrant.motion, phase: st.phase, v: st.v, a: st.a },
    shadow: 1,
  };
}

/** Standing still (breathing), facing a direction. */
export function idleActor(a: Athlete, d: Dims, x: number, z: number, dx: number, dz: number, time: number, seed = 0): ActorPose {
  const g = poseFor(a.entrant.motion, { phase: 0, v: 0, a: 0, h: d.h, hip: d.hip, distance: 0, time });
  return { visible: true, x, y: g.lift, z, dx, dz, lean: 0.02 * Math.sin(time * 0.9 + seed), roll: 0, squash: 0.012 * Math.sin(time * 2.1 + seed * 1.7), gait: { motion: a.entrant.motion, phase: 0, v: 0 }, shadow: 1 };
}

/** Legs that walk (a slow stroll) at speed v for t seconds. */
export function walkPhase(d: Dims, v: number, t: number) {
  return (t * v) / Math.max(0.15, d.hip * 1.4);
}

/** Moves that need legs, arms or a biped body read these. */
export const hasLegs = (a: Athlete) => ["run", "gallop", "scuttle"].includes(a.entrant.motion);
export const isBiped = (a: Athlete) => a.body === "biped" && a.entrant.motion === "run";

/** No legs to stand on: hoppers, serpents and fish out of water (their own way of moving is all they have). */
export const legless = (a: Athlete) => ["bounce", "slither", "flop"].includes(a.entrant.motion);

/**
 * A legless take-off at τ = 0: down into a coil (squashed, gathering)
 * over the last half-second, then the spring out of it (stretched for a
 * moment). The squash to add; 0 for everyone with legs.
 */
export function coilSpring(a: Athlete, tau: number, depth = 1): number {
  if (!legless(a)) return 0;
  return depth * (-0.2 * bump(-0.5, 0.01, tau) + 0.16 * bump(-0.01, 0.32, tau));
}

/**
 * Waiting, without legs, still looks alive and deliberate: a hopper
 * gathers and hops on the spot, a serpent's coils breathe and its body
 * ripples, a fish flops now and then. Changes the pose in place.
 */
export function restless(p: ActorPose, a: Athlete, d: Dims, time: number, seed = 0) {
  const m = a.entrant.motion;
  if (m === "bounce") {
    const u = (time * 0.62 + seed * 0.37) % 1;
    p.squash += -0.09 * bump(0.38, 0.6, u) + 0.06 * bump(0.6, 0.72, u) - 0.06 * bump(0.86, 0.96, u);
    p.y += 0.07 * d.h * bump(0.6, 0.86, u);
  } else if (m === "slither") {
    p.squash += 0.035 * Math.sin(time * 1.3 + seed);
    p.swim = { amp: 0.035, waves: 1.3, phase: time * 1.6 + seed, style: 2 };
    p.lean += 0.05 * Math.sin(time * 0.9 + seed);
  } else if (m === "flop") {
    const u = (time * 0.4 + seed * 0.29) % 1;
    p.y += 0.06 * d.h * bump(0.7, 0.82, u);
    p.roll += 0.25 * bump(0.68, 0.86, u);
    p.squash += -0.05 * bump(0.82, 0.95, u);
  }
}
