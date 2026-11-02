import { motionAt } from "./model";
import type { Race, RaceLane } from "./race";

/**
 * The broadcast: what the director shows when, like a night-time 100 m
 * final on TV. Pure and unit-tested (tests/race-broadcast.test.ts).
 *
 * A show is a list of shots on the show clock (seconds from the start of
 * the broadcast), each tied to the race clock (seconds from the gun) by a
 * start and a rate: 1 live, below 1 for the slow-motion replay, far above
 * 1 when the broadcast fast-forwards a slow field. Before the gun the race
 * clock stands still and the runners wait on their marks.
 *
 * - The crane establishing shot over the stadium.
 * - Lane by lane: each runner's name banner and base Speed.
 * - "On your marks…", "Set…", then the gun.
 * - The race, cut by the leader's progress: the rail camera side-on (100 m)
 *   or the infield camera round the bend (200 m, 400 m), the high wide shot
 *   down the back straight (400 m), the head-on telephoto from beyond the
 *   line, then the finish-line camera.
 * - A slow field is fast-forwarded (with the speed-up on screen), live
 *   again for the finish; stragglers are fast-forwarded to the line too.
 * - The slow-motion replay of the finish, the photo-finish image, then the
 *   results.
 */

export type Camera = "crane" | "intro" | "marks" | "rail" | "bend" | "wide" | "headon" | "line" | "winner" | "chase" | "replay" | "results";
export type Phase = "crane" | "intro" | "marks" | "set" | "race" | "fast" | "replay" | "photo" | "results";

export interface Shot {
  phase: Phase;
  camera: Camera;
  /** Show-clock span (s). */
  t0: number;
  t1: number;
  /** Race clock at t0 and its rate (race seconds per show second). */
  race0: number;
  rate: number;
  /** The lane in focus (lane intros, the chase of a straggler). */
  lane?: number;
}

export interface ShowPlan {
  shots: Shot[];
  /** Show time of the gun. */
  gun: number;
  /** Show time when the results come up (the end of the plan). */
  end: number;
  /** Race-clock window of the replay and the photo finish. */
  replay: { from: number; to: number };
}

export interface ShowOptions {
  /** The video's tighter timings. */
  video?: boolean;
  /** Skip the crane and lane intros (a replayed race, or the viewer skipped them). */
  quick?: boolean;
}

/** When the leader first reaches `d` metres (s after the gun). */
export function leaderReaches(race: Race, d: number): number {
  let best = Infinity;
  for (const r of race.lanes) best = Math.min(best, reachTime(r, d));
  return best;
}

/** When one runner reaches `d` metres. */
export function reachTime(r: RaceLane, d: number): number {
  if (d >= r.profile.distance) return r.time;
  if (d <= 0) return 0;
  let lo = 0, hi = r.time;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (motionAt(r.profile, mid).x >= d) hi = mid; else lo = mid;
  }
  return hi;
}

/** Leader-progress cuts per distance: [camera, until the leader reaches this share of the distance]. */
const CUTS: Record<number, [Camera, number][]> = {
  100: [["rail", 0.46], ["headon", 0.86], ["line", 1]],
  200: [["bend", 0.5], ["headon", 0.86], ["line", 1]],
  400: [["bend", 0.25], ["wide", 0.5], ["bend", 0.75], ["headon", 0.9], ["line", 1]],
};

const MIN_SHOT = 1.1;

export function planShow(race: Race, opts: ShowOptions = {}): ShowPlan {
  const v = !!opts.video;
  const n = race.lanes.length;
  const shots: Shot[] = [];
  let t = 0;
  const hold = (phase: Phase, camera: Camera, dur: number, lane?: number) => {
    shots.push({ phase, camera, t0: t, t1: t + dur, race0: 0, rate: 0, ...(lane != null ? { lane } : {}) });
    t += dur;
  };
  if (!opts.quick) {
    hold("crane", "crane", v ? 2.6 : 4.2);
    const each = v ? (n > 4 ? 0.62 : 1.0) : n > 4 ? 1.15 : 2.0;
    for (const r of race.lanes) hold("intro", "intro", each, r.lane);
  }
  hold("marks", "marks", v ? 1.1 : 1.9);
  hold("set", "marks", v ? 0.8 : 1.2);
  const gun = t;
  const T1 = race.first, Tn = race.last;
  // Live race: cut by the leader's progress; a long race is fast-forwarded in the middle.
  const live = (camera: Camera, from: number, to: number, lane?: number) => {
    if (to - from <= 1e-6) return;
    shots.push({ phase: "race", camera, t0: t, t1: t + (to - from), race0: from, rate: 1, ...(lane != null ? { lane } : {}) });
    t += to - from;
  };
  const fast = (camera: Camera, from: number, to: number, dur: number, lane?: number) => {
    if (to - from <= 1e-6) return;
    shots.push({ phase: "fast", camera, t0: t, t1: t + dur, race0: from, rate: (to - from) / dur, ...(lane != null ? { lane } : {}) });
    t += dur;
  };
  const cuts = CUTS[race.distance] ?? CUTS[100];
  const finishCam: Camera = "line";
  const LIVE_MAX = v ? 9 : 14;
  if (T1 <= LIVE_MAX) {
    // All live: cut at the leader's marks (each shot at least MIN_SHOT long).
    let from = 0;
    cuts.forEach(([cam, share], k) => {
      const last = k === cuts.length - 1;
      let to = last ? T1 + (v ? 0.9 : 1.4) : leaderReaches(race, share * race.distance);
      if (!last) to = Math.max(to, from + MIN_SHOT);
      if (!last && to > T1 - MIN_SHOT) to = Math.max(from, T1 - MIN_SHOT);
      live(cam, from, to);
      from = Math.max(from, to);
    });
  } else {
    // The start live, the middle fast-forwarded, the finish live.
    const startLive = v ? 2.2 : 3.4;
    const endLive = v ? 2.4 : 3.2;
    live(cuts[0][0], 0, startLive);
    fast("chase", startLive, T1 - endLive, v ? 3.2 : 5.5, race.order[0].lane);
    live("headon", T1 - endLive, T1 - Math.min(1.2, endLive / 2));
    live(finishCam, T1 - Math.min(1.2, endLive / 2), T1 + (v ? 0.9 : 1.4));
  }
  // Stragglers: fast-forward the rest of the field to the line, live for the last one in.
  const after = T1 + (v ? 0.9 : 1.4);
  if (Tn - after > (v ? 2.5 : 4)) {
    const lastLane = race.order[race.order.length - 1].lane;
    fast("chase", after, Tn - 0.9, v ? 2.6 : 4.5, lastLane);
    live("line", Tn - 0.9, Tn + 0.8);
  } else if (Tn + 0.6 > after) {
    live("line", after, Tn + 0.6);
  }
  // Slow-motion replay of the winner's finish (and a close second).
  const second = race.order[1];
  const close = second && second.time - T1 < 0.6;
  const from = T1 - (v ? 0.9 : 1.3);
  const to = close ? second.time + 0.35 : T1 + 0.45;
  const replayRate = v ? 0.4 : 0.3;
  shots.push({ phase: "replay", camera: "replay", t0: t, t1: t + (to - from) / replayRate, race0: from, rate: replayRate });
  t += (to - from) / replayRate;
  // The photo finish, then the results (the race clock stands at the end).
  const rest = Math.max(Tn + 3, T1 + 3);
  shots.push({ phase: "photo", camera: "line", t0: t, t1: t + (v ? 2.6 : 4), race0: rest, rate: 0 });
  t += v ? 2.6 : 4;
  shots.push({ phase: "results", camera: "results", t0: t, t1: t + (v ? 3.2 : 6), race0: rest, rate: 0 });
  t += v ? 3.2 : 6;
  return { shots, gun, end: t, replay: { from, to } };
}

/** The shot on screen at show time t (the last one holds). */
export function shotAt(plan: ShowPlan, t: number): Shot {
  for (const s of plan.shots) if (t < s.t1) return s;
  return plan.shots[plan.shots.length - 1];
}

/** The race clock at show time t. */
export function raceTimeAt(plan: ShowPlan, t: number): number {
  const s = shotAt(plan, t);
  if (s.rate === 0) return s.phase === "photo" || s.phase === "results" ? s.race0 : 0;
  return s.race0 + (Math.min(t, s.t1) - s.t0) * s.rate;
}

/** Progress through the current shot, 0..1. */
export function shotProgress(s: Shot, t: number): number {
  return Math.max(0, Math.min(1, (t - s.t0) / Math.max(1e-6, s.t1 - s.t0)));
}

/** How worked up the crowd is (0 calm … 1 the finish): it hushes for the start, builds through the race and erupts at the line. */
export function excitementAt(plan: ShowPlan, race: Race, t: number): number {
  const s = shotAt(plan, t);
  const k = shotProgress(s, t);
  switch (s.phase) {
    case "crane":
      return 0.42;
    case "intro":
      // A cheer for each runner as it's introduced.
      return 0.38 + 0.32 * Math.exp(-k * 3);
    case "marks":
      return 0.12;
    case "set":
      return 0.04;
    case "race":
    case "fast": {
      const rt = raceTimeAt(plan, t);
      const since = rt - race.first;
      if (since >= 0) return Math.max(0.68, 1 - since * 0.05);
      let lead = 0;
      for (const r of race.lanes) lead = Math.max(lead, motionAt(r.profile, rt).x);
      const share = Math.min(1, lead / race.distance);
      return 0.42 + 0.55 * share * share;
    }
    case "replay":
      return 0.6;
    case "photo":
      return 0.62;
    case "results":
      return 0.72;
  }
}

/** The race-time window the photo-finish image covers: the winner and whoever is close behind (up to the fourth). */
export function photoWindow(race: Race): { from: number; to: number } {
  const T1 = race.first;
  const k = Math.min(3, race.order.length - 1);
  const span = Math.max(0.3, Math.min(1.0, race.order[k].time - T1));
  return { from: T1 - 0.22 * span - 0.04, to: T1 + span + 0.08 };
}
