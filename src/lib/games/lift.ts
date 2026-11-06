import type { Athlete } from "./athlete";
import { LIFT, PLATES, STRENGTH_EXP } from "./constants";
import { formFactor, rngFor } from "./seed";

/**
 * Weightlifting: the clean & jerk. Pure and unit-tested.
 *
 * - Best lift = 190 kg × (kg/70)^(2/3) × (Atk/100) × (Def/100)^0.25: the
 *   allometric strength rule of the Sinclair coefficients (force grows with
 *   mass^(2/3)), with Defence keeping the lift stable.
 * - Three attempts each, in the IWF's rising-bar order (the lightest
 *   requested weight lifts first). The athlete opens at 90% of its best,
 *   then asks for about 96%, then goes for 100%; after a miss it tries the
 *   same weight again. Weights rise in 1 kg steps.
 * - Each attempt succeeds with a chance that falls quickly above the day's
 *   best (the best × a seeded form within ±1.5%): a logistic curve 1% wide,
 *   50% at the day's best, seeded.
 * - The bar loads real IWF plates (25 kg red, 20 blue, 15 yellow, 10 green,
 *   5 white, then the change plates) and 2.5 kg collars on a 20 kg bar;
 *   light lifts use a 15 kg bar, 10 and 5 kg technique bars or a 2 kg
 *   junior bar. An athlete that can't lift even that bombs out.
 * - Pound for pound (best ÷ bodyweight) is its own award: real
 *   weightlifting has bodyweight classes.
 * Anchor: the 70 kg reference with base 100 Attack and Defence lifts 190 kg.
 */

/** The athlete's best clean & jerk (kg, exact). */
export function maxLift(a: Pick<Athlete, "kg" | "stats">): number {
  return LIFT.ref * Math.pow(Math.max(0.01, a.kg) / 70, STRENGTH_EXP) * (Math.max(0, a.stats.atk) / 100) * Math.pow(Math.max(1, a.stats.def) / 100, LIFT.defExp);
}

/** The neutral mark for the records: the best, to the kilogram below. */
export const liftMark = (a: Pick<Athlete, "kg" | "stats">) => Math.floor(maxLift(a) + 1e-9);

/** Chance a lift of `weight` succeeds on a day whose best is `best`. */
export const successChance = (weight: number, best: number) => 1 / (1 + Math.exp((weight / Math.max(1e-6, best) - 1) / LIFT.width));

/** Which bar a lift goes on: the heaviest standard bar that leaves room for plates (the lift itself if it's exactly a bar). */
export function barFor(weight: number): number | null {
  for (const b of LIFT.bars) if (weight >= b + (b === LIFT.bar ? 2 * LIFT.collar : 0)) return b;
  return null;
}

export interface Loading {
  bar: number;
  collars: boolean;
  /** Plates on each side, heaviest (inside) first. */
  side: { kg: number; color: string; d: number; w: number }[];
}

/** The plates for a lift (each side the same), greedily from the heaviest. */
export function loadBar(weight: number): Loading | null {
  const bar = barFor(weight);
  if (bar == null) return null;
  const collars = bar === LIFT.bar;
  let left = (weight - bar - (collars ? 2 * LIFT.collar : 0)) / 2;
  const side: Loading["side"] = [];
  for (const p of PLATES) {
    while (left >= p.kg - 1e-9) { side.push(p); left -= p.kg; }
  }
  return { bar, collars, side };
}

export interface LiftAttempt {
  key: string;
  n: number;
  weight: number;
  success: boolean;
  chance: number;
  form: number;
}

export interface LiftCard {
  athlete: Athlete;
  max: number;
  attempts: LiftAttempt[];
  best: number | null;
  /** Best ÷ bodyweight. */
  p4p: number | null;
  place: number;
  p4pPlace: number;
}

export interface LiftResult {
  cards: LiftCard[];
  /** Every attempt in the order lifted (the rising bar). */
  sequence: LiftAttempt[];
  order: LiftCard[];
  /** Pound for pound, best first. */
  p4p: LiftCard[];
}

export function runLift(athletes: Athlete[], seed: number): LiftResult {
  const cards: LiftCard[] = athletes.map((a) => ({ athlete: a, max: maxLift(a), attempts: [], best: null, p4p: null, place: 0, p4pPlace: 0 }));
  const next = new Map<LiftCard, number>(cards.map((c) => [c, Math.max(1, Math.round(c.max * LIFT.opening))]));
  const lastAt = new Map<LiftCard, number>(cards.map((c, i) => [c, -1 - i]));
  const sequence: LiftAttempt[] = [];
  let step = 0;
  for (;;) {
    const queue = cards.filter((c) => c.attempts.length < LIFT.attempts);
    if (!queue.length) break;
    // Rising bar: the lightest request, then fewer attempts taken, then whoever lifted earlier.
    queue.sort((a, b) => next.get(a)! - next.get(b)! || a.attempts.length - b.attempts.length || lastAt.get(a)! - lastAt.get(b)! || a.athlete.key.localeCompare(b.athlete.key));
    const c = queue[0];
    const weight = next.get(c)!;
    if (barFor(weight) == null) {
      // Lighter than the lightest bar: it can't lift anything, every attempt is a no-lift.
      while (c.attempts.length < LIFT.attempts) c.attempts.push({ key: c.athlete.key, n: c.attempts.length + 1, weight, success: false, chance: 0, form: 1 });
      continue;
    }
    const n = c.attempts.length + 1;
    const rnd = rngFor(seed, "weightlifting", c.athlete.key, n);
    const form = formFactor(rnd);
    const chance = successChance(weight, c.max * form);
    const success = rnd() < chance;
    const at: LiftAttempt = { key: c.athlete.key, n, weight, success, chance, form };
    c.attempts.push(at);
    sequence.push(at);
    lastAt.set(c, step++);
    if (success) {
      c.best = weight;
      const target = Math.round(c.max * (n === 1 ? LIFT.second : LIFT.third));
      next.set(c, Math.max(weight + LIFT.step, target));
    }
  }
  for (const c of cards) c.p4p = c.best != null ? c.best / Math.max(0.01, c.athlete.kg) : null;
  const rank = (key: (c: LiftCard) => number | null) => {
    // Equal lifts: the lighter athlete ranks ahead (IWF), then whoever made it first.
    const order = [...cards].sort((a, b) => (key(b) ?? -1) - (key(a) ?? -1) || a.athlete.kg - b.athlete.kg || firstMade(a) - firstMade(b) || a.athlete.key.localeCompare(b.athlete.key));
    return order;
  };
  const firstMade = (c: LiftCard) => {
    const i = sequence.findIndex((s) => s.key === c.athlete.key && s.success && s.weight === c.best);
    return i < 0 ? 1e9 : i;
  };
  const order = rank((c) => c.best);
  order.forEach((c, k) => { c.place = c.best == null ? 0 : k + 1; });
  const p4p = rank((c) => c.p4p);
  p4p.forEach((c, k) => { c.p4pPlace = c.p4p == null ? 0 : k + 1; });
  return { cards, sequence, order, p4p };
}
