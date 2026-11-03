import type { Spot } from "./director";
import { cycleRate, hipHeight } from "./gait";
import { finishTime, motionAt, profileFor, runnerFor, type MotionState, type Profile, type Runner } from "./model";
import { lanePoint, LANES, type Distance, type TrackPoint } from "./track";
import { figureSize, type Entrant } from "./types";

/**
 * A race: the entrants in their lanes, each runner's whole race sampled
 * for drawing, and the result. Pure and unit-tested.
 *
 * Lanes follow World Athletics' draw for finals (the four best seeds in
 * lanes 3–6, the next two in 7–8, the last two in 1–2), seeded by the
 * model's finish times, so the closest battles run side by side in the
 * middle of the track. Small fields with a figure wider than a lane are
 * spread out so neighbours don't overlap.
 */

export const MIN_RUNNERS = 2;
export const MAX_RUNNERS = LANES;

/** Seed → lane for a full final. */
const FINAL_LANES = [4, 5, 3, 6, 7, 2, 8, 1];
const SPREAD: Record<number, number[]> = { 2: [3, 6], 3: [2, 5, 7], 4: [2, 4, 6, 8] };

export interface RaceLane {
  entrant: Entrant;
  lane: number;
  runner: Runner;
  profile: Profile;
  /** Figure size (m) and hip height (m). */
  w: number;
  h: number;
  hip: number;
  /** Finish time (s). */
  time: number;
  /** 1-based; Pokémon with identical times share a place. */
  place: number;
  /** Seconds behind the winner. */
  gap: number;
}

export interface Race {
  distance: Distance;
  /** In lane order, inside to outside. */
  lanes: RaceLane[];
  /** By finish time. */
  order: RaceLane[];
  first: number;
  last: number;
}

/** Lanes for entrants given in seed order (fastest first). */
export function laneOrder(n: number, wide: boolean): number[] {
  if (wide && SPREAD[n]) {
    const spread = SPREAD[n];
    // The best seeds take the most central of the spread lanes.
    return [...spread].sort((a, b) => Math.abs(a - 4.5) - Math.abs(b - 4.5) || a - b);
  }
  return FINAL_LANES.slice(0, n);
}

/** Seeds the field by predicted time and draws the lanes. */
export function assignLanes(entrants: Entrant[], distance: Distance): number[] {
  const times = entrants.map((e) => finishTime(runnerFor(e.stats, e.kg), distance));
  const seeds = entrants.map((_, i) => i).sort((a, b) => times[a] - times[b] || a - b);
  const wide = entrants.some((e) => figureSize(e).w > 2.2);
  const lanes = laneOrder(entrants.length, wide);
  const out = new Array<number>(entrants.length);
  seeds.forEach((ei, k) => { out[ei] = lanes[k]; });
  return out;
}

export function makeRace(entrants: Entrant[], distance: Distance, lanes = assignLanes(entrants, distance)): Race {
  if (entrants.length < 1 || entrants.length > MAX_RUNNERS) throw new Error(`a race needs 1 to ${MAX_RUNNERS} runners`);
  const rows: RaceLane[] = entrants.map((entrant, i) => {
    const runner = runnerFor(entrant.stats, entrant.kg);
    const { w, h } = figureSize(entrant);
    const hip = hipHeight(h, entrant.shape);
    const profile = profileFor(runner, distance, (v) => cycleRate(entrant.motion, v, hip, entrant.kg));
    return { entrant, lane: lanes[i], runner, profile, w, h, hip, time: profile.finish, place: 0, gap: 0 };
  });
  const order = [...rows].sort((a, b) => a.time - b.time || a.lane - b.lane);
  const first = order[0].time;
  order.forEach((r, k) => {
    r.place = k > 0 && Math.abs(r.time - order[k - 1].time) < 1e-9 ? order[k - 1].place : k + 1;
    r.gap = r.time - first;
  });
  return { distance, lanes: [...rows].sort((a, b) => a.lane - b.lane), order, first, last: order[order.length - 1].time };
}

export interface RunnerState extends MotionState {
  point: TrackPoint;
}

/** Where a runner is (on the track) and how it moves, at race time t. */
export function runnerAt(race: Race, r: RaceLane, t: number): RunnerState {
  const m = motionAt(r.profile, t);
  return { ...m, point: lanePoint(r.lane, race.distance, m.x) };
}

/** The runner furthest down the track at time t (by race distance covered). */
export function leaderAt(race: Race, t: number): RaceLane {
  let best = race.lanes[0], bx = -Infinity;
  for (const r of race.lanes) {
    const x = motionAt(r.profile, t).x - (r.time === race.first ? 1e-9 : 0);
    if (x > bx) { bx = x; best = r; }
  }
  return best;
}

/** Race clock text: "9.58", "1:02.37". */
export function formatTime(s: number, dp = 2): string {
  if (!Number.isFinite(s)) return "—";
  const neg = s < 0;
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const rest = a - m * 60;
  const txt = m > 0 ? `${m}:${rest.toFixed(dp).padStart(dp + 3, "0")}` : rest.toFixed(dp);
  return neg ? `-${txt}` : txt;
}

/** "+0.23", "+1:12.40". */
export const formatGap = (s: number) => (s <= 0 ? "" : `+${formatTime(s)}`);

/** Times that round to the same hundredth are shown to the thousandth (a photo finish). */
export function displayTimes(race: Race): Map<RaceLane, string> {
  const out = new Map<RaceLane, string>();
  for (const r of race.order) {
    const clash = race.order.some((o) => o !== r && formatTime(o.time) === formatTime(r.time) && Math.abs(o.time - r.time) > 1e-9);
    out.set(r, formatTime(r.time, clash ? 3 : 2));
  }
  return out;
}

/** km/h from m/s. */
export const kmh = (v: number) => v * 3.6;

/** The director's view of every runner at race time t (see lib/race/director). */
export function spotsAt(race: Race, t: number): Spot[] {
  return race.lanes.map((r) => {
    const m = motionAt(r.profile, t);
    const p = lanePoint(r.lane, race.distance, m.x);
    return { lane: r.lane, x: p.x, y: 0, z: p.z, dx: p.dx, dz: p.dz, s: m.x, v: m.v, w: r.w, h: r.h };
  });
}
