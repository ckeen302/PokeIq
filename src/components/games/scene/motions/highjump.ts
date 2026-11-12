import { G, HIGH_JUMP } from "@/lib/games/constants";
import { highJumpPhysics, type HjJump } from "@/lib/games/highjump";
import { topSpeed } from "@/lib/race/model";
import type { Athlete } from "@/lib/games/athlete";
import { HJ } from "@/lib/games/venues";
import type { ActorPose } from "../pose";
import { bump, clamp01, dims, idleActor, isBiped, lerp, smooth, walkPhase, wobble, type Dims } from "./common";

/**
 * The high jump, driven by the jump's physics (lib/games/highjump): a
 * curved approach (a J, leaning into the bend), the plant and the take-off
 * (arms and the lead knee driving up), then:
 *
 * - bipeds: a Fosbury flop: they turn their back to the bar at take-off,
 *   go over head first with the back arched, flick the legs up and land
 *   on their shoulders;
 * - four legs, serpents and everyone else: a leap, the body pitching over
 *   the bar, legs tucked;
 * - the bar: a brush makes it bounce and roll on its pins; a near miss
 *   wobbles and drops it; a clear miss knocks it straight off; the mat
 *   dents under the landing and springs back.
 *
 * Bodies are drawn cards, so the body is drawn over the physical path of
 * the centre of mass by its technique and half its thickness: it skims the
 * bar exactly by the jump's margin, touching it when the jump fell short.
 */

export interface HighJumpPlan {
  athlete: Athlete;
  dims: Dims;
  jump: HjJump;
  /** Size scale of the approach (m per metre of a 1.9 m jumper). */
  s: number;
  vApp: number;
  /** The approach: a quadratic curve S → C → T (x, z). */
  S: [number, number];
  C: [number, number];
  T: [number, number];
  tApp: number;
  length: number;
  /** Arc length table for the approach curve. */
  table: { u: number; s: number }[];
  /** Flight: vertical and horizontal take-off speeds, the peak time, the landing time. */
  vv: number;
  vh: number;
  com: number;
  tPeak: number;
  tLand: number;
  /** How far the drawn body rides over the physical centre of mass (m). */
  lift: number;
  /** Bar contact: "clear" (well over), "brush" (bounces, stays), "near" (wobbles, falls), "hit" (straight off). */
  contact: "clear" | "brush" | "near" | "hit";
  fosbury: boolean;
  start: number;
  end: number;
}

const bez = (p: [number, number], q: [number, number], r: [number, number], u: number): [number, number] => [
  (1 - u) * (1 - u) * p[0] + 2 * (1 - u) * u * q[0] + u * u * r[0],
  (1 - u) * (1 - u) * p[1] + 2 * (1 - u) * u * q[1] + u * u * r[1],
];

export function planHighJump(a: Athlete, jump: HjJump): HighJumpPlan {
  const d = dims(a);
  const s = Math.max(0.35, Math.min(6, d.h / 1.9));
  const ph = highJumpPhysics(a, jump.form);
  const fosbury = isBiped(a);
  const vv = Math.max(0.5, ph.vv);
  const vh = Math.min(4, 2.6 * Math.sqrt(s));
  const tPeak = vv / G;
  // Take-off where the peak of the flight is over the bar.
  const T: [number, number] = [HJ.barX + vh * tPeak, HJ.z - 0.2 * s];
  const C: [number, number] = [HJ.barX + 6.5 * s + vh * tPeak, HJ.z + 0.8 * s];
  const S: [number, number] = [HJ.barX + 15 * s + vh * tPeak, HJ.z + 7.5 * s];
  const table: { u: number; s: number }[] = [{ u: 0, s: 0 }];
  let len = 0, prev = bez(S, C, T, 0);
  for (let i = 1; i <= 64; i++) {
    const u = i / 64, p = bez(S, C, T, u);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    table.push({ u, s: len });
    prev = p;
  }
  const vApp = Math.max(1.2, Math.min(8, 0.75 * topSpeed(a.stats.spe)) * Math.min(1, 0.6 + 0.4 * s));
  // A Furusawa-style pick-up (τ 0.6 s) to the approach speed.
  let tApp = len / vApp + 0.6;
  for (let i = 0; i < 30; i++) {
    const x = vApp * (tApp - 0.6 * (1 - Math.exp(-tApp / 0.6)));
    const v = vApp * (1 - Math.exp(-tApp / 0.6));
    tApp -= (x - len) / Math.max(0.1, v);
  }
  const com = ph.com;
  const matTop = HJ.matH;
  // Down onto the mat (the drawn body lies on it), from the peak.
  const lift = ph.technique + d.w * 0.25;
  const peakDrawn = com + (vv * vv) / (2 * G) + lift;
  const restY = matTop + Math.min(d.w, d.h) * 0.3;
  const fall = Math.max(0.05, peakDrawn - restY);
  const tLand = tPeak + Math.sqrt((2 * fall) / G);
  const m = jump.margin;
  const contact = jump.cleared ? (m < HIGH_JUMP.brush ? "brush" : "clear") : m > -0.035 ? "near" : "hit";
  return { athlete: a, dims: d, jump, s, vApp, S, C, T, tApp, length: len, table, vv, vh, com, tPeak, tLand, lift, contact, fosbury, start: -tApp - 1.2, end: tLand + 3.2 };
}

function along(pl: HighJumpPlan, dist: number): { x: number; z: number; dx: number; dz: number; curv: number } {
  const t = pl.table;
  const sd = Math.max(0, Math.min(pl.length, dist));
  let i = 1;
  while (i < t.length - 1 && t[i].s < sd) i++;
  const a = t[i - 1], b = t[i];
  const u = a.u + ((sd - a.s) / Math.max(1e-9, b.s - a.s)) * (b.u - a.u);
  const p = bez(pl.S, pl.C, pl.T, u);
  const p2 = bez(pl.S, pl.C, pl.T, Math.min(1, u + 0.01));
  const p0 = bez(pl.S, pl.C, pl.T, Math.max(0, u - 0.01));
  let dx = p2[0] - p0[0], dz = p2[1] - p0[1];
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  // Signed curvature (turning left is +).
  const ax = pl.C[0] - pl.S[0], az = pl.C[1] - pl.S[1], bx = pl.T[0] - pl.C[0], bz = pl.T[1] - pl.C[1];
  const curv = Math.sign(ax * bz - az * bx) * (1 / Math.max(2, pl.length * 0.35));
  return { x: p[0], z: p[1], dx, dz, curv };
}

export interface HighJumpScene {
  pose: ActorPose;
  /** The bar: bounce (m), roll on the pins (rad), fall (0..1), which side it falls. */
  bar: { bounce: number; spin: number; fall: number; side: number };
  dent: [number, number, number, number];
  landed: number | null;
  com: [number, number, number];
}

export function highJumpAt(pl: HighJumpPlan, tau: number, time: number): HighJumpScene {
  const a = pl.athlete, d = pl.dims;
  const bar = { bounce: 0, spin: 0, fall: 0, side: 1 };
  let dent: [number, number, number, number] = [HJ.barX - HJ.matD / 2, HJ.z, 0, 1];
  let pose: ActorPose;
  let com: [number, number, number] = [pl.T[0], pl.com, pl.T[1]];
  // Bar contact happens as the body passes over (just after the peak).
  const tCross = pl.tPeak * 1.05;
  if (pl.contact === "brush" || pl.contact === "near") {
    bar.bounce = 0.022 * wobble(tau, tCross, 5.5, 3.2);
    bar.spin = 0.35 * wobble(tau, tCross, 2.2, 2.5);
  }
  if (pl.contact === "near") bar.fall = clamp01((tau - tCross - 0.42) / 0.55);
  if (pl.contact === "hit") bar.fall = clamp01((tau - tCross + 0.05) / 0.45);
  if (tau < -pl.tApp) {
    pose = idleActor(a, d, pl.S[0], pl.S[1], -1, 0, time, 3);
    // Rocking on the mark, counting the strides in its head.
    const k = clamp01((tau - pl.start) / 1.2);
    pose.lean = 0.1 * Math.sin(k * Math.PI * 2.5);
    com = [pl.S[0], d.h * 0.55, pl.S[1]];
  } else if (tau < 0) {
    const t = tau + pl.tApp;
    const dist = pl.vApp * (t - 0.6 * (1 - Math.exp(-t / 0.6)));
    const v = pl.vApp * (1 - Math.exp(-t / 0.6));
    const p = along(pl, dist);
    const strideHz = Math.min(4.6, v / Math.max(0.3, d.hip * 2.4)) * 2;
    pose = {
      visible: true, x: p.x, y: 0, z: p.z, dx: p.dx, dz: p.dz,
      lean: 0.12 * smooth(0, 0.6, t) - 0.18 * smooth(-0.22, 0, tau),
      roll: 0,
      // Leaning into the bend: tan θ = v²/(r g).
      sway: -Math.atan((v * v * p.curv) / G) * 0.8 * smooth(-1.4, -0.5, tau) * (1 - smooth(-0.1, 0, tau)),
      squash: -0.07 * bump(-0.4, -0.08, tau) + 0.03 * Math.sin(t * strideHz * Math.PI * 2) * 0.5,
      gait: { motion: a.entrant.motion, phase: t * strideHz, v },
      shadow: 1,
    };
    // The penultimate step sinks the hips; at the plant the arms and the lead knee drive up (a serpent coils instead).
    if (a.entrant.motion === "slither") pose.squash -= 0.14 * smooth(-0.3, -0.04, tau);
    else if (tau > -0.12) { pose.raise = smooth(-0.12, 0, tau) * 0.7; pose.legs = { a: 0.9, a2: -0.4, b: -0.6, k: smooth(-0.12, 0, tau) }; }
    com = [p.x, d.h * 0.55, p.z];
  } else if (tau < pl.tLand) {
    const k = tau / pl.tLand;
    const yPhys = pl.com + pl.vv * tau - 0.5 * G * tau * tau;
    const yDraw = yPhys + pl.lift * smooth(0, pl.tPeak, tau);
    const x = pl.T[0] - pl.vh * tau;
    const z = pl.T[1];
    const pv = 0.55;
    pose = { visible: true, x, y: yDraw - pv * d.h, z, dx: -1, dz: 0, lean: 0, roll: 0, pivot: pv, squash: 0.04 * bump(0, 0.5, k), gait: null, shadow: 1 };
    // The body's pitch follows its flight: nose up off the ground, level over the bar, nose down to the mat.
    const vy = pl.vv - G * tau;
    const pitch = Math.atan2(vy, Math.max(0.5, pl.vh));
    // A stretch out of the take-off, settling over the top.
    const spring = 0.1 * Math.exp(-tau / 0.12);
    if (pl.fosbury) {
      // Back to the bar, head first: driving up off the plant (the lead knee and both arms high), turning its back to
      // the bar as it rises; laid out flat over it, hips up and the back arched, head and heels hanging; once the
      // hips are over, the chin tucks and the legs flick straight up, and it lands on its shoulders.
      const over = tCross;
      pose.turn = Math.PI * smooth(0, Math.min(0.3, pl.tPeak * 0.55), tau);
      pose.roll = lerp(0, Math.PI * 0.5, smooth(0.04, pl.tPeak * 0.9, tau)) + 0.6 * smooth(over, pl.tLand, tau);
      pose.bend = 0.22 * bump(pl.tPeak * 0.5, over + (pl.tLand - over) * 0.35, tau) - 0.14 * smooth(over + (pl.tLand - over) * 0.25, pl.tLand * 0.95, tau);
      const flick = smooth(over, over + (pl.tLand - over) * 0.45, tau);
      const drive = 1 - smooth(0.02, pl.tPeak * 0.5, tau);
      pose.legs = {
        a: lerp(lerp(-0.35, 0.95, drive), 0.95, flick),
        a2: lerp(lerp(-0.35, -0.15, drive), 0.85, flick),
        b: lerp(lerp(-1.25, -1.1, drive), -0.08, flick),
        k: 1,
      };
      pose.raise = 0.75 * drive;
      pose.arms = { a: lerp(-0.25, 0.5, flick), b: -0.15, k: smooth(0, pl.tPeak * 0.6, tau) };
      pose.squash = spring - 0.03 * bump(pl.tPeak * 0.5, over, tau);
    } else if (a.entrant.motion === "gallop" || a.entrant.motion === "scuttle") {
      // A bound: hind legs extended off the ground, all four folded under over the bar, the front legs reaching for the mat.
      pose.lean = -pitch * 0.85;
      const tuck = bump(0, pl.tLand, tau);
      const reach = smooth(tCross, pl.tLand, tau);
      pose.legs = { a: lerp(-0.2, 0.55, reach), a2: lerp(-0.7 * (1 - smooth(0, 0.18, tau)), 0.1, tuck), b: -1.05 * tuck * (1 - reach * 0.6), k: 0.95, split: 0.25 * (1 - tuck) };
      pose.tail = { a: -0.5 * pitch, b: 0.2, k: 0.7 };
      pose.squash = spring - 0.05 * tuck;
    } else if (a.entrant.motion === "slither") {
      // A serpent springs from a coil, its body following the arc and bowed over the bar.
      pose.lean = -pitch * 0.9;
      pose.squash = 0.16 * Math.exp(-tau / 0.18) - 0.04;
      pose.bend = 0.16 * bump(pl.tPeak * 0.3, pl.tLand * 0.9, tau);
    } else {
      // A hop: the body pitches with the flight, tucked over the top.
      pose.lean = -pitch * 0.7;
      pose.squash = spring + 0.05 * bump(0, 0.6, k) - 0.06 * bump(pl.tPeak * 0.6, pl.tPeak * 1.4, tau);
    }
    pose.wings = { a: 0.12, b: 0.05, k: 0.9 };
    com = [x, yDraw, z];
  } else {
    const s = tau - pl.tLand;
    const x = pl.T[0] - pl.vh * pl.tLand;
    // Into the mat: it dents under the landing and springs back.
    const impact = Math.min(0.5, 0.09 * Math.pow(Math.max(1, a.kg) / 70, 0.33) * Math.sqrt(Math.max(0.2, pl.vv)));
    const depth = impact * Math.exp(-s / 0.45) * (1 + 0.15 * Math.sin(s * 14) * Math.exp(-s * 4));
    dent = [x, pl.T[1], depth, Math.max(0.5, d.w * 0.6)];
    const up = smooth(0.9, 1.9, s);
    const restY = HJ.matH - depth * 0.6;
    pose = idleActor(a, d, x + 0.6 * up * pl.s, pl.T[1], -1, 0, time, 4);
    pose.y = restY;
    pose.ground = HJ.matH;
    if (pl.fosbury) {
      pose.turn = Math.PI * (1 - up);
      pose.roll = (Math.PI * 0.5 + 0.55) * (1 - up);
      pose.pivot = 0.3;
    } else {
      pose.lean = 0.3 * (1 - up);
    }
    pose.squash = -0.12 * Math.exp(-s / 0.3);
    // A clearance: up off the mat, arms raised; a miss: a slap of the mat.
    pose.raise = pl.jump.cleared ? smooth(1.3, 1.9, s) : 0;
    if (s > 2.1) { pose.gait = { motion: a.entrant.motion, phase: walkPhase(d, 0.9, s - 2.1), v: 0.9 }; }
    com = [x, restY + d.h * 0.4, pl.T[1]];
  }
  return { pose, bar, dent, landed: tau >= pl.tLand ? tau - pl.tLand : null, com };
}
