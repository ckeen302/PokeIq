import type { Athlete } from "@/lib/games/athlete";
import { boutAt, type BoutTrace } from "@/lib/games/wrestle";
import { dohyoScale, dohyoTop } from "@/lib/games/venues";
import type { Vec3 } from "@/lib/race/director";
import type { ActorPose } from "../pose";
import { bump, dims, idleActor, isBiped, lerp, smooth, walkPhase, type Dims } from "./common";

/**
 * A wrestling bout on the dohyō, driven by the bout's trace (lib/games/
 * wrestle: the contact point along the push line, each one's effort, the
 * surges), on a local clock with the charge at τ = 0:
 *
 * - the ritual: in from the edge, a stamp of each foot, a throw of salt,
 *   the crouch behind the starting line;
 * - the charge (the tachiai): both launch and meet;
 * - the lock-up: the pair moving with the contact point, leaning into each
 *   other, legs driving (the pusher) or braced and sliding (the pushed),
 *   jolting at each surge, the clay scuffed under the sliding feet;
 * - the end: the loser's feet over the straw, off the edge of the dohyō
 *   and down; or the bell at 30 s.
 *
 * The push line is the x axis (wrestler a on the −x side), seen side-on
 * from +z.
 */

export interface WrestlePlan {
  trace: BoutTrace;
  a: Athlete;
  b: Athlete;
  da: Dims;
  db: Dims;
  ring: number;
  top: number;
  scale: number;
  start: number;
  end: number;
}

export function planBout(tr: BoutTrace): WrestlePlan {
  const scale = dohyoScale(tr.ring);
  return { trace: tr, a: tr.a, b: tr.b, da: dims(tr.a), db: dims(tr.b), ring: tr.ring, top: dohyoTop(tr.ring), scale, start: -7, end: tr.end + 3.5 };
}

export interface WrestleScene {
  a: ActorPose;
  b: ActorPose;
  /** The contact point, the moment the loser left the ring (null before), salt throws and stamps (τ). */
  contact: Vec3;
  out: number | null;
  rituals: { t: number; who: "a" | "b"; kind: "stamp" | "salt" }[];
  /** Which one is going backwards and how fast (m/s, + towards b's edge). */
  v: number;
}

export const RITUALS: { t: number; who: "a" | "b"; kind: "stamp" | "salt" }[] = [
  { t: -5.6, who: "a", kind: "stamp" },
  { t: -5.3, who: "b", kind: "stamp" },
  { t: -4.6, who: "a", kind: "stamp" },
  { t: -4.3, who: "b", kind: "stamp" },
  { t: -3.4, who: "a", kind: "salt" },
  { t: -3.25, who: "b", kind: "salt" },
];

export function boutPose(pl: WrestlePlan, tau: number, time: number): WrestleScene {
  const tr = pl.trace;
  const sc = pl.scale;
  const line = 0.35 * sc;
  const end = tr.end;
  const sNow = boutAt(tr, Math.max(0, tau));
  const sPrev = boutAt(tr, Math.max(0, tau - 0.05));
  const v = tau > 0 && tau < end ? (sNow - sPrev) / 0.05 : 0;
  const poses = (["a", "b"] as const).map((who) => {
    const ath = who === "a" ? pl.a : pl.b;
    const d = who === "a" ? pl.da : pl.db;
    const sign = who === "a" ? -1 : 1;
    const depth = who === "a" ? tr.da : tr.db;
    const H = d.h;
    // Where it crouches: behind its line; where it meets: its half-depth back from the contact point.
    const crouchX = sign * (line + depth);
    const edgeX = sign * (pl.ring * 0.8 + depth);
    let x: number;
    let p: ActorPose;
    if (tau < -2.4) {
      // In from the edge, the stamps and the salt.
      const k = smooth(-7, -6, tau);
      x = lerp(edgeX, crouchX - sign * 0.6 * sc, k);
      p = idleActor(ath, d, x, 0, -sign, 0, time, who === "a" ? 1 : 2);
      if (tau < -6) p.gait = { motion: ath.entrant.motion, phase: walkPhase(d, 1, tau + 7), v: 1 };
      for (const r of RITUALS) {
        if (r.who !== who) continue;
        const u = tau - r.t;
        if (r.kind === "stamp" && u > -0.5 && u < 0.35) {
          // Shiko: a leg high to the side, then down hard.
          const up = smooth(-0.5, -0.1, u) * (1 - smooth(-0.05, 0.08, u));
          p.legs = isBiped(ath) ? { a: 0.9 * up, b: -0.2 * up, k: 1, split: 0.8 * up } : { a: 0.4 * up, b: -0.4 * up, k: 1 };
          p.sway = 0.18 * up * (r.t === -5.6 || r.t === -5.3 ? 1 : -1);
          p.squash = -0.12 * bump(-0.05, 0.3, u);
        }
        if (r.kind === "salt" && u > -0.4 && u < 0.6) {
          p.raise = ath.arms ? bump(-0.4, 0.5, u) * 0.8 : 0;
          p.lean = -0.1 * bump(-0.4, 0.5, u);
        }
      }
    } else if (tau < 0) {
      // Down into the crouch behind the line, fists to the clay.
      const k = smooth(-2.4, -1.2, tau);
      x = lerp(crouchX - sign * 0.6 * sc, crouchX, k);
      p = idleActor(ath, d, x, 0, -sign, 0, time, who === "a" ? 1 : 2);
      p.squash = -0.22 * k;
      p.lean = 0.5 * k;
      p.headOn = lerp(0.32, 0.8, k);
      p.legs = { a: 0.4 * k, b: -0.8 * k, k };
      if (ath.arms) p.arms = { a: 0.6 * k, b: 0.2 * k, k };
    } else {
      // The charge, then locked together on the contact point.
      const k = smooth(0, 0.28, tau);
      // Drawn chest to chest, not one inside the other: a figure is wider on screen than it is deep along the push, so
      // each stands its drawn half-width back from the contact point. As it is driven to its own edge it closes up to
      // its real depth again, so its feet leave the ring exactly when the bout says they do.
      const wide = Math.max(depth, 0.36 * d.w);
      const edge = (sign * sNow + depth) / tr.ring;
      const stand = lerp(wide, depth, smooth(0.72, 1, edge));
      x = lerp(crouchX, sNow * k + sign * stand, k);
      p = idleActor(ath, d, x, (who === "a" ? 0.1 : -0.1) * depth * k, -sign, 0, time, who === "a" ? 1 : 2);
      // Going forward (towards the other) when the contact point moves its way.
      const fwd = -sign * v;
      const i = Math.min(tr.ea.length - 1, Math.floor(Math.min(tau, end) / tr.step));
      const effort = who === "a" ? tr.ea[i] : tr.eb[i];
      let surge = 0;
      for (const sg of tr.surges) if (sg.who === who) surge = Math.max(surge, bump(sg.t, sg.t + 0.32, tau));
      // The other's surge lands on it: it rocks back and gives a few centimetres, then leans in again.
      let hit = 0;
      for (const sg of tr.surges) if (sg.who !== who) hit = Math.max(hit, bump(sg.t + 0.06, sg.t + 0.46, tau));
      const live = tau < end ? 1 : 0;
      // Driving forward it leans in low; driven back it is stood up, heels dug in.
      const drive = Math.max(-1, Math.min(1, fwd / 0.3));
      p.lean = lerp(0.5, 0.26 + 0.08 * effort + 0.12 * surge + (0.1 * Math.max(0, drive) - 0.14 * Math.max(0, -drive) - 0.14 * hit) * live, k);
      p.squash = -0.14 - 0.06 * surge + 0.05 * hit * live;
      x += sign * depth * (0.07 * hit - 0.05 * surge) * live * k;
      p.x = x;
      // Turned three quarters towards each other (not both flat to the lens): two bodies, meeting at the contact point.
      p.headOn = lerp(0.32, 1.05, k);
      // Legs: driving (short steps as it moves forward) or braced and sliding back.
      if (fwd > 0.05) p.gait = { motion: ath.entrant.motion, phase: (Math.abs(sNow) / Math.max(0.2, d.hip * 1.4)) * 2 + tau * 1.2, v: Math.min(2.2, 0.6 + fwd * 2) };
      else p.legs = { a: -0.35, b: -0.5, k: 1, split: 0.4 };
      if (ath.arms) p.arms = { a: 1.1 + 0.2 * surge, b: 0.5, k: 1 };
      p.shake = 0.004 * H * (0.5 + surge) * (tau < end ? 1 : 0);
      p.sway = 0.04 * Math.sin(time * 2.3 + (who === "a" ? 0 : 1.7));
      if (tau >= end) {
        const u = tau - end;
        const lost = tr.winner !== who;
        p.shake = 0;
        p.gait = null;
        if (lost && tr.ringOut) {
          // Carried on over the straw by its momentum, to the dohyō's edge and off it, down to the floor.
          const edge = pl.ring * 1.4725;
          const target = sign * (edge + 0.35 * sc + depth * 0.4);
          x = lerp(x, target, smooth(0, 0.9, u));
          p.x = x;
          p.y = -pl.top * smooth(0.5, 0.85, u);
          p.roll = -0.55 * smooth(0.4, 0.95, u);
          p.lean = lerp(p.lean, -0.35, smooth(0, 0.5, u));
          p.legs = { a: -0.5, b: -0.4, k: smooth(0, 0.4, u) };
          p.arms = ath.arms ? { a: 1.6 * smooth(0.2, 0.6, u), b: 0.3, k: 1 } : undefined;
        } else if (!lost) {
          // The winner: upright, a breath; a fist up if it has arms.
          const r = smooth(0.2, 1, u);
          p.lean = lerp(p.lean, 0.05, r);
          p.squash = lerp(p.squash, 0, r);
          p.legs = undefined;
          p.arms = undefined;
          p.raise = ath.arms ? 0.6 * smooth(0.6, 1.2, u) : 0;
        } else {
          // At the bell: both straighten up.
          const r = smooth(0, 0.8, u);
          p.lean = lerp(p.lean, 0.1, r);
          p.squash = lerp(p.squash, 0, r);
          p.legs = undefined;
        }
      }
    }
    p.y += pl.top;
    p.ground = tau >= end && tr.winner !== who && tr.ringOut && tau - end > 0.55 ? 0 : pl.top;
    return p;
  });
  const out = tau >= end && tr.ringOut ? tau - end : null;
  const cx = tau > 0.28 ? sNow : 0;
  return { a: poses[0], b: poses[1], contact: [cx, pl.top + 0.55 * Math.max(pl.da.h, pl.db.h), 0], out, rituals: RITUALS, v };
}

