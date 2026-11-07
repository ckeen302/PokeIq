import type { Athlete } from "@/lib/games/athlete";
import { loadBar, type LiftAttempt } from "@/lib/games/lift";
import { PLATFORM_TOP } from "@/lib/games/venues";
import type { Vec3 } from "@/lib/race/director";
import type { ActorPose } from "../pose";
import { bump, clamp01, dims, idleActor, isBiped, lerp, smooth, walkPhase, wobble, type Dims } from "./common";

/**
 * Weightlifting, the clean & jerk, on a local clock with the first pull
 * at τ = 0, driven by how close the weight is to the lifter's best on the
 * day (lib/games/lift: the weight ÷ (best × form)):
 *
 * - the walk out to the bar, chalked hands, the set position;
 * - the clean: the pull from the platform, the drop under into a front
 *   squat, the stand (a grind when the weight is near the limit: slower,
 *   shaking);
 * - the jerk: the dip, the drive, the split under the bar, arms locked,
 *   the feet back together, motionless; the referees' "down" and lights;
 *   the bar dropped, bouncing on the rubber;
 * - a miss: stuck in the squat and the bar dumped forward, or the jerk lost
 *   behind;
 * - without arms (or not a biped): the bar heaved onto its back or head,
 *   then pressed up by standing tall; the same timing and decisions.
 *
 * The bar's centre, its sag under load and its whip are part of the plan,
 * so the scene's barbell (scene/props) follows them exactly.
 */

export interface LiftPlan {
  athlete: Athlete;
  dims: Dims;
  attempt: LiftAttempt;
  weight: number;
  success: boolean;
  /** The weight ÷ the day's best (1 and over: beyond it). */
  load: number;
  /** 0 easy … 1 a grind. */
  grind: number;
  fail: "clean" | "jerk" | null;
  /** A real clean & jerk (a biped with arms) or a heave onto its back. */
  armed: boolean;
  /** The bar's height on the platform (its centre: the plates' radius above the top). */
  rest: number;
  /** Where the lifter stands (its figure's plane, just behind the bar). */
  z: number;
  /** Key moments (τ, s). */
  catchT: number;
  standT: number;
  jerkT: number;
  lockT: number;
  downT: number;
  dropT: number;
  landT: number;
  start: number;
  end: number;
  lights: ("white" | "red")[];
}

const G = 9.81;

export function planLift(a: Athlete, attempt: LiftAttempt, max: number): LiftPlan {
  const d = dims(a);
  const weight = attempt.weight;
  const loading = loadBar(weight);
  const plate = loading?.side[0]?.d ?? 0.05;
  const rest = PLATFORM_TOP + plate / 2;
  const best = Math.max(1e-6, max * attempt.form);
  const load = weight / best;
  const grind = clamp01((load - 0.88) / 0.12);
  // Where a miss happens: a weight well past the day's best stalls in the clean; a near miss loses the jerk.
  const fail: LiftPlan["fail"] = attempt.success ? null : load > 1.025 || attempt.chance === 0 ? "clean" : "jerk";
  const armed = isBiped(a) && a.arms;
  const catchT = 0.9;
  const rise = 1.0 + 2.6 * grind;
  const standT = catchT + (fail === "clean" ? rise * 0.5 + 1.3 : rise);
  const jerkT = standT + 1.1;
  const lockT = jerkT + 0.7;
  const downT = fail === "clean" ? standT + 0.2 : fail === "jerk" ? lockT + 0.9 : lockT + 1.0 + 0.9;
  const top = (armed ? 1.12 : 1.06) * d.h;
  // Where the bar falls from: the stalled squat (its rack height at 45% of the stand), the lost jerk, or overhead.
  const dropFrom = fail === "clean" ? (armed ? 0.8 : 0.97) * d.h * (1 - 0.4 + 0.4 * 0.45) : fail === "jerk" ? 0.95 * d.h : top;
  const dropT = fail === "clean" ? standT - 0.05 : fail === "jerk" ? lockT : downT + 0.35;
  const landT = dropT + Math.sqrt((2 * Math.max(0.05, dropFrom - rest)) / G);
  // The referees: a good lift gets three whites (two, one red, when it was a grind); a miss three reds.
  const lights: ("white" | "red")[] = attempt.success ? (grind > 0.8 ? ["white", "red", "white"] : ["white", "white", "white"]) : ["red", "red", "red"];
  return { athlete: a, dims: d, attempt, weight, success: attempt.success, load, grind, fail, armed, rest, z: -Math.max(0.18, d.w * 0.18), catchT, standT, jerkT, lockT, downT, dropT, landT, start: -7, end: landT + 3.2, lights };
}

export interface LiftScene {
  pose: ActorPose;
  /** The bar's centre (null when no bar is loaded: it can't lift even the lightest). */
  bar: Vec3 | null;
  /** Sag under load while held (0..1), a whip after a catch or a landing (±), tilt about the lifter's line (rad). */
  bend: number;
  whip: number;
  tilt: number;
  /** The referees' lights (null: not yet). */
  lights: ("white" | "red" | null)[];
  /** The chalk clap (τ of it) and the bar's landing, for effects. */
  chalkAt: number;
  landed: number | null;
  com: Vec3;
}

export function liftAt(pl: LiftPlan, tau: number, time: number): LiftScene {
  const a = pl.athlete, d = pl.dims, H = d.h;
  const z = pl.z;
  // Walk out from the back of the platform (towards the camera, +z), then stand at the bar.
  const walkEnd = -5;
  const zStart = z - 2.2;
  let pose: ActorPose;
  if (tau < walkEnd) {
    const k = clamp01((tau - pl.start) / (walkEnd - pl.start));
    const zz = lerp(zStart, z, smooth(0, 1, k));
    const v = k < 1 ? 0.9 : 0;
    pose = idleActor(a, d, 0, zz, 0, 1, time, 3);
    pose.gait = { motion: a.entrant.motion, phase: walkPhase(d, 0.9, tau - pl.start), v };
  } else {
    pose = idleActor(a, d, 0, z, 0, 1, time, 3);
  }
  const chalkAt = -4.3;
  // A deep breath and the chalk clap on the way out.
  if (pl.armed) pose.arms = { a: 0.5 * bump(chalkAt - 0.4, chalkAt + 0.25, tau), b: 1.2 * bump(chalkAt - 0.4, chalkAt + 0.25, tau), k: bump(chalkAt - 0.5, chalkAt + 0.3, tau) };
  let bar: Vec3 = [0, pl.rest, 0];
  let bend = 0, whip = 0, tilt = 0;
  let landed: number | null = null;
  const S = (k: number) => 1 + k; // the figure's vertical scale for a squash k
  const rack = pl.armed ? 0.8 : 0.97;
  const over = pl.armed ? 1.12 : 1.06;
  if (tau >= walkEnd && tau < 0) {
    // The set: down to the bar, back flat, arms long (or head down to scoop it).
    const k = smooth(-2.6, -0.5, tau);
    pose.squash = -0.3 * k;
    pose.lean = (pl.armed ? 0.42 : 0.62) * k;
    if (pl.armed) pose.arms = { a: 0, b: 0, k: k };
    pose.legs = { a: 0.35 * k, b: -0.7 * k, k };
  } else if (tau >= 0) {
    const c = pl.catchT;
    if (tau < c) {
      // The clean: pull, extend, drop under.
      const u = tau / c;
      const ext = smooth(0, 0.5, u), under = smooth(0.5, 0.78, u);
      const sq = lerp(-0.3, 0.05, ext) + (-0.4 - 0.05) * under;
      pose.squash = sq;
      pose.lean = lerp(pl.armed ? 0.42 : 0.62, -0.08, ext) * (1 - under) + 0.04 * under;
      pose.legs = { a: lerp(0.35, 0, ext) + 0.45 * under, b: lerp(-0.7, 0, ext) - 1.1 * under, k: 1 };
      const peak = (pl.armed ? 0.66 : 0.9) * H;
      const caught = rack * H * S(-0.4);
      const y = u < 0.62 ? lerp(pl.rest, peak, smooth(0, 0.62, u) ** 0.8) : lerp(peak, caught, smooth(0.62, 1, u));
      bar = [0, Math.max(pl.rest, y), 0];
      if (pl.armed) pose.arms = { a: 0.9 * under, b: 1.6 * under, k: 1 };
      bend = u < 0.15 ? u / 0.15 : 1;
    } else if (tau < pl.standT || pl.fail === "clean") {
      // The stand: out of the squat, slow and shaking near the limit; a stall when it's too heavy.
      const rise = pl.fail === "clean" ? (pl.standT - 1.3 - c) / 0.5 : pl.standT - c;
      let k = smooth(0, 1, (tau - c) / rise);
      if (pl.fail === "clean") k = Math.min(k, 0.45);
      const sq = lerp(-0.4, 0, k);
      pose.squash = sq;
      pose.legs = { a: 0.45 * (1 - k), b: -1.1 * (1 - k), k: 1 };
      pose.lean = 0.04 + 0.06 * pl.grind * Math.sin(time * 3.1);
      pose.shake = 0.004 * H * (0.3 + pl.grind) * (tau < pl.dropT ? 1 : 0);
      if (pl.armed) pose.arms = { a: 0.9, b: 1.6, k: 1 };
      bar = [0, rack * H * S(sq), 0];
      bend = 1;
      whip = 0.25 * wobble(tau, c, 2.6, 3.5);
      if (pl.fail === "clean" && tau >= pl.dropT) {
        // Dumped forward: the bar rolls off the shoulders and drops; the lifter pops up out of the squat.
        const t2 = tau - pl.dropT;
        const k2 = smooth(0, 0.6, t2);
        pose.squash = lerp(sq, 0, k2);
        pose.legs = { a: 0, b: 0, k: 1 - k2 };
        pose.shake = 0;
        if (pl.armed) pose.arms = { a: 0.9 * (1 - k2), b: 1.6 * (1 - k2), k: 1 };
        bar = fallBar(pl, rack * H * S(-0.4 + 0.4 * 0.45), t2, 0.5);
        bend = 0;
        tilt = 0.05 * Math.sin(t2 * 6) * Math.exp(-t2 * 2);
        if (tau >= pl.landT) landed = tau - pl.landT;
        whip = landed != null ? 0.5 * wobble(tau, pl.landT, 3.2, 4) : 0;
      }
    } else {
      // The jerk.
      const j = pl.jerkT;
      const dip = smooth(j, j + 0.3, tau), drive = smooth(j + 0.3, j + 0.5, tau), split = smooth(j + 0.45, j + 0.7, tau), recover = smooth(j + 0.8, j + 1.8, tau);
      let sq = -0.1 * dip * (1 - drive) + 0.06 * drive * (1 - split) - 0.16 * split * (1 - recover);
      if (!pl.armed) sq = -0.1 * dip * (1 - drive) + 0.08 * drive;
      pose.squash = sq;
      pose.legs = pl.armed ? { a: 0, b: -0.3 * dip * (1 - drive), k: 1, split: 0.65 * split * (1 - recover) } : { a: 0, b: -0.3 * dip * (1 - drive), k: 1 };
      pose.lean = -0.04 * split * (1 - recover);
      const hold = tau > j + 1.8 && tau < pl.dropT;
      pose.shake = hold ? 0.002 * H * (0.2 + pl.grind) : 0;
      // The bar: down with the dip, driven up, locked out overhead.
      const yRack = rack * H * S(sq);
      const yOver = over * H * S(sq);
      const y = lerp(yRack, yOver, smooth(j + 0.3, j + 0.62, tau));
      bar = [0, y, 0];
      if (pl.armed) {
        pose.raise = smooth(j + 0.32, j + 0.6, tau);
        pose.arms = { a: 0.9 * (1 - pose.raise), b: 1.6 * (1 - pose.raise), k: 1 };
      }
      bend = 1;
      whip = 0.3 * wobble(tau, j + 0.62, 2.8, 3);
      if (tau >= pl.dropT) {
        // Dropped from overhead (a good lift, after the "down"), or the jerk lost behind.
        const t2 = tau - pl.dropT;
        const from = pl.fail === "jerk" ? 0.95 * H : yOver;
        bar = fallBar(pl, from, t2, pl.fail === "jerk" ? -0.6 : 0.15);
        bend = 0;
        tilt = pl.fail === "jerk" ? 0.12 * Math.sin(Math.min(1, t2 * 2) * Math.PI) : 0;
        if (tau >= pl.landT) landed = tau - pl.landT;
        whip = landed != null ? 0.6 * wobble(tau, pl.landT, 3.2, 4) : 0;
        const k2 = smooth(0, 0.5, t2);
        if (pl.armed) {
          pose.raise = (1 - k2) * (pose.raise ?? 0);
          pose.arms = { a: 0, b: 0, k: 1 - k2 };
        }
        pose.squash = lerp(sq, 0, k2);
        pose.legs = { a: 0, b: 0, k: 1 - k2, split: 0 };
        pose.shake = 0;
        // A good lift: arms up, a bounce on the toes.
        if (pl.success && landed != null) {
          const c2 = smooth(0, 0.4, landed) * (1 - smooth(2.2, 3, landed));
          pose.raise = Math.max(pose.raise ?? 0, c2);
          pose.y = 0.05 * H * Math.max(0, Math.sin(landed * 7)) * Math.exp(-landed * 1.2) * c2;
        }
      }
    }
  }
  const lights: LiftScene["lights"] = tau >= pl.downT ? pl.lights : [null, null, null];
  return { pose, bar, bend, whip, tilt, lights, chalkAt, landed, com: [0, H * 0.55, z] };
}

/** A bar falling from `from` to the platform (in front of the lifter by `dz`), with a small bounce. */
function fallBar(pl: LiftPlan, from: number, t: number, dz: number): Vec3 {
  const tf = Math.sqrt((2 * Math.max(0.05, from - pl.rest)) / G);
  if (t < tf) return [0, from - 0.5 * G * t * t, dz * (t / tf)];
  const b = t - tf;
  // Bumper plates: a bounce of a few centimetres, then still.
  return [0, pl.rest + 0.06 * Math.abs(Math.sin(b * 9)) * Math.exp(-b * 5), dz];
}

