import { finishTime, motionAt, profileFor, runnerFor, type Profile } from "@/lib/race/model";
import { cycleRate, hipHeight } from "@/lib/race/gait";
import { assignLanes, type Race, type RaceLane } from "@/lib/race/race";
import { bigPoolFor } from "@/lib/race/pool";
import { knockout, type Round } from "@/lib/race/tournament";
import type { Distance } from "@/lib/race/track";
import { figureSize } from "@/lib/race/types";
import type { Athlete } from "./athlete";
import { SPRINT, TIMING } from "./constants";
import { formFactor, normal, rngFor } from "./seed";

/**
 * The 100 m, 200 m and 400 m: the Pokémon Race's model (lib/race/model,
 * unchanged: the Furusawa–Hill sprint curve, τ from weight and Attack, the
 * fade after 150 m from HP, integrated with RK4) on the Race's 400 m track
 * (lib/race/track, staggered starts), with heats and a final from the
 * Race's knockout (lib/race/tournament). New for the Games, all pure and
 * unit-tested:
 *
 * - A reaction to the gun, 0.12–0.20 s from Speed (seeded): 0.12 + 0.08 ×
 *   e^(−Speed/60) with a small day-to-day spread. Under 0.100 s is a false
 *   start (World Athletics TR 16.6) and the athlete is disqualified; it is
 *   honest and rare.
 * - Day-to-day form: top speed × a seeded factor within ±1.5%.
 * - A dip at the line: an upright sprinter's torso crosses 12% of its
 *   height ahead of its hips.
 * - Times are read to 1/100 s, rounded up; a tie at 1/100 is split by the
 *   photo finish at 1/1000 s (World Athletics TR 19.24). A tie there too is
 *   a dead heat.
 */

export const SPRINT_EVENTS = { "100m": 100, "200m": 200, "400m": 400 } as const;
export type SprintEvent = keyof typeof SPRINT_EVENTS;

/** Mean reaction (s) for a base Speed: 0.20 s at 0, 0.135 s at 100, 0.123 s at 200. */
export const meanReaction = (spe: number) => SPRINT.reactionFast + (SPRINT.reactionSlow - SPRINT.reactionFast) * Math.exp(-Math.max(0, spe) / SPRINT.reactionScale);

/** How far ahead of the hips the torso dips at the line (m): upright sprinters only. */
export const dipOf = (a: Athlete) => (a.entrant.motion === "run" && a.body === "biped" ? SPRINT.dip * a.height : 0);

/** Times as the clock reads them: up to the next 1/100 s. */
export const officialTime = (t: number) => Math.ceil(t / TIMING.official - 1e-7) * TIMING.official;
/** The photo finish's reading: up to the next 1/1000 s. */
export const photoTime = (t: number) => Math.ceil(t / TIMING.photo - 1e-7) * TIMING.photo;

export interface SprintRun {
  athlete: Athlete;
  lane: number;
  reaction: number;
  form: number;
  falseStart: boolean;
  /** From the gun to the torso crossing the line (s), exact. */
  raw: number;
  /** 1/100 s, rounded up. */
  time: number;
  /** 1/1000 s, rounded up. */
  photo: number;
  /** Shown to 1/1000 s (it shares its 1/100 reading with another runner). */
  photoNeeded: boolean;
  place: number;
  dq: boolean;
}

export interface SprintRace {
  distance: Distance;
  runs: SprintRun[];
  /** By finish (disqualified last). */
  order: SprintRun[];
  /** The race as the Race's scene and broadcast draw it (no disqualified runner in it). */
  race: Race;
  /** A false start before this race: the restart is drawn above; this is the start that was recalled. */
  falseStart: { key: string; reaction: number; race: Race } | null;
}

/** A profile that waits `delay` seconds on the line before it starts (the reaction). */
export function delayedProfile(p: Profile, delay: number): Profile {
  if (!(delay > 0) || !Number.isFinite(p.finish)) return p;
  const T = p.finish + delay;
  const n = Math.max(2, Math.ceil(T / p.step) + 2);
  const x = new Float64Array(n), v = new Float64Array(n), phase = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = motionAt(p, i * p.step - delay);
    x[i] = m.x;
    v[i] = m.v;
    phase[i] = m.phase;
  }
  return { ...p, finish: T, x, v, phase };
}

/** Day-to-day draws for one runner in one round. */
export function sprintDraw(a: Athlete, seed: number, event: string, round: string): { reaction: number; form: number } {
  const rnd = rngFor(seed, event, round, a.key);
  const form = formFactor(rnd);
  const reaction = meanReaction(a.stats.spe) + SPRINT.reactionSpread * normal(rnd);
  return { reaction, form };
}

interface Built { lane: RaceLane; run: SprintRun }

function buildLane(a: Athlete, lane: number, distance: Distance, reaction: number, form: number): Built {
  const e = a.entrant;
  const base = runnerFor(e.stats, e.kg);
  const runner = { ...base, vmax: base.vmax * form };
  const { w, h } = figureSize(e);
  const hip = hipHeight(h, e.shape);
  const dip = Math.min(dipOf(a), distance * 0.01);
  const fresh = profileFor(runner, distance - dip, (v) => cycleRate(e.motion, v, hip, e.kg, Math.max(w, h)));
  const r = Math.max(0, reaction);
  const profile = delayedProfile(fresh, r);
  const raw = profile.finish;
  const run: SprintRun = { athlete: a, lane, reaction, form, falseStart: reaction < SPRINT.falseStart, raw, time: officialTime(raw), photo: photoTime(raw), photoNeeded: false, place: 0, dq: false };
  return { lane: { entrant: e, lane, runner, profile, w, h, hip, time: raw, place: 0, gap: 0 }, run };
}

function raceOf(rows: Built[], distance: Distance): Race {
  const lanes = rows.map((r) => r.lane);
  const order = [...lanes].sort((a, b) => a.time - b.time || a.lane - b.lane);
  const first = order[0].time;
  order.forEach((r, k) => {
    r.place = k > 0 && Math.abs(r.time - order[k - 1].time) < 1e-9 ? order[k - 1].place : k + 1;
    r.gap = r.time - first;
  });
  const bigPool = bigPoolFor(lanes.filter((r) => r.entrant.motion === "swim").map((r) => ({ lane: r.lane, w: r.w, h: r.h })), distance);
  return { distance, lanes: [...lanes].sort((a, b) => a.lane - b.lane), order, first, last: order[order.length - 1].time, bigPool };
}

/** Places by the photo finish (ties at 1/1000 share a place); disqualified runners last, unplaced. */
export function placeRuns(runs: SprintRun[]): SprintRun[] {
  const ok = runs.filter((r) => !r.dq).sort((a, b) => a.photo - b.photo || a.lane - b.lane);
  ok.forEach((r, k) => {
    r.place = k > 0 && Math.abs(r.photo - ok[k - 1].photo) < 1e-9 ? ok[k - 1].place : k + 1;
    r.photoNeeded = ok.some((o) => o !== r && Math.abs(o.time - r.time) < 1e-9);
  });
  const out = runs.filter((r) => r.dq);
  out.forEach((r) => { r.place = 0; });
  return [...ok, ...out];
}

/**
 * One race (a final, or a heat) of up to eight. Lanes follow the Race's
 * draw for finals (seeded by predicted time). A false start disqualifies
 * the runner; the rest go again with fresh reactions.
 */
export function runSprint(athletes: Athlete[], event: SprintEvent, seed: number, round = "final"): SprintRace {
  if (athletes.length < 1 || athletes.length > 8) throw new Error("a race needs 1 to 8 runners");
  const distance = SPRINT_EVENTS[event] as Distance;
  const laneOf = assignLanes(athletes.map((a) => a.entrant), distance);
  const first = athletes.map((a, i) => { const d = sprintDraw(a, seed, event, round); return buildLane(a, laneOf[i], distance, d.reaction, d.form); });
  const cheat = first.filter((b) => b.run.falseStart).sort((a, b) => a.run.reaction - b.run.reaction)[0];
  let rows = first;
  let falseStart: SprintRace["falseStart"] = null;
  if (cheat) {
    // The recall: the false starter is out; everyone else is set again and draws a new reaction.
    falseStart = { key: cheat.run.athlete.key, reaction: cheat.run.reaction, race: raceOf(first, distance) };
    rows = athletes.map((a, i) => {
      if (a.key === cheat.run.athlete.key) return { ...cheat, run: { ...cheat.run, dq: true } };
      const d = sprintDraw(a, seed, event, `${round}-restart`);
      // A second false start in the same race is vanishingly rare; the restart's reaction is kept legal.
      return buildLane(a, laneOf[i], distance, Math.max(SPRINT.falseStart + 0.005, d.reaction), first[i].run.form);
    });
  }
  const drawn = rows.filter((r) => !r.run.dq);
  const race = raceOf(drawn.length ? drawn : rows, distance);
  const runs = placeRuns(rows.map((r) => r.run));
  return { distance, runs, order: runs, race, falseStart };
}

export interface SprintEventResult {
  event: SprintEvent;
  /** The heats (when more than eight ran): the Race's knockout format, places by their heat runs. */
  heats: Round[] | null;
  final: SprintRace;
}

/** The whole event: heats when more than eight run (the Race's Q and q format), then the final. */
export function sprintEvent(athletes: Athlete[], event: SprintEvent, seed: number): SprintEventResult {
  if (athletes.length <= 8) return { event, heats: null, final: runSprint(athletes, event, seed) };
  const distance = SPRINT_EVENTS[event] as Distance;
  const byKey = new Map(athletes.map((a) => [a.key, a]));
  // Each heat runner's time (its own reaction and form in the heats; a false start in a heat is the slowest time, out).
  const field = athletes.map((a) => {
    const d = sprintDraw(a, seed, event, "heat");
    const b = buildLane(a, 1, distance, d.reaction, d.form);
    return { key: a.key, time: b.run.falseStart ? 1e6 : b.run.raw };
  });
  const ko = knockout(field, seed);
  const heats = ko.rounds.slice(0, -1);
  const finalists = ko.finalists.map((k) => byKey.get(k)!);
  return { event, heats, final: runSprint(finalists, event, seed, "final") };
}

/** The neutral mark for the records: no reaction spread, form 1 (s, exact). */
export function sprintMark(a: Athlete, event: SprintEvent): number {
  const d = SPRINT_EVENTS[event];
  return meanReaction(a.stats.spe) + finishTime(runnerFor(a.entrant.stats, a.entrant.kg), d - Math.min(dipOf(a), d * 0.01));
}
