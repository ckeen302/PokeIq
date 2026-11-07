import { G } from "@/lib/games/constants";
import type { Athlete } from "@/lib/games/athlete";
import type { JumpAttempt } from "@/lib/games/longjump";
import { LJ } from "@/lib/games/venues";
import type { ActorPose } from "../pose";
import { bump, clamp01, dims, gaitActor, idleActor, isBiped, lerp, runAt, runUp, smooth, walkPhase, type Dims, type RunUp } from "./common";

/**
 * The long jump, driven by the attempt's physics (lib/games/longjump),
 * on a local clock τ with take-off at τ = 0:
 *
 * - the run-up on the Race's sprint curve over 40 m, the penultimate step
 *   lowered and the last one planted with the body leaning back;
 * - take-off: the lead knee drives, the arms swing up;
 * - flight: the centre of mass on the projectile, a hitch-kick for
 *   bipeds (legs cycling, arms circling), a bound for four legs, a body arc
 *   for everyone else; fliers keep their wings in (no gliding);
 * - landing: legs out in front, a sit into the sand with a spray and a
 *   footprint, then up and out of the front of the pit.
 */

export const READY = 1.4;
/** Time after landing until the attempt is over (s). */
export const AFTER = 3.6;

export interface LongJumpScene {
  pose: ActorPose;
  /** Seconds since the landing (null before it), where the sand was hit and the size of the body. */
  landed: number | null;
  mark: { x: number; z: number; w: number; len: number } | null;
  /** The foul flag (0 down … 1 up). */
  flag: number;
  /** The take-off toe's position (x) for the board camera. */
  toe: number;
  /** Centre of mass, for cameras. */
  com: [number, number, number];
}

export interface LongJumpPlan {
  athlete: Athlete;
  dims: Dims;
  attempt: JumpAttempt;
  run: RunUp;
  toe: number;
  /** Start of the attempt on the local clock (s, negative). */
  start: number;
  end: number;
}

export function planLongJump(a: Athlete, attempt: JumpAttempt): LongJumpPlan {
  const p = attempt.physics;
  const run = runUp(a, 40, attempt.form);
  const toe = LJ.line - attempt.board;
  return { athlete: a, dims: dims(a), attempt, run, toe, start: -run.T - READY, end: p.flight + AFTER };
}

export function longJumpAt(pl: LongJumpPlan, tau: number, time: number): LongJumpScene {
  const a = pl.athlete, d = pl.dims, ph = pl.attempt.physics;
  const z = LJ.z;
  const F = ph.flight;
  const toe = pl.toe;
  const startX = toe - 40;
  let pose: ActorPose;
  let com: [number, number, number] = [0, d.h * 0.55, z];
  if (tau < -pl.run.T) {
    // On the runway's mark: rocking, ready to go.
    const k = clamp01((tau - pl.start) / READY);
    pose = idleActor(a, d, startX, z, 1, 0, time, 1);
    pose.lean = 0.08 + 0.1 * Math.sin(k * Math.PI * 3) * (1 - k * 0.5);
    pose.squash = -0.02 * Math.sin(k * Math.PI * 3);
    com = [startX, d.h * 0.55, z];
  } else if (tau < 0) {
    const t = tau + pl.run.T;
    const st = runAt(pl.run, t);
    const x = startX + st.s;
    pose = gaitActor(a, d, x, z, 1, 0, st, time);
    // The penultimate step lowers the body; the last one plants it, leaning back.
    const pen = bump(-0.42, -0.12, tau), plant = smooth(-0.16, 0, tau);
    pose.squash += -0.07 * pen;
    pose.lean = lerp(pose.lean, -0.14, plant);
    com = [x, d.h * 0.55 + pose.y, z];
  } else if (tau < F) {
    const xc = toe + ph.dTake + ph.vx * tau;
    const yc = ph.h0 + ph.vy * tau - 0.5 * G * tau * tau;
    const k = tau / F;
    const angle = Math.atan2(ph.vy - G * tau, ph.vx);
    pose = { visible: true, x: xc - ph.dTake, y: Math.max(-0.1 * d.h, yc - ph.h0), z, dx: 1, dz: 0, lean: 0, roll: 0, squash: 0.05 * bump(0, 0.6, k), gait: null, shadow: 1 };
    const land = smooth(0.62, 1, k);
    if (isBiped(a)) {
      // The hitch-kick: legs keep running in the air, arms circle; then both legs out in front for the landing.
      const cycles = 1.6 * k;
      pose.gait = { motion: "run", phase: cycles * 2 + 0.5, v: 7 };
      pose.legs = { a: 1.05, b: -0.15, k: land };
      pose.arms = { a: lerp(1.3 * Math.sin(2 * Math.PI * cycles), 0.9, land), b: -0.2, k: 0.85 };
      pose.lean = lerp(0.12 * Math.sin(Math.PI * k), -0.32, land) + 0.08 * (1 - k) * (k < 0.15 ? 1 : 0);
      pose.bend = -0.04 * land;
    } else if (a.entrant.motion === "gallop" || a.entrant.motion === "scuttle") {
      // A bound: legs stretched fore and aft, the body pitching nose-down into the landing.
      pose.gait = { motion: a.entrant.motion, phase: 0.25, v: 6 };
      pose.legs = { a: 0, b: 0, k: 0.9, split: lerp(0.65, 0.2, land) };
      pose.lean = lerp(-0.2, 0.22, k);
    } else {
      // Everyone else arcs along the path.
      pose.lean = -angle * 0.55;
      pose.squash = 0.08 * bump(0, 0.8, k) - 0.05 * land;
    }
    // No gliding: wings stay in.
    pose.wings = { a: 0.15, b: 0.1, k: 0.9 };
    com = [xc, yc, z];
  } else {
    const s = tau - F;
    const xl = toe + ph.vx * F;
    // Down into the sand, then up and out of the front of the pit.
    const sit = Math.exp(-s / 0.35) * 0.3 + 0.12 * (1 - smooth(0.5, 1.4, s));
    const up = smooth(0.9, 1.7, s);
    const walk = Math.max(0, s - 1.6);
    const x = xl + walk * Math.min(1.2, 0.5 + d.h * 0.4);
    pose = idleActor(a, d, x, z, 1, 0, time, 2);
    pose.y = -0.1 * d.h * (1 - up);
    pose.squash = -sit;
    pose.lean = isBiped(a) ? lerp(-0.45 * Math.min(1, s * 4), 0.05, up) : lerp(0.15, 0, up);
    if (isBiped(a)) pose.legs = { a: 1.0, b: -0.1, k: 1 - up };
    if (walk > 0) {
      pose.gait = { motion: a.entrant.motion, phase: walkPhase(d, 1, walk), v: 1.1 };
      pose.y = 0;
    }
    com = [x, d.h * 0.5, z];
  }
  const landed = tau >= F ? tau - F : null;
  return {
    pose,
    landed,
    mark: tau >= F ? { x: toe + ph.distance, z, w: d.w, len: d.len } : null,
    flag: pl.attempt.foul ? smooth(0.2, 0.7, tau) : 0,
    toe,
    com,
  };
}
