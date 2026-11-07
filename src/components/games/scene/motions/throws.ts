import type { Athlete } from "@/lib/games/athlete";
import type { ThrowAttempt } from "@/lib/games/throws";
import { JT, SP, jtLine } from "@/lib/games/venues";
import type { Vec3 } from "@/lib/race/director";
import type { ActorPose } from "../pose";
import { bump, clamp01, dims, ease, gaitActor, idleActor, isBiped, lerp, runAt, runUp, smooth, wobble, type Dims, type RunUp } from "./common";

/**
 * The throws, driven by each throw's physics (lib/games/throws), on a
 * local clock with the release at τ = 0:
 *
 * - shot put: the glide (back to the sector, crouched low at the back of
 *   the circle, a slide across it), then the delivery: up and round, the
 *   arm punching the shot out from the neck, the reverse to stay in;
 * - javelin: the run-up with the javelin over the shoulder, the
 *   withdrawal, the block (the front leg planted, the body leaning back),
 *   the whip of the arm; the javelin flies nose along its path and sticks;
 * - no arms: a head or tail flick, the body lunging into it;
 * - too weak to lift it: a strain, and the implement stays where it is.
 *
 * The implement flies the physics' path (sampled every 1/60 s) with a
 * trail, lands with a divot and a puff of turf, and stays there.
 */

export interface ThrowPlan {
  athlete: Athlete;
  dims: Dims;
  attempt: ThrowAttempt;
  shot: boolean;
  /** Where the implement leaves the hand (x), the throw's direction is −x. */
  releaseX: number;
  run: RunUp | null;
  start: number;
  end: number;
  flight: number;
  /** Landing point (x) and height of the release (m). */
  landX: number;
  noMark: boolean;
  armless: boolean;
  biped: boolean;
}

const RUN = 22;

export function planThrow(a: Athlete, attempt: ThrowAttempt): ThrowPlan {
  const d = dims(a);
  const ph = attempt.physics;
  const shot = ph.implement === "shot";
  const line = shot ? SP.x - SP.r : jtLine();
  const releaseX = line - ph.reach;
  const run = shot ? null : runUp(a, RUN, attempt.form, 0.8);
  const flight = ph.noMark ? 0 : ph.flight;
  const start = shot ? -3.2 : -(run!.T + 1.4);
  return { athlete: a, dims: d, attempt, shot, releaseX, run, start, end: flight + 3, flight, landX: releaseX - (ph.distance - ph.reach), noMark: ph.noMark, armless: ph.armless, biped: isBiped(a) };
}

export interface ThrowScene {
  pose: ActorPose;
  /** The implement: where it is and where it points; the trail behind it. */
  pos: Vec3 | null;
  dir: Vec3;
  trail: Vec3[];
  /** Seconds since it landed (null before). */
  landed: number | null;
  /** The javelin quivering in the turf (seconds since it stuck). */
  stuck: number;
  com: Vec3;
}

function pathAt(pl: ThrowPlan, t: number): { x: number; y: number; vx: number; vy: number } {
  const p = pl.attempt.physics.path;
  const n = p.length / 2;
  const f = Math.max(0, Math.min(n - 1.001, t * 60));
  const i = Math.floor(f), u = f - i;
  const x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[i * 2 + 2], y1 = p[i * 2 + 3];
  return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, vx: (x1 - x0) * 60, vy: (y1 - y0) * 60 };
}

export function throwAt(pl: ThrowPlan, tau: number, time: number): ThrowScene {
  const a = pl.athlete, d = pl.dims, ph = pl.attempt.physics;
  const z = pl.shot ? SP.z : JT.z;
  const H = d.h;
  let pose: ActorPose;
  let pos: Vec3 | null = null;
  let dir: Vec3 = [-1, 0, 0];
  const trail: Vec3[] = [];
  let com: Vec3 = [pl.releaseX, H * 0.6, z];
  // Where the hand holds it: up at the neck (or the head, without arms), a little behind the body.
  const hand = (x: number, y: number, back: number, up: number): Vec3 => [x + back, y + up, z + 0.05];
  if (pl.noMark) {
    // It can't lift it: a crouch, a strain, and the implement stays on the ground.
    const x = pl.shot ? SP.x - 0.2 : jtLine() + 1.5;
    pose = idleActor(a, d, x + 0.3 * Math.max(0.5, d.w), z, -1, 0, time, 5);
    const k = clamp01((tau + 2.2) / 2.6);
    pose.squash = -0.18 * bump(0, 1, k);
    pose.lean = 0.45 * bump(0, 1, k);
    pose.shake = 0.012 * Math.max(0.3, H) * bump(0.25, 0.85, k);
    pose.arms = { a: -0.2, b: -0.4, k: bump(0, 1, k) };
    pos = [x - 0.15, pl.shot ? 0.06 : 0.02, z + 0.05];
    dir = [-1, 0, 0];
    return { pose, pos, dir, trail, landed: null, stuck: 0, com: [x, H * 0.5, z] };
  }
  if (pl.shot) {
    const cx = SP.x;
    const r = SP.r;
    if (tau < -1.6) {
      // Into the back of the circle, back to the sector.
      pose = idleActor(a, d, cx + r * 0.7, z, -1, 0, time, 6);
      pose.turn = Math.PI;
      pose.lean = -0.1;
      pos = hand(cx + r * 0.7, H * 0.8, 0.12 * H, 0);
    } else if (tau < 0) {
      const glide = pl.biped && !pl.armless;
      const k1 = smooth(-1.6, -0.95, tau), k2 = smooth(-0.95, -0.45, tau), k3 = smooth(-0.45, 0, tau);
      // The glide: down low at the back, a slide across, then up and round into the put.
      const x = lerp(cx + r * 0.7, cx - r * 0.25, glide ? k2 : 0.3 * k2) - (glide ? 0 : 0) + lerp(0, -r * 0.35, k3);
      pose = idleActor(a, d, x, z, -1, 0, time, 6);
      pose.turn = Math.PI * (1 - ease(smooth(-0.32, -0.02, tau)));
      pose.squash = -0.2 * k1 * (1 - k3) + 0.08 * k3;
      pose.lean = lerp(-0.1, -0.55, k1) * (1 - k3) + 0.4 * k3;
      pose.legs = { a: 0.4 * k2 * (1 - k3), b: -0.6 * k1 * (1 - k3), k: 0.9, split: 0.35 * k3 };
      if (!pl.armless) {
        pose.raise = 0.25 + 0.45 * k3;
        pose.arms = { a: lerp(-0.3, 1.25, k3), b: lerp(-1.2, 0, k3), k: 1 };
      }
      pose.y = 0.03 * H * bump(-0.95, -0.45, tau);
      // The shot rides at the neck until the arm drives it out to the release point.
      const neck = hand(x, H * (pl.armless ? 0.95 : 0.78) * (1 - 0.18 * k1 * (1 - k3)), (pl.armless ? 0 : 0.1 * H) * (1 - k3), 0);
      pos = [lerp(neck[0], pl.releaseX, k3 * k3), lerp(neck[1], ph.height, k3 * k3), z + 0.05];
    } else {
      // The reverse: the front foot comes back, a hop to stay in, then it watches.
      const x = cx - r * 0.55;
      pose = idleActor(a, d, x, z, -1, 0, time, 6);
      const s = tau;
      pose.lean = 0.4 * Math.exp(-s / 0.5) - 0.05;
      pose.y = 0.08 * H * bump(0.05, 0.4, s);
      pose.squash = -0.06 * bump(0.35, 0.6, s);
      pose.legs = { a: 0, b: -0.3, k: Math.exp(-s / 0.6), split: 0.4 * Math.exp(-s / 0.5) };
      if (!pl.armless) { pose.arms = { a: 1.2 * Math.exp(-s / 0.7), b: 0, k: 1 }; pose.raise = 0.6 * Math.exp(-s / 0.5); }
    }
    com = [pose.x, H * 0.6, z];
  } else {
    const run = pl.run!;
    const T = run.T;
    const startX = jtLine() + RUN + 0.6;
    if (tau < -T) {
      pose = idleActor(a, d, startX, z, -1, 0, time, 7);
      pose.lean = 0.06 + 0.06 * Math.sin((tau - pl.start) * 3);
      pos = hand(startX, H * 0.9, 0.18 * H, 0.05 * H);
      dir = [-0.96, 0.28, 0];
    } else if (tau < 0) {
      const st = runAt(run, tau + T);
      const x = startX - st.s;
      pose = gaitActor(a, d, x, z, -1, 0, st, time);
      const wd = smooth(-1.2, -0.75, tau), block = smooth(-0.28, -0.08, tau), whip = smooth(-0.12, 0, tau);
      // The withdrawal draws the javelin back; the block plants and leans back; the arm whips through.
      pose.lean = lerp(pose.lean, -0.32, block) + 0.55 * whip;
      pose.turn = 0.5 * wd * (1 - whip);
      if (!pl.armless) {
        pose.arms = { a: lerp(-0.4, -1.6, wd) * (1 - whip) + 1.3 * whip, b: -0.3 * (1 - whip), k: 1 };
        pose.raise = 0.25 + 0.3 * whip;
      }
      const back = lerp(0.18, 0.62, wd) * (1 - whip) * H;
      pos = [lerp(x + back, pl.releaseX, whip * whip), lerp(H * 0.92, ph.height, whip), z + 0.05];
      dir = [-Math.cos(0.35 + 0.25 * wd), Math.sin(0.35 + 0.25 * wd), 0];
    } else {
      const x = pl.releaseX + 0.4 * Math.max(0.5, H * 0.3) + 0.8 * (1 - Math.exp(-tau / 0.5));
      pose = idleActor(a, d, pl.releaseX + 0.3 - 0.9 * (1 - Math.exp(-tau / 0.4)), z, -1, 0, time, 7);
      pose.lean = 0.5 * Math.exp(-tau / 0.5);
      pose.legs = { a: -0.4 * Math.exp(-tau / 0.6), b: -0.3, k: Math.exp(-tau / 0.8) };
      if (!pl.armless) pose.arms = { a: 1.2 * Math.exp(-tau / 0.6), b: 0, k: 1 };
      void x;
    }
    com = [pose.x, H * 0.6, z];
  }
  // The broadcast's tracer: the whole path from the hand so far (and once it's down, all of it, so the
  // arc hangs over the sector while the mark is measured).
  const tracer = (upto: number) => {
    const n = Math.min(110, Math.max(2, Math.ceil(upto / 0.035)));
    for (let k = 0; k <= n; k++) {
      const q = pathAt(pl, (upto * k) / n);
      trail.push([pl.releaseX - q.x, q.y, z]);
    }
  };
  // In flight, and then on the ground.
  let landed: number | null = null, stuck = 0;
  if (tau >= 0) {
    if (tau < pl.flight) {
      const p = pathAt(pl, tau);
      pos = [pl.releaseX - p.x, p.y, z];
      dir = pl.shot ? [-1, 0, 0] : [-p.vx, p.vy, 0];
      tracer(tau);
      com = [pos[0], pos[1], z];
    } else {
      landed = tau - pl.flight;
      tracer(pl.flight);
      const p = pathAt(pl, pl.flight);
      const v = pathAt(pl, pl.flight - 1 / 60);
      if (pl.shot) {
        // The shot bites into the turf and rolls a hand's width.
        pos = [pl.landX - 0.25 * (1 - Math.exp(-landed * 3)), 0.035, z];
      } else {
        // The javelin sticks, tip in, at the angle it came down, and quivers.
        const ang = Math.atan2(-v.vy, v.vx);
        const tilt = Math.min(1.2, Math.max(0.35, ang * 0.85));
        dir = [-Math.cos(tilt), -Math.sin(tilt), 0];
        pos = [pl.landX + Math.cos(tilt) * 1.1, Math.sin(tilt) * 1.1, z];
        stuck = landed;
        dir[1] += 0.03 * wobble(landed, 0, 7, 3.5);
      }
      void p;
      com = [pl.landX, 0.5, z];
    }
  }
  return { pose, pos, dir, trail, landed, stuck, com };
}
