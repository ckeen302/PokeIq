import { runnerFor, sprintV, timeToCover } from "@/lib/race/model";
import type { Athlete } from "./athlete";
import { AIR_DENSITY, G, JAVELIN, SHOT, THROW } from "./constants";
import { floorCm } from "./events";
import { maxLift } from "./lift";
import { placeSeries } from "./longjump";
import { formFactor, rngFor } from "./seed";

/**
 * The shot put and the javelin. Pure and unit-tested.
 *
 * Shot put (7.26 kg, the real shot):
 * - Release speed v = 14.1 m/s × (Atk/100)^0.5 × (kg/70)^(1/6): big bodies
 *   get a little extra speed from leverage.
 * - Capped by the shot's mass: Hill's force–velocity relation slows a
 *   muscle as the load nears its strength, so a thrower whose best clean &
 *   jerk is close to 7.26 kg can hardly move it, and one who can't lift it
 *   gets no mark. And no limb swings an implement faster than about 31 m/s.
 * - Released from 1.15 × height (capped at 30 m, so giants still land in
 *   the sector) at 37°, with air drag on the shot (a 12 cm sphere, Cd 0.47),
 *   integrated with RK4. Measured from the inside of the stop board.
 * - Pokémon without arms (body shape) throw with a head or tail flick at
 *   60% of the speed.
 * Anchor: the 70 kg reference with base 100 Attack puts 22 m.
 *
 * Javelin (800 g):
 * - Release speed = 0.25 × the race model's speed after a 25 m run-up +
 *   arm speed 27.1 m/s × (Atk/100)^0.5 × (kg/70)^(1/6), under the same caps.
 * - Flight: a projectile with simple lift and drag (Hubbard & Rust, 1984),
 *   the javelin weathervaning along its path; released at 35° from
 *   1.05 × height; measured from the arc.
 * Anchor: about 88 m.
 *
 * Three throws each, the best counts (ties: the second best, then the third).
 */

export type Implement = "shot" | "javelin";

/** Hill's force–velocity factor for an implement of `mass` kg thrown by an athlete whose best lift is `lift` kg (1 for the reference; 0 when it can't lift it). */
export function loadFactor(mass: number, lift: number): number {
  const hill = (r: number) => (r >= 1 ? 0 : (1 - r) / (1 + r / THROW.hillK));
  const ref = hill(mass / 190);
  return Math.min(1, hill(mass / Math.max(1e-6, lift)) / ref);
}

export interface ThrowPhysics {
  implement: Implement;
  /** Release speed (m/s), angle (rad) and height (m). */
  v: number;
  angle: number;
  height: number;
  /** The hand's reach beyond the board or arc at release (m). */
  reach: number;
  /** Speed parts, for "How it works". */
  vPower: number;
  load: number;
  armless: boolean;
  /** Flight path: [x, y] every 1/60 s, from the release. */
  path: Float32Array;
  flight: number;
  /** Measured mark (m, exact) and the landing point's distance from the release. */
  distance: number;
  /** Peak height (m). */
  peak: number;
  /** Can't lift the implement: no mark. */
  noMark: boolean;
}

/** RK4 flight with quadratic drag (and lift for the javelin, perpendicular to the path). Returns the path every `dt` s until it lands. */
export function fly(v: number, angle: number, h0: number, kDrag: number, kLift: number, dt = 1 / 60): { path: Float32Array; flight: number; range: number; peak: number } {
  let x = 0, y = h0, vx = v * Math.cos(angle), vy = v * Math.sin(angle);
  const acc = (ux: number, uy: number): [number, number] => {
    const s = Math.hypot(ux, uy);
    return [-kDrag * s * ux - kLift * s * uy, -G - kDrag * s * uy + kLift * s * ux];
  };
  const pts: number[] = [x, y];
  let t = 0, peak = y;
  const h = 1 / 600;
  let next = dt;
  for (let i = 0; i < 2e6; i++) {
    const [ax1, ay1] = acc(vx, vy);
    const [ax2, ay2] = acc(vx + (h / 2) * ax1, vy + (h / 2) * ay1);
    const [ax3, ay3] = acc(vx + (h / 2) * ax2, vy + (h / 2) * ay2);
    const [ax4, ay4] = acc(vx + h * ax3, vy + h * ay3);
    const nx = x + h * (vx + (h / 6) * (ax1 + ax2 + ax3)), ny = y + h * (vy + (h / 6) * (ay1 + ay2 + ay3));
    const nvx = vx + (h / 6) * (ax1 + 2 * ax2 + 2 * ax3 + ax4), nvy = vy + (h / 6) * (ay1 + 2 * ay2 + 2 * ay3 + ay4);
    if (ny <= 0 && nvy < 0) {
      const k = y / Math.max(1e-9, y - ny);
      const lx = x + (nx - x) * k;
      t += h * k;
      pts.push(lx, 0);
      return { path: new Float32Array(pts), flight: t, range: lx, peak };
    }
    x = nx; y = ny; vx = nvx; vy = nvy;
    t += h;
    peak = Math.max(peak, y);
    if (t >= next) { pts.push(x, y); next += dt; }
  }
  return { path: new Float32Array(pts), flight: t, range: x, peak };
}

export function throwPhysics(a: Athlete, implement: Implement, form = 1): ThrowPhysics {
  const shot = implement === "shot";
  const atk = Math.sqrt(Math.max(0, a.stats.atk) / 100);
  const size = Math.pow(Math.max(0.1, a.kg) / 70, shot ? SHOT.massExp : JAVELIN.massExp);
  let vPower: number;
  if (shot) vPower = SHOT.vRef * atk * size;
  else {
    const r = runnerFor(a.stats, a.kg);
    const t = timeToCover(r, JAVELIN.runUp);
    const vRun = Number.isFinite(t) ? sprintV(r, t) : 0;
    vPower = JAVELIN.runKeep * vRun + JAVELIN.armRef * atk * size;
  }
  const load = loadFactor(shot ? SHOT.mass : JAVELIN.mass, maxLift(a));
  const armless = !a.arms;
  const v = Math.min(THROW.vCap, vPower * load * (armless ? THROW.noArms : 1) * form);
  const angle = ((shot ? SHOT.angle : JAVELIN.angle) * Math.PI) / 180;
  const height = Math.min(shot ? SHOT.releaseCap : JAVELIN.releaseCap, a.height * (shot ? SHOT.releaseShare : JAVELIN.releaseShare));
  const reach = a.height * (shot ? SHOT.reachShare : JAVELIN.reachShare);
  const noMark = load <= 0 || v <= 0.05;
  const area = Math.PI * (SHOT.diameter / 2) ** 2;
  const kDrag = shot ? (0.5 * AIR_DENSITY * SHOT.cd * area) / SHOT.mass : (0.5 * AIR_DENSITY * JAVELIN.cdA) / JAVELIN.mass;
  const kLift = shot ? 0 : (0.5 * AIR_DENSITY * JAVELIN.clA) / JAVELIN.mass;
  const f = fly(noMark ? 0 : v, angle, height, kDrag, kLift);
  return { implement, v: noMark ? 0 : v, angle, height, reach, vPower, load, armless, path: f.path, flight: f.flight, distance: noMark ? 0 : reach + f.range, peak: f.peak, noMark };
}

/** The neutral marks for the records (m, exact; 0 when it can't lift the implement). */
export const shotMark = (a: Athlete) => throwPhysics(a, "shot").distance;
export const javelinMark = (a: Athlete) => throwPhysics(a, "javelin").distance;

export interface ThrowAttempt {
  round: number;
  form: number;
  mark: number | null;
  physics: ThrowPhysics;
}

export interface ThrowCard {
  athlete: Athlete;
  attempts: ThrowAttempt[];
  best: number | null;
  place: number;
}

export interface ThrowResult {
  implement: Implement;
  cards: ThrowCard[];
  order: ThrowCard[];
  turns: ThrowCard[];
}

export function throwAttempt(a: Athlete, implement: Implement, seed: number, round: number): ThrowAttempt {
  const rnd = rngFor(seed, implement, a.key, round);
  const form = formFactor(rnd);
  const physics = throwPhysics(a, implement, form);
  return { round, form, mark: physics.noMark ? null : floorCm(physics.distance), physics };
}

export function runThrow(athletes: Athlete[], implement: Implement, seed: number): ThrowResult {
  const cards: ThrowCard[] = athletes.map((a) => {
    const attempts = [1, 2, 3].map((r) => throwAttempt(a, implement, seed, r));
    const marks = attempts.map((x) => x.mark).filter((x): x is number => x != null);
    return { athlete: a, attempts, best: marks.length ? Math.max(...marks) : null, place: 0 };
  });
  const mark = implement === "shot" ? shotMark : javelinMark;
  const turns = [...cards].sort((a, b) => mark(a.athlete) - mark(b.athlete) || a.athlete.key.localeCompare(b.athlete.key));
  const order = placeSeries(cards, (c) => c.attempts.map((x) => x.mark), (a, b) => a.athlete.key.localeCompare(b.athlete.key));
  return { implement, cards, order, turns };
}
