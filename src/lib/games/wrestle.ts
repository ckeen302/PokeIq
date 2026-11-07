import { topSpeed } from "@/lib/race/model";
import type { Athlete } from "./athlete";
import { G, STRENGTH_EXP, WRESTLE } from "./constants";
import { rngFor } from "./seed";

/**
 * Wrestling: a push-out bout in a sumo-style ring. No battle damage (that's
 * Mass Battle): pure strength and mass. Pure and unit-tested.
 *
 * - Push = 88 N × kg^(2/3) × Atk/100 (the reference shoves with about
 *   1,500 N); brace = 46 N × kg^(2/3) × Def/100 plus 0.6 × its weight in
 *   friction (rubber on clay).
 * - The bout: both charge from their lines (momentum from Speed and mass),
 *   then lock up. Whoever's push beats the other's brace drives the pair
 *   back, with momentum; efforts swing with seeded surges and fade with
 *   stamina (HP). The one pushed out of the ring loses; after 30 s the one
 *   pushed further back does.
 * - The ring is a sumo dohyō, 4.55 m across, or 1.5 × a giant's body
 *   length when it wouldn't fit.
 * - The bracket: a knockout (the Race's tournament draws, seeded by push +
 *   brace: 1 v 8, 4 v 5…), top seeds getting the byes, and a bronze bout
 *   between the semi-final losers.
 */

const strength = (a: Athlete) => Math.pow(Math.max(0.01, a.kg), STRENGTH_EXP);
export const pushForce = (a: Athlete) => WRESTLE.push * strength(a) * (Math.max(0, a.stats.atk) / 100);
export const braceForce = (a: Athlete) => WRESTLE.brace * strength(a) * (Math.max(1, a.stats.def) / 100) + WRESTLE.friction * a.kg * G;
/** The records' ring strength: push + brace (N). */
export const ringStrength = (a: Athlete) => pushForce(a) + braceForce(a);

export const ringRadius = (a: Athlete, b: Athlete) => Math.max(WRESTLE.ring, WRESTLE.giantRing * Math.max(a.length, b.length)) / 2;

/** Half the figure's depth along the push (m): its width side-on. */
const halfDepth = (a: Athlete) => 0.5 * Math.min(a.length, Math.max(a.height * 0.45, a.length * 0.6));

export interface Surge {
  t: number;
  who: "a" | "b";
}

export interface BoutTrace {
  a: Athlete;
  b: Athlete;
  step: number;
  /** The contact point along the push line (m; + towards b's edge), and each one's effort. */
  s: Float32Array;
  ea: Float32Array;
  eb: Float32Array;
  surges: Surge[];
  ring: number;
  /** Where each wrestler's feet are from the contact point (m). */
  da: number;
  db: number;
  winner: "a" | "b";
  /** The bell, or the moment the loser's feet left the ring (s). */
  end: number;
  ringOut: boolean;
}

function efforts(x: Athlete, seed: number, tag: string, n: number, step: number): { e: Float32Array; surges: number[] } {
  const rnd = rngFor(seed, "wrestling", tag, x.key);
  const e = new Float32Array(n);
  const surges: number[] = [];
  let t = 0.8 + rnd() * 0.8;
  const T = n * step;
  while (t < T) { surges.push(t); t += 0.25 - Math.log(Math.max(1e-6, rnd())) / WRESTLE.surgeRate; }
  const p1 = rnd() * 6.283, p2 = rnd() * 6.283, w1 = 1.1 + rnd() * 0.8, w2 = 2.3 + rnd() * 1.2;
  const tau = WRESTLE.stamina * Math.pow(Math.max(1, x.stats.hp) / 100, 0.8);
  for (let i = 0; i < n; i++) {
    const ti = i * step;
    let k = 1 + 0.1 * Math.sin(w1 * ti + p1) + 0.06 * Math.sin(w2 * ti + p2);
    for (const s of surges) {
      const u = (ti - s) / 0.32;
      if (u > 0 && u < 1) k += WRESTLE.surge * 0.5 * (1 - Math.cos(2 * Math.PI * u));
    }
    e[i] = k * Math.exp(-ti / tau);
  }
  return { e, surges };
}

export function bout(a: Athlete, b: Athlete, seed: number, tag = "bout"): BoutTrace {
  const step = 0.02;
  const n = Math.ceil(WRESTLE.maxTime / step) + 1;
  const A = efforts(a, seed, `${tag}|a`, n, step), B = efforts(b, seed, `${tag}|b`, n, step);
  const ring = ringRadius(a, b);
  const da = halfDepth(a), db = halfDepth(b);
  const Pa = pushForce(a), Pb = pushForce(b), Ha = braceForce(a), Hb = braceForce(b);
  const m = a.kg + b.kg;
  const s = new Float32Array(n);
  // The charge: each comes off its line at a quarter of its top speed (at most 3 m/s); the heavier, faster charge wins ground.
  const charge = (x: Athlete) => Math.min(3, 0.25 * topSpeed(x.stats.spe));
  let v = (a.kg * charge(a) - b.kg * charge(b)) / m;
  let x = 0;
  let winner: "a" | "b" | null = null, end = WRESTLE.maxTime, ringOut = false;
  let last = 0;
  for (let i = 0; i < n; i++) {
    s[i] = x;
    last = i;
    if (x - da < -ring) { winner = "b"; end = i * step; ringOut = true; break; }
    if (x + db > ring) { winner = "a"; end = i * step; ringOut = true; break; }
    const fa = Pa * A.e[i] - Hb, fb = Pb * B.e[i] - Ha;
    const net = Math.max(0, fa) - Math.max(0, fb);
    const acc = net / m;
    v += acc * step;
    // Feet scraping the clay: motion dies away unless someone keeps driving.
    v *= Math.exp(-step / (net === 0 ? 0.12 : 0.55));
    x += v * step;
  }
  for (let i = last + 1; i < n; i++) s[i] = s[last];
  if (!winner) {
    const xe = s[last];
    winner = xe > 1e-6 ? "a" : xe < -1e-6 ? "b" : ringStrength(a) >= ringStrength(b) ? "a" : "b";
  }
  const surges: Surge[] = [...A.surges.filter((t) => t < end).map((t) => ({ t, who: "a" as const })), ...B.surges.filter((t) => t < end).map((t) => ({ t, who: "b" as const }))].sort((p, q) => p.t - q.t);
  return { a, b, step, s, ea: A.e, eb: B.e, surges, ring, da, db, winner, end, ringOut };
}

/** The contact point at time t (s). */
export function boutAt(tr: BoutTrace, t: number): number {
  const f = Math.max(0, Math.min(t, tr.end)) / tr.step;
  const i = Math.min(tr.s.length - 2, Math.floor(f));
  const u = Math.min(1, f - i);
  return tr.s[i] + (tr.s[i + 1] - tr.s[i]) * u;
}

/** Standard bracket positions for `size` seeds: 1 v size, then the halves (1, 8, 4, 5, 2, 7, 3, 6 for eight). */
export function bracketOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const k = order.length * 2;
    order = order.flatMap((x) => [x, k + 1 - x]);
  }
  return order;
}

export interface BracketBout {
  round: string;
  a: Athlete;
  b: Athlete | null;
  /** null for a bye. */
  trace: BoutTrace | null;
  winner: Athlete;
  loser: Athlete | null;
}

export interface Bracket {
  rounds: { name: string; bouts: BracketBout[] }[];
  bronze: BracketBout | null;
  gold: Athlete;
  silver: Athlete | null;
  bronzeMedal: Athlete | null;
  /** Every athlete by how far it got (gold, silver, bronze, then the rest by round and seed). */
  order: Athlete[];
}

const ROUND_NAMES = ["Final", "Semi-finals", "Quarter-finals", "Round of 16", "Round of 32", "Round of 64"];

export function runBracket(athletes: Athlete[], seed: number): Bracket {
  if (athletes.length < 2) throw new Error("a bracket needs two wrestlers");
  const seeds = [...athletes].sort((x, y) => ringStrength(y) - ringStrength(x) || x.key.localeCompare(y.key));
  let size = 2;
  while (size < seeds.length) size *= 2;
  const slots = bracketOrder(size).map((k) => seeds[k - 1] ?? null);
  const rounds: Bracket["rounds"] = [];
  const outAt = new Map<string, number>();
  let field: (Athlete | null)[] = slots;
  let r = 0;
  const semiLosers: Athlete[] = [];
  while (field.length > 1) {
    const name = ROUND_NAMES[Math.log2(field.length) - 1] ?? `Round of ${field.length}`;
    const bouts: BracketBout[] = [];
    const next: (Athlete | null)[] = [];
    for (let i = 0; i < field.length; i += 2) {
      const a = field[i], b = field[i + 1];
      if (!a && !b) { next.push(null); continue; }
      if (!a || !b) {
        const w = (a ?? b)!;
        bouts.push({ round: name, a: w, b: null, trace: null, winner: w, loser: null });
        next.push(w);
        continue;
      }
      const tr = bout(a, b, seed, `${name}|${a.key}|${b.key}`);
      const w = tr.winner === "a" ? a : b, l = tr.winner === "a" ? b : a;
      bouts.push({ round: name, a, b, trace: tr, winner: w, loser: l });
      outAt.set(l.key, r);
      if (field.length === 4) semiLosers.push(l);
      next.push(w);
    }
    rounds.push({ name, bouts });
    field = next;
    r++;
  }
  const finalBout = rounds[rounds.length - 1].bouts[0];
  const gold = finalBout.winner;
  const silver = finalBout.loser;
  let bronze: BracketBout | null = null;
  let bronzeMedal: Athlete | null = null;
  if (semiLosers.length === 2) {
    const [x, y] = semiLosers;
    const tr = bout(x, y, seed, `Bronze|${x.key}|${y.key}`);
    const w = tr.winner === "a" ? x : y;
    bronze = { round: "Bronze", a: x, b: y, trace: tr, winner: w, loser: w === x ? y : x };
    bronzeMedal = w;
  } else if (semiLosers.length === 1) bronzeMedal = semiLosers[0];
  const rest = seeds.filter((x) => x !== gold && x !== silver && x !== bronzeMedal);
  rest.sort((x, y) => (outAt.get(y.key) ?? 99) - (outAt.get(x.key) ?? 99) || seeds.indexOf(x) - seeds.indexOf(y));
  // The bronze bout's loser is fourth.
  if (bronze) { const i = rest.indexOf(bronze.loser!); if (i > 0) { rest.splice(i, 1); rest.unshift(bronze.loser!); } }
  const order = [gold, ...(silver ? [silver] : []), ...(bronzeMedal ? [bronzeMedal] : []), ...rest];
  return { rounds, bronze, gold, silver, bronzeMedal, order };
}
