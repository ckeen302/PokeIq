import { isLowBody, type Athlete } from "./athlete";
import { G, HIGH_JUMP, spring } from "./constants";
import { floorCm } from "./events";
import { formFactor, rngFor } from "./seed";

/**
 * The high jump. Pure and unit-tested.
 *
 * - Clearance = the centre of mass at take-off (0.55 × height) + its rise
 *   v_v²/2g + technique, with v_v = 4.65 m/s × (Atk/100)^0.5 ×
 *   (kg/70)^(−1/6). Technique: a Fosbury flop lets a biped clear a bar
 *   above its centre of mass's peak (+0.2 m); four legs or a serpent's
 *   body can't arch over a bar (−0.2 m), from the body shape.
 * - Tall Pokémon start high (their centre of mass is already metres up):
 *   physically true, and the commentary says so.
 * - Each attempt is the day's clearance × a seeded form within ±1.5%: it
 *   clears the bar if that's at least the bar's height.
 * - The competition follows World Athletics TR 26–27: athletes come in at
 *   their own opening height, the bar rises in 5 cm steps, then 3 cm once
 *   three or fewer are left; three consecutive failures and you're out. The
 *   ranking: the highest height cleared, then the fewest failures at that
 *   height, then the fewest failures in the whole competition (countback).
 *   A tie for first goes to a jump-off: one attempt at each height, the bar
 *   up 2 cm when more than one clears and down 2 cm when none does. Other
 *   ties share the place.
 *
 * Anchor: the 70 kg reference, 1.9 m tall, base 100 Attack, clears 2.35 m.
 */

export interface HighJumpPhysics {
  vv: number;
  com: number;
  rise: number;
  technique: number;
  clearance: number;
}

export function technique(a: Athlete): number {
  if (a.body === "biped") return HIGH_JUMP.bipedBonus;
  if (isLowBody(a)) return HIGH_JUMP.quadPenalty;
  return 0;
}

export function highJumpPhysics(a: Athlete, form = 1): HighJumpPhysics {
  const vv = HIGH_JUMP.vVertical * Math.sqrt(Math.max(0, a.stats.atk) / 100) * spring(a.kg) * form;
  const com = HIGH_JUMP.com * a.height;
  const rise = (vv * vv) / (2 * G);
  const t = technique(a);
  return { vv, com, rise, technique: t, clearance: com + rise + t };
}

/** The neutral mark for the records (m, exact; the bar's best is this to the cm below). */
export const highJumpMark = (a: Athlete) => Math.max(0, highJumpPhysics(a).clearance);

export interface HjJump {
  key: string;
  height: number;
  /** Attempt at this height (1–3). */
  n: number;
  cleared: boolean;
  /** How far over (+) or under (−) the bar the jump was (m). */
  margin: number;
  form: number;
}

export interface HjCard {
  athlete: Athlete;
  opening: number;
  jumps: HjJump[];
  best: number | null;
  failsAtBest: number;
  totalFails: number;
  out: boolean;
  place: number;
  /** Won (or lost) a jump-off. */
  jumpOff: boolean;
}

export interface HighJumpResult {
  /** Every height the bar was set at, in order. */
  heights: number[];
  /** Every jump, in the order they were taken. */
  jumps: HjJump[];
  cards: HjCard[];
  order: HjCard[];
  jumpOff: HjJump[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The opening height: about 7% under the athlete's best, on the 5 cm grid, from 5 cm. */
export const openingFor = (clearance: number) => Math.max(HIGH_JUMP.stepBig, Math.floor((clearance * HIGH_JUMP.opening) / HIGH_JUMP.stepBig + 1e-9) * HIGH_JUMP.stepBig);

function attempt(a: Athlete, seed: number, height: number, n: number, tag = ""): HjJump {
  const rnd = rngFor(seed, "high-jump", a.key, Math.round(height * 100), n, tag);
  const form = formFactor(rnd);
  const jump = highJumpPhysics(a, form).clearance;
  return { key: a.key, height, n, cleared: jump >= height, margin: jump - height, form };
}

/** Countback (TR 26.8): best height, then failures at it, then total failures. Negative when `a` ranks ahead. */
export function countback(a: Pick<HjCard, "best" | "failsAtBest" | "totalFails">, b: Pick<HjCard, "best" | "failsAtBest" | "totalFails">): number {
  const ba = a.best ?? -1, bb = b.best ?? -1;
  if (ba !== bb) return bb - ba;
  if (a.best == null) return 0;
  return a.failsAtBest - b.failsAtBest || a.totalFails - b.totalFails;
}

export function runHighJump(athletes: Athlete[], seed: number): HighJumpResult {
  const cards: HjCard[] = athletes.map((a) => ({ athlete: a, opening: openingFor(highJumpMark(a)), jumps: [], best: null, failsAtBest: 0, totalFails: 0, out: false, place: 0, jumpOff: false }));
  // Jumping order: lowest opening first (then by name), as the officials' list.
  const order0 = [...cards].sort((a, b) => a.opening - b.opening || a.athlete.key.localeCompare(b.athlete.key));
  const heights: number[] = [];
  const jumps: HjJump[] = [];
  let h = Math.min(...cards.map((c) => c.opening));
  for (let guard = 0; guard < 400; guard++) {
    const waiting = cards.filter((c) => !c.out && c.opening > h + 1e-9);
    const up = order0.filter((c) => !c.out && c.opening <= h + 1e-9);
    if (!up.length) {
      if (!waiting.length) break;
      h = Math.min(...waiting.map((c) => c.opening));
      continue;
    }
    heights.push(h);
    // Round robin at this height: everyone's first attempt, then the second attempts, then the third.
    const fails = new Map<HjCard, number>(up.map((c) => [c, 0]));
    const done = new Set<HjCard>();
    for (let n = 1; n <= 3; n++) {
      for (const c of up) {
        if (done.has(c) || c.out) continue;
        const j = attempt(c.athlete, seed, h, n);
        c.jumps.push(j);
        jumps.push(j);
        if (j.cleared) {
          done.add(c);
          c.best = h;
          c.failsAtBest = fails.get(c)!;
        } else {
          fails.set(c, fails.get(c)! + 1);
          c.totalFails++;
          if (fails.get(c)! >= 3) c.out = true;
        }
      }
    }
    const left = cards.filter((c) => !c.out);
    if (!left.length) break;
    // 5 cm steps while more than three are in the competition (counting those still to come in), then 3 cm.
    h = round2(h + (left.length > 3 ? HIGH_JUMP.stepBig : HIGH_JUMP.stepSmall));
  }
  const order = [...cards].sort((a, b) => countback(a, b) || a.athlete.key.localeCompare(b.athlete.key));
  order.forEach((c, k) => {
    c.place = k > 0 && countback(c, order[k - 1]) === 0 ? order[k - 1].place : k + 1;
  });
  // A tie for first: the jump-off.
  const tied = order.filter((c) => c.place === 1 && c.best != null);
  const jumpOff: HjJump[] = [];
  if (tied.length > 1) {
    let alive = [...tied];
    let bar = round2(tied[0].best! + HIGH_JUMP.stepSmall);
    for (let k = 1; k <= 24 && alive.length > 1; k++) {
      const res = alive.map((c) => ({ c, j: attempt(c.athlete, seed, bar, 1, `jo${k}`) }));
      jumpOff.push(...res.map((r) => r.j));
      const over = res.filter((r) => r.j.cleared).map((r) => r.c);
      if (over.length === 1) { alive = over; break; }
      if (over.length > 1) { alive = over; bar = round2(bar + 0.02); } else bar = round2(bar - 0.02);
    }
    if (alive.length === 1) {
      for (const c of tied) {
        c.jumpOff = true;
        if (c !== alive[0]) c.place = 2;
      }
      order.sort((a, b) => a.place - b.place || countback(a, b) || a.athlete.key.localeCompare(b.athlete.key));
    }
  }
  for (const c of cards) if (c.best != null) c.best = floorCm(c.best);
  return { heights, jumps, cards, order, jumpOff };
}
