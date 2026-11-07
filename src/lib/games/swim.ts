import { has, TRAIT, type Athlete } from "./athlete";
import { SWIM, spring } from "./constants";
import { formFactor, normal, rngFor } from "./seed";
import { officialTime, photoTime } from "./sprint";

/**
 * Swimming: the 50 m and 100 m freestyle in a 50 m pool, eight lanes.
 * Pure and unit-tested.
 *
 * - Water speed = 2.2 m/s × (Speed/100)^0.6 × an aquatic factor, from real
 *   data: Water types and the Water 1/2/3 egg groups 1.0; everyone else
 *   0.55; Fire, Rock and Ground types 0.4 (they sink or hate water); a fish-
 *   or fin-shaped body (the fish shape, or the Water 2 "fish" egg group)
 *   × 1.15. Swift Swim doubles Speed (its real effect) only with the rain
 *   toggle on. Every factor is listed in "How it works".
 * - The start: a reaction of 0.6–0.78 s from Speed (seeded), a dive whose
 *   speed comes from leg power (Atk, and less spring for heavy bodies), the
 *   body entering the water about one body length out, then an underwater
 *   glide relaxing to swimming speed.
 * - Stamina, as on the track: after 25 m the pace fades towards 80% of it
 *   over 40 m × (HP/100)^0.8, so a big HP holds its speed.
 * - The turn at 50 m: a flip turn (about 0.6 s, longer for big bodies) and
 *   a push-off whose speed comes from Atk, the body stretched out from the
 *   wall.
 * - Day-to-day form: speed × a seeded factor within ±1.5%. Touch times to
 *   1/100 s, ties split at 1/1000 s.
 * Anchor: the reference, an elite human swimmer (aquatic factor 1), swims
 * 100 m in about 47 s and 50 m in about 21.3 s.
 */

export const SWIM_EVENTS = { "50m-freestyle": 50, "100m-freestyle": 100 } as const;
export type SwimEvent = keyof typeof SWIM_EVENTS;

export interface AquaticPart {
  label: string;
  k: number;
}

const SINKERS = ["fire", "rock", "ground"];

/** The aquatic factor, with each part of it for "How it works". */
export function aquatic(a: Athlete): { factor: number; parts: AquaticPart[] } {
  const parts: AquaticPart[] = [];
  let base: number;
  if (a.types.includes("water")) { base = SWIM.water; parts.push({ label: "Water type", k: SWIM.water }); }
  else if (has(a, TRAIT.waterEgg)) { base = SWIM.water; parts.push({ label: "Water egg group", k: SWIM.water }); }
  else if (a.types.some((t) => SINKERS.includes(t))) {
    base = SWIM.sinkers;
    parts.push({ label: `${a.types.filter((t) => SINKERS.includes(t)).map((t) => t[0].toUpperCase() + t.slice(1)).join("/")} type: sinks or hates water`, k: SWIM.sinkers });
  } else { base = SWIM.other; parts.push({ label: "Not a water Pokémon", k: SWIM.other }); }
  let factor = base;
  if (a.shape === "fish" || has(a, TRAIT.finEgg)) { factor *= SWIM.fin; parts.push({ label: a.shape === "fish" ? "Fish-shaped body" : "Fin (Water 2 egg group)", k: SWIM.fin }); }
  return { factor, parts };
}

/** Speed after Swift Swim: doubled in rain. */
export const swimSpe = (a: Athlete, rain: boolean) => a.stats.spe * (rain && has(a, TRAIT.swiftSwim) ? SWIM.swiftSwim : 1);

/** Free-swimming speed (m/s), before stamina. */
export const swimSpeed = (a: Athlete, rain = false) => SWIM.vRef * Math.pow(Math.max(0, swimSpe(a, rain)) / 100, SWIM.speedExp) * aquatic(a).factor;

const legs = (a: Athlete) => Math.sqrt(Math.max(0, a.stats.atk) / 100) * spring(a.kg);

export const meanSwimReaction = (spe: number) => SWIM.reactionFast + (SWIM.reactionSlow - SWIM.reactionFast) * Math.exp(-Math.max(0, spe) / 60);

export interface SwimTrace {
  distance: number;
  /** Seconds per sample. */
  step: number;
  /** The front's distance along the race (m) and speed (m/s), every step from the start signal. */
  x: Float32Array;
  v: Float32Array;
  reaction: number;
  /** Leaves the block, hits the water, touches at the turn, pushes off, touches the finish (s). */
  dive: number;
  entry: number;
  turn: number | null;
  pushOff: number | null;
  finish: number;
  /** 50 m split (s), for the 100. */
  split: number | null;
  vSwim: number;
  vDive: number;
  vPush: number;
  /** Where the body enters the water (m from the wall) and how long the turn takes (s). */
  entryAt: number;
  turnTime: number;
}

/** One swim, integrated every 10 ms. */
export function simulateSwim(a: Athlete, distance: 50 | 100, o: { form?: number; reaction?: number; rain?: boolean } = {}): SwimTrace {
  const form = o.form ?? 1;
  const reaction = o.reaction ?? meanSwimReaction(swimSpe(a, !!o.rain));
  const vSwim = swimSpeed(a, !!o.rain) * form;
  const vDive = SWIM.vDive * legs(a) * form;
  const vPush = SWIM.vPush * legs(a) * form;
  const L = a.length;
  const fall = SWIM.block + 0.5 * a.height;
  const tFlight = Math.sqrt((2 * fall) / 9.81);
  const entryAt = SWIM.reach * L + vDive * tFlight;
  const turnTime = SWIM.turn * Math.sqrt(Math.max(0.2, L) / 1.8);
  const E = SWIM.fadeRef * Math.pow(Math.max(1, a.stats.hp) / 100, 0.8);
  const ceiling = (x: number) => (x <= SWIM.fadeOnset ? vSwim : vSwim * (SWIM.fadeFloor + (1 - SWIM.fadeFloor) * Math.exp(-(x - SWIM.fadeOnset) / E)));
  const step = 0.01;
  const xs: number[] = [], vs: number[] = [];
  let t = 0, x = 0, v = 0;
  let mode: "block" | "flight" | "water" | "turn" = "block";
  let entry = Infinity, turn: number | null = null, pushOff: number | null = null, split: number | null = null, finish = Infinity;
  const dive = reaction;
  for (let i = 0; i < 400000; i++) {
    xs.push(x);
    vs.push(v);
    if (x >= distance) { finish = t; break; }
    const t1 = t + step;
    if (mode === "block") {
      if (t1 >= dive) { mode = "flight"; }
    } else if (mode === "flight") {
      const k = Math.min(1, (t1 - dive) / tFlight);
      x = entryAt * k;
      v = entryAt / tFlight;
      if (k >= 1) { mode = "water"; entry = t1; v = vDive; }
    } else if (mode === "water") {
      // dv/dt = (ceiling − v)/τ, with RK2.
      const x0 = x;
      const a1 = (ceiling(x) - v) / SWIM.glide;
      const vm = v + a1 * step * 0.5;
      const a2 = (ceiling(x + vm * step * 0.5) - vm) / SWIM.glide;
      x += (v + a1 * step * 0.5) * step;
      v += a2 * step;
      if (distance === 100 && turn == null && x >= SWIM.pool) {
        // The touch at the wall (the split), then the flip turn.
        turn = t + step * Math.min(1, Math.max(0, (SWIM.pool - x0) / Math.max(1e-9, x - x0)));
        split = turn;
        x = SWIM.pool;
        mode = "turn";
      }
    } else if (mode === "turn") {
      if (turn != null && t1 >= turn + turnTime) {
        pushOff = turn + turnTime;
        // Feet on the wall, the body stretched out from it.
        x = SWIM.pool + SWIM.reach * L;
        v = Math.max(vPush, v * 0.4);
        mode = "water";
      }
    }
    if (x >= distance && !Number.isFinite(finish)) {
      // Interpolate the touch inside the step.
      const x0 = xs[xs.length - 1];
      finish = t + step * Math.min(1, Math.max(0, (distance - x0) / Math.max(1e-9, x - x0)));
      xs.push(Math.min(x, distance + v * step));
      vs.push(v);
      break;
    }
    t = t1;
  }
  return { distance, step, x: new Float32Array(xs), v: new Float32Array(vs), reaction, dive, entry, turn, pushOff, finish, split, vSwim, vDive, vPush, entryAt, turnTime };
}

/** Where a swimmer's front is at time t (s from the start signal). */
export function swimAt(s: SwimTrace, t: number): { x: number; v: number; finished: boolean } {
  if (t <= 0) return { x: 0, v: 0, finished: false };
  if (t >= s.finish) {
    // Glides on into the wall's touchpad and stops.
    return { x: s.distance, v: 0, finished: true };
  }
  const f = t / s.step;
  const i = Math.min(s.x.length - 2, Math.floor(f));
  const u = Math.min(1, Math.max(0, f - i));
  return { x: s.x[i] + (s.x[i + 1] - s.x[i]) * u, v: s.v[i] + (s.v[i + 1] - s.v[i]) * u, finished: false };
}

/** The neutral mark for the records (s, exact). */
export const swimMark = (a: Athlete, event: SwimEvent, rain = false) => simulateSwim(a, SWIM_EVENTS[event], { rain }).finish;

/** Swimming's final lane order: the fastest in lane 4, then 5, 3, 6, 2, 7, 1, 8 (World Aquatics SW 3.1.1). */
export const SWIM_LANES = [4, 5, 3, 6, 2, 7, 1, 8];

export interface SwimRun {
  athlete: Athlete;
  lane: number;
  form: number;
  trace: SwimTrace;
  raw: number;
  time: number;
  photo: number;
  place: number;
}

export interface SwimRace {
  event: SwimEvent;
  distance: 50 | 100;
  rain: boolean;
  runs: SwimRun[];
  order: SwimRun[];
}

export function runSwim(athletes: Athlete[], event: SwimEvent, seed: number, rain = false, round = "final"): SwimRace {
  const distance = SWIM_EVENTS[event];
  const seeds = [...athletes].sort((a, b) => swimMark(a, event, rain) - swimMark(b, event, rain) || a.key.localeCompare(b.key));
  const runs: SwimRun[] = athletes.map((a) => {
    const rnd = rngFor(seed, event, round, a.key);
    const form = formFactor(rnd);
    const reaction = meanSwimReaction(swimSpe(a, rain)) + SWIM.reactionSpread * normal(rnd);
    const trace = simulateSwim(a, distance, { form, reaction, rain });
    return { athlete: a, lane: SWIM_LANES[seeds.indexOf(a)] ?? seeds.indexOf(a) + 1, form, trace, raw: trace.finish, time: officialTime(trace.finish), photo: photoTime(trace.finish), place: 0 };
  });
  const order = [...runs].sort((a, b) => a.photo - b.photo || a.lane - b.lane);
  order.forEach((r, k) => { r.place = k > 0 && Math.abs(r.photo - order[k - 1].photo) < 1e-9 ? order[k - 1].place : k + 1; });
  return { event, distance, rain, runs, order };
}
