import { runnerFor, sprintV, timeToCover, type Runner } from "@/lib/race/model";
import { referenceAthlete, type Athlete } from "./athlete";
import { G, LONG_JUMP, spring } from "./constants";
import { floorCm } from "./events";
import { formFactor, normal, rngFor } from "./seed";

/**
 * The long jump. Pure and unit-tested.
 *
 * - Run-up: the speed at take-off is the race model's speed after a 40 m
 *   run-up (lib/race/model, the Race's sprint curve) × 0.95: jumpers lose
 *   about 5% planting at the board.
 * - Take-off: the vertical speed comes from leg power,
 *   v_v = 3.3 m/s × (Atk/100)^0.5 × (kg/70)^(−1/6): heavy bodies get less
 *   spring per kilogram.
 * - Flight: a projectile (g = 9.81 m/s², no air drag: it changes a jump by
 *   about 1%) from the centre of mass at take-off (0.55 × height) to its
 *   height at touchdown (0.22 × height), plus a take-off distance and a
 *   landing distance that each scale with body length (0.2 × height).
 * - The board: the take-off toe lands behind the foul line by a seeded
 *   amount (faster jumpers and bigger bodies scatter more); over the line is
 *   a foul, about one jump in ten for the reference. A legal jump is
 *   measured from the line, so what's left behind it is lost.
 * - Three attempts each; the best counts, ties go to the second best, then
 *   the third (World Athletics TR 25.22). Marks are read to the cm below.
 * - Fliers (Flying types, Levitate, the Flying egg group) can't glide
 *   across: it's a jump, so their flight is the same physics.
 *
 * Anchor: the 70 kg, 1.8 m reference with base 100 Speed and Attack jumps
 * 8.40 m, the elite level.
 */

export interface JumpPhysics {
  runner: Runner;
  /** Approach speed at the board (m/s) and the time the 40 m run-up takes (s). */
  vRun: number;
  tRun: number;
  vx: number;
  vy: number;
  /** Centre of mass at take-off and at touchdown (m). */
  h0: number;
  h1: number;
  /** Toe to centre of mass at take-off, centre of mass to heels at touchdown (m). */
  dTake: number;
  dLand: number;
  /** Time in the air (s). */
  flight: number;
  /** From the take-off toe to the mark in the sand (m). */
  distance: number;
  /** Highest point of the centre of mass (m). */
  peak: number;
}

export function jumpPhysics(a: Athlete, form = 1): JumpPhysics {
  const base = runnerFor(a.stats, a.kg);
  const runner = { ...base, vmax: base.vmax * form };
  const tRun = timeToCover(runner, LONG_JUMP.runUp);
  const vRun = Number.isFinite(tRun) ? sprintV(runner, tRun) : 0;
  const vx = LONG_JUMP.boardKeep * vRun;
  const vy = LONG_JUMP.vVertical * Math.sqrt(Math.max(0, a.stats.atk) / 100) * spring(a.kg) * form;
  const H = a.height;
  const h0 = LONG_JUMP.comTakeoff * H, h1 = LONG_JUMP.comLanding * H;
  const flight = (vy + Math.sqrt(vy * vy + 2 * G * (h0 - h1))) / G;
  const dTake = LONG_JUMP.takeoffShare * H, dLand = LONG_JUMP.landingShare * H;
  return { runner, vRun, tRun, vx, vy, h0, h1, dTake, dLand, flight, distance: dTake + vx * flight + dLand, peak: h0 + (vy * vy) / (2 * G) };
}

/** The neutral mark for the records: form 1, a perfect board (m, exact). */
export const longJumpMark = (a: Athlete) => jumpPhysics(a).distance;

let refVx: number | null = null;
const referenceVx = () => (refVx ??= jumpPhysics(referenceAthlete()).vx);

/** Where the take-off toe lands behind the foul line (m; negative is over it, a foul). */
export function boardDraw(a: Athlete, vx: number, rnd: () => number): number {
  const size = a.height / 1.8;
  const sigma = LONG_JUMP.boardSigma * size * Math.max(0.2, vx / referenceVx());
  return LONG_JUMP.boardAim * LONG_JUMP.boardSigma * size + sigma * normal(rnd);
}

export interface JumpAttempt {
  round: number;
  form: number;
  /** The toe's distance behind the foul line at take-off (m; negative: a foul). */
  board: number;
  foul: boolean;
  /** Measured from the line, to the cm below; null for a foul. */
  mark: number | null;
  physics: JumpPhysics;
}

export interface JumpCard {
  athlete: Athlete;
  attempts: JumpAttempt[];
  best: number | null;
  place: number;
}

export interface LongJumpResult {
  cards: JumpCard[];
  /** By place. */
  order: JumpCard[];
  /** Jumping order (weakest predicted first), the same each round. */
  turns: JumpCard[];
}

export function jumpAttempt(a: Athlete, seed: number, round: number): JumpAttempt {
  const rnd = rngFor(seed, "long-jump", a.key, round);
  const form = formFactor(rnd);
  const physics = jumpPhysics(a, form);
  const board = boardDraw(a, physics.vx, rnd);
  const foul = board < 0;
  return { round, form, board, foul, mark: foul ? null : floorCm(Math.max(0, physics.distance - board)), physics };
}

/** Series compared best first, then second best, then third (TR 25.22). */
export function compareSeries(a: (number | null)[], b: (number | null)[]): number {
  const sa = a.filter((x): x is number => x != null).sort((x, y) => y - x);
  const sb = b.filter((x): x is number => x != null).sort((x, y) => y - x);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i] ?? -1, y = sb[i] ?? -1;
    if (x !== y) return y - x;
  }
  return 0;
}

/** Places for horizontal-jump and throw series: best mark, then the next best… Equal series share a place; no mark is last. */
export function placeSeries<T extends { best: number | null; place: number }>(cards: T[], series: (c: T) => (number | null)[], tiebreak: (a: T, b: T) => number): T[] {
  const order = [...cards].sort((a, b) => compareSeries(series(a), series(b)) || tiebreak(a, b));
  order.forEach((c, k) => {
    c.place = k > 0 && compareSeries(series(c), series(order[k - 1])) === 0 ? order[k - 1].place : k + 1;
  });
  return order;
}

export function runLongJump(athletes: Athlete[], seed: number): LongJumpResult {
  const cards: JumpCard[] = athletes.map((a) => {
    const attempts = Array.from({ length: LONG_JUMP.attempts }, (_, i) => jumpAttempt(a, seed, i + 1));
    const marks = attempts.map((x) => x.mark).filter((x): x is number => x != null);
    return { athlete: a, attempts, best: marks.length ? Math.max(...marks) : null, place: 0 };
  });
  const turns = [...cards].sort((a, b) => longJumpMark(a.athlete) - longJumpMark(b.athlete) || a.athlete.key.localeCompare(b.athlete.key));
  const order = placeSeries(cards, (c) => c.attempts.map((x) => x.mark), (a, b) => a.athlete.key.localeCompare(b.athlete.key));
  return { cards, order, turns };
}
