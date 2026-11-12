import type { Athlete } from "@/lib/games/athlete";
import { swimAt, type SwimRun } from "@/lib/games/swim";
import { POOL, poolLaneZ, poolX } from "@/lib/games/venues";
import type { ActorPose } from "../pose";
import { bump, clamp01, dims, idleActor, lerp, smooth, type Dims } from "./common";

/**
 * A swimmer in its lane, driven by its swim trace (lib/games/swim: the
 * front's distance and speed every 10 ms, the reaction, the dive, the
 * entry, the turn, the touch), on the race clock (0 = the start signal):
 *
 * - on the block, crouched; the dive in a parabola from the block to the
 *   entry point; the underwater glide; up to the surface and away;
 * - the stroke by body: a biped with arms swims front crawl (lying along
 *   the lane, arms windmilling, a flutter kick); a fish-shaped or water-
 *   dwelling body swims with its body wave (the Race's swimming gait); a
 *   serpent ripples along its length; everyone else paddles, head up;
 * - the flip turn at 50 m in the 100: a somersault and a push-off;
 * - the touch at the wall, then treading water (the winner's arms up).
 *
 * Under the water's surface the figure fades into the water's blue (seen
 * from above, the body under the surface shows through), and the water's
 * shader draws its bow wave, wake and white water from where it is and how
 * fast it's going (scene/venues/pool). A big body rides lower: a whale or
 * a dragon shows its back and head, not its belly.
 */

export type Stroke = "crawl" | "fish" | "serpent" | "paddle";

export function strokeOf(a: Athlete): Stroke {
  if (a.shape === "fish" || a.entrant.motion === "swim") return "fish";
  if (a.body === "serpentine" || a.entrant.motion === "slither") return "serpent";
  if (a.body === "biped" && a.arms) return "crawl";
  return "paddle";
}

export interface SwimPlan {
  run: SwimRun;
  athlete: Athlete;
  dims: Dims;
  stroke: Stroke;
  z: number;
  /** Body length along the lane once swimming, and its half-height in the water. */
  len: number;
  /** Strokes per second at swimming speed. */
  rate: number;
  /** The share of its height under the water when swimming upright (fish, serpent, paddle), and how high it shows above (m). */
  sink: number;
  above: number;
}

/** Seen through the water under the surface (scene/actors: 1 is the pool's clear water). */
const UNDER_FADE = 1;

export function planSwim(run: SwimRun): SwimPlan {
  const a = run.athlete;
  const d = dims(a);
  const stroke = strokeOf(a);
  const len = stroke === "crawl" ? d.h : d.w;
  // Bigger bodies stroke slower (about 0.9 strokes a second for a person, fewer for a whale).
  const rate = Math.max(0.35, Math.min(1.6, 0.95 * Math.pow(Math.max(0.3, len) / 1.8, -0.4)));
  const big = smooth(1.5, 8, d.h);
  const sink = stroke === "fish" ? 0.52 + 0.16 * big : stroke === "serpent" ? 0.52 + 0.12 * big : 0.62 + 0.14 * big;
  const above = stroke === "crawl" ? 0.32 * d.w : (1 - sink) * d.h;
  return { run, athlete: a, dims: d, stroke, z: poolLaneZ(run.lane), len, rate, sink, above };
}

export interface SwimScene {
  pose: ActorPose;
  /** Its front along the pool (world x), direction, speed: for the water's wake (null on the block or in the air). */
  wake: { x: number; z: number; v: number; len: number; dir: number } | null;
  /** The race distance covered (m) and whether it has touched. */
  x: number;
  finished: boolean;
  /** Under water (gliding after the dive or the turn). */
  under: boolean;
}

const BLOCK_X = POOL.startX - 0.36;

export function swimPose(pl: SwimPlan, t: number, time: number): SwimScene {
  const a = pl.athlete, d = pl.dims, tr = pl.run.trace;
  const z = pl.z;
  const H = d.h, W = d.w;
  // On the block: standing, then crouched for "take your marks", then the dive.
  if (t < tr.dive) {
    const p = idleActor(a, d, BLOCK_X, z, 1, 0, time, pl.run.lane);
    p.y = POOL.block;
    p.ground = POOL.block;
    const crouch = smooth(-2.2, -1.4, t);
    p.squash = -0.16 * crouch;
    p.lean = 0.55 * crouch + 0.2 * smooth(tr.reaction - 0.1, tr.dive, t);
    p.legs = { a: 0.3 * crouch, b: -0.6 * crouch, k: crouch };
    if (a.arms) p.arms = { a: -1.2 * crouch, b: 0, k: crouch };
    return { pose: p, wake: null, x: 0, finished: false, under: false };
  }
  const s = swimAt(tr, t);
  const pos = poolX(s.x);
  const dir = pos.dir;
  // The dive: from the block's edge to the entry point, in a parabola, rotating head-first.
  if (t < tr.entry) {
    const k = clamp01((t - tr.dive) / Math.max(0.05, tr.entry - tr.dive));
    const len = pl.stroke === "crawl" ? H : W;
    const fx = lerp(POOL.startX + 0.2, POOL.startX + tr.entryAt, k);
    const y0 = POOL.block + 0.5 * H, y1 = 0;
    const cy = lerp(y0, y1, k) + 4 * Math.min(1.2, 0.3 + 0.2 * H) * k * (1 - k);
    const p = idleActor(a, d, fx - len * 0.45, z, 1, 0, time, pl.run.lane);
    // Stretched out, rotating from level to head-down as it falls.
    const ang = lerp(0.15, 0.75, k);
    if (pl.stroke === "crawl") {
      p.roll = -Math.PI / 2 - ang;
      p.pivot = 0.5;
      p.y = cy - 0.5 * H;
      p.raise = 1;
      p.legs = { a: 0, b: 0, k: 1 };
    } else {
      p.lean = ang;
      p.y = cy - 0.5 * H;
    }
    p.squash = 0.06;
    p.shadow = 0;
    // Head first into the water: what's gone in is seen through it.
    p.clipY = POOL.water + 0.004;
    p.under = UNDER_FADE;
    return { pose: p, wake: null, x: s.x, finished: false, under: false };
  }
  const front = pos.x;
  const finished = s.finished;
  // Under water: the glide after the entry and the push-off (it surfaces as the stroke takes over).
  const surface = (t0: number) => smooth(t0 + 0.4, t0 + 1.1, t);
  let up = surface(tr.entry);
  if (tr.turn != null && t >= tr.turn) up = Math.min(up, tr.pushOff != null ? surface(tr.pushOff) : 1);
  const turning = tr.turn != null && tr.pushOff != null && t >= tr.turn - 0.25 && t < tr.pushOff + 0.1;
  const v = s.v;
  const ph = time * pl.rate;
  let p: ActorPose;
  if (finished) {
    // Treading water at the wall, head and shoulders up; the winner's arms in the air.
    const u = t - tr.finish;
    const wallX = poolX(tr.distance).x;
    p = idleActor(a, d, wallX - dir * W * 0.35, z, -dir, 0, time, pl.run.lane);
    p.y = -Math.max(0.62, pl.sink) * H + 0.04 * Math.min(H, 2) * Math.sin(time * 2.2 + pl.run.lane);
    p.lean = -0.1;
    p.clipY = POOL.water + 0.004;
    p.under = UNDER_FADE;
    p.shadow = 0;
    if (pl.run.place === 1 && a.arms) p.raise = smooth(0.4, 1, u);
    return { pose: p, wake: { x: wallX, z, v: 0.3 * Math.exp(-u), len: pl.len, dir }, x: s.x, finished, under: false };
  }
  const depth = (1 - up) * 0.6 + (turning ? 0.3 : 0);
  if (pl.stroke === "crawl") {
    // Front crawl: lying along the lane head first, arms windmilling, legs fluttering.
    p = idleActor(a, d, front - dir * H * 0.5, z, dir, 0, time, pl.run.lane);
    p.roll = -Math.PI / 2;
    p.pivot = 0.5;
    p.y = -0.5 * H - 0.18 * W - depth;
    // The arms half a stroke apart, each pulling slowly through the water (the first 60% of its cycle) and
    // recovering quickly over it; the body rolls towards the pulling arm and the head rides a little higher
    // as each arm catches; the legs flutter six beats to a stroke, one up as the other goes down.
    const arm = (u: number) => { const f = u - Math.floor(u); return f < 0.6 ? Math.PI * (f / 0.6) : Math.PI * (1 + (f - 0.6) / 0.4); };
    p.arms = { a: arm(ph), a2: arm(ph + 0.5), b: 0.25 + 0.35 * bump(0.55, 1, ph - Math.floor(ph)), k: up };
    const kick = 0.32 * Math.sin(ph * Math.PI * 6);
    p.legs = { a: 0, a2: 0, split: kick, b: 0.12 + 0.18 * Math.max(0, Math.sin(ph * Math.PI * 6)), k: 1 };
    p.sway = 0.5 * Math.sin(ph * Math.PI * 2) * up;
    p.y += 0.035 * Math.min(2, H) * Math.cos(ph * Math.PI * 4) * up;
  } else if (pl.stroke === "fish" || pl.stroke === "serpent") {
    // Its body wave carries it: low in the water, the back and fin showing.
    p = idleActor(a, d, front - dir * W * 0.5, z, dir, 0, time, pl.run.lane);
    p.y = -pl.sink * H - depth;
    // The wave grows with the effort (speed) and drives a gentle rise and dip of the back, nose leading.
    const effort = 0.75 + 0.25 * smooth(0.3, 2.5, v);
    const beat = ph * Math.PI * 2 * 1.6;
    p.swim = { amp: (pl.stroke === "fish" ? 0.075 : 0.1) * effort, waves: pl.stroke === "fish" ? 0.8 : 1.6, phase: beat, style: pl.stroke === "fish" ? 1 : 2 };
    p.y += 0.03 * Math.min(2, H) * Math.sin(beat) * up;
    p.lean = 0.05 * Math.cos(beat) * up;
  } else {
    // A paddle: upright, head up, legs churning under the water.
    p = idleActor(a, d, front - dir * W * 0.5, z, dir, 0, time, pl.run.lane);
    p.y = -pl.sink * H - depth;
    // Each paddle a push: the head and shoulders surge forward and up with it, then settle.
    const push = ph * 1.6;
    p.lean = 0.25 + 0.07 * Math.sin(push * Math.PI * 4);
    p.gait = { motion: a.entrant.motion, phase: push, v: 2 };
    if (a.arms) p.arms = { a: 0.9 + 0.7 * Math.sin(push * Math.PI * 2), a2: 0.9 - 0.7 * Math.sin(push * Math.PI * 2), b: -0.5, k: up };
    p.y += 0.04 * Math.min(2, H) * Math.abs(Math.sin(push * Math.PI * 2));
    p.sway = 0.08 * Math.sin(push * Math.PI * 2);
  }
  if (turning) {
    // The flip turn: a somersault at the wall and back the other way.
    const k = smooth(tr.turn! - 0.25, tr.pushOff!, t);
    p.roll = (p.roll ?? 0) - Math.PI * 2 * k;
  }
  p.y += bump(0, 1, (t - tr.entry) / 0.6) * -0.2;
  p.clipY = POOL.water + 0.004;
  p.under = UNDER_FADE;
  p.shadow = 0;
  return { pose: p, wake: { x: front, z, v: Math.max(0, v) * (0.35 + 0.65 * up), len: pl.len, dir }, x: s.x, finished, under: up < 0.5 };
}
