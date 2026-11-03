import { hashString } from "@/lib/rng";

/**
 * "How many X does it take to beat Y?": the smallest army that wins at
 * least half its battles (or nine in ten, when asked). Every army size is
 * tried on the same seeded battles (common random numbers, so sizes
 * compare fairly):
 *
 * 1. Doubling (1, 2, 4, 8…) with a quick look at each size (a dozen
 *    battles, stopping as soon as the majority is settled) until one wins
 *    half the time.
 * 2. A binary search between the last losing size and that one, now with
 *    the full set of battles per size (40 unless asked otherwise), again
 *    stopping once the result is settled.
 * 3. The answer is played on all of its battles, for its win rate and for
 *    a battle to show.
 *
 * The spread is half the range of sizes where it could go either way
 * (winning between a quarter and three quarters of their battles; for the
 * nine-in-ten answer, between 80% and 97.5%), from the answer and a few
 * sizes either side of it, each played on every battle.
 * Pure: the battles themselves come from `evaluate` (a pool of workers in
 * the browser, a loop in tests and scripts).
 */

export const SOLVER = {
  /** Battles per size in the binary search (and for the answer). */
  runs: 40,
  /** Battles per size while doubling. */
  quick: 12,
  /** No answer above this. */
  maxN: 20000,
} as const;

export interface Step {
  n: number;
  wins: number;
  runs: number;
}

export interface Evaluation {
  wins: number;
  runs: number;
  /** Seeds of battles the army won (in seed order). */
  wonSeeds: number[];
  /** Seeds of battles it lost. */
  lostSeeds: number[];
}

/**
 * Plays battles of `n` against the boss on `seeds` (in order), stopping
 * early once `settled(wins, losses)` says so; returns what was played.
 */
export type Evaluate = (n: number, seeds: number[], settled: (wins: number, losses: number) => boolean) => Promise<Evaluation>;

export interface SolverResult {
  answer: number | null;
  /** Why there's no answer. */
  none?: "above-cap";
  steps: Step[];
  spread: number;
  /** Wins at the answer, out of `runs`. */
  wins: number;
  runs: number;
  /** A battle at the answer the army won (to show), and one it lost. */
  wonSeed: number | null;
  lostSeed: number | null;
}

/** The battles' seeds for a question, from its key (the same every time it's asked; more battles extend the list). */
export function questionSeeds(key: string, count: number = SOLVER.runs): number[] {
  return Array.from({ length: count }, (_, k) => hashString(`${key}#${k}`) >>> 0);
}

/** Wins a size needs out of `runs` battles. */
export const winsNeeded = (runs: number, threshold: number) => Math.ceil(runs * threshold - 1e-9);
/** Settled once the size has won enough, or lost too many to still get there. */
const settledBy = (runs: number, threshold: number) => {
  const need = winsNeeded(runs, threshold);
  return (wins: number, losses: number) => wins >= need || losses > runs - need;
};

/** Win rates made non-decreasing in size (pool-adjacent-violators), weighted by battles played. */
export function monotone(points: { n: number; wins: number; runs: number }[]): { n: number; rate: number }[] {
  const blocks: { n: number[]; w: number; r: number }[] = [];
  for (const p of [...points].sort((a, b) => a.n - b.n)) {
    blocks.push({ n: [p.n], w: p.wins, r: Math.max(1, p.runs) });
    while (blocks.length > 1 && blocks[blocks.length - 2].w / blocks[blocks.length - 2].r > blocks[blocks.length - 1].w / blocks[blocks.length - 1].r) {
      const b = blocks.pop()!;
      const a = blocks[blocks.length - 1];
      a.n.push(...b.n);
      a.w += b.w;
      a.r += b.r;
    }
  }
  return blocks.flatMap((b) => b.n.map((n) => ({ n, rate: b.w / b.r })));
}

/** Where a non-decreasing rate curve first reaches `p` (linear between sizes). */
function crossing(curve: { n: number; rate: number }[], p: number): number {
  if (!curve.length) return 1;
  if (curve[0].rate >= p) return curve[0].n;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (b.rate >= p) return b.rate === a.rate ? b.n : a.n + ((p - a.rate) / (b.rate - a.rate)) * (b.n - a.n);
  }
  return curve[curve.length - 1].n;
}

/** The band of win rates where a size "could go either way" around a threshold. */
export const spreadBand = (threshold: number): [number, number] => (threshold >= 0.9 ? [0.8, 0.975] : [0.25, 0.75]);

/** Half the range of sizes whose win rate is inside the band (from fully played sizes). */
export function spreadOf(points: { n: number; wins: number; runs: number }[], threshold = 0.5): number {
  const curve = monotone(points);
  const [lo, hi] = spreadBand(threshold);
  return Math.max(1, Math.round((crossing(curve, hi) - crossing(curve, lo)) / 2));
}

/** Sizes around an answer to measure the spread with. */
export function probesAround(n: number): number[] {
  const raw = n < 10 ? [n - 2, n - 1, n + 1, n + 2] : [0.8, 0.9, 1.1, 1.2].map((k) => Math.round(n * k));
  return [...new Set(raw.filter((m) => m >= 1 && m !== n))];
}

export interface SolveOptions {
  /** Battles per size (40). */
  runs?: number;
  quick?: number;
  maxN?: number;
  /** Share of battles the army must win (0.5). */
  threshold?: number;
  signal?: AbortSignal;
}

/** Solves the question whose battles are seeded by `key`. */
export async function solve(key: string, evaluate: Evaluate, onStep?: (s: Step, phase: "doubling" | "search" | "answer") => void, opts: SolveOptions = {}): Promise<SolverResult> {
  const runs = opts.runs ?? SOLVER.runs;
  const quick = Math.min(runs, opts.quick ?? SOLVER.quick);
  const maxN = opts.maxN ?? SOLVER.maxN;
  const threshold = opts.threshold ?? 0.5;
  const seeds = questionSeeds(key, runs);
  const wins = (count: number, w: number) => w >= winsNeeded(count, threshold);
  const steps: Step[] = [];
  const check = () => {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  const tryN = async (n: number, count: number, phase: "doubling" | "search") => {
    check();
    const ev = await evaluate(n, seeds.slice(0, count), settledBy(count, threshold));
    const step = { n, wins: ev.wins, runs: ev.runs };
    steps.push(step);
    onStep?.(step, phase);
    return wins(count, ev.wins);
  };
  // 1. Doubling.
  let lo = 0;
  let hi = -1;
  for (let n = 1; n <= maxN; n = n * 2) {
    if (await tryN(n, quick, "doubling")) {
      hi = n;
      break;
    }
    lo = n;
    if (n * 2 > maxN && n < maxN) {
      if (await tryN(maxN, quick, "doubling")) hi = maxN;
      else lo = maxN;
      break;
    }
  }
  if (hi < 0) return { answer: null, none: "above-cap", steps, spread: 0, wins: 0, runs: 0, wonSeed: null, lostSeed: null };
  // 2. Binary search with the full set of battles, between a size that lost and one that won.
  const confirmedHi = await tryN(hi, runs, "search");
  if (!confirmedHi) {
    // The quick look was lucky: keep doubling with the full set.
    lo = hi;
    hi = -1;
    for (let n = lo * 2; n <= maxN * 2; n *= 2) {
      const m = Math.min(n, maxN);
      if (await tryN(m, runs, "search")) { hi = m; break; }
      lo = m;
      if (m === maxN) break;
    }
    if (hi < 0) return { answer: null, none: "above-cap", steps, spread: 0, wins: 0, runs: 0, wonSeed: null, lostSeed: null };
  }
  const tol = (h: number) => (h <= 2000 ? 1 : Math.ceil(h * 0.005));
  while (hi - lo > tol(hi)) {
    const mid = Math.floor((lo + hi) / 2);
    if (await tryN(mid, runs, "search")) hi = mid;
    else lo = mid;
  }
  // 3. The answer on every battle, and a few sizes either side of it for the spread.
  check();
  const final = await evaluate(hi, seeds, () => false);
  const step = { n: hi, wins: final.wins, runs: final.runs };
  steps.push(step);
  onStep?.(step, "answer");
  const full = [step];
  for (const m of probesAround(hi)) {
    check();
    const ev = await evaluate(m, seeds, () => false);
    const st = { n: m, wins: ev.wins, runs: ev.runs };
    full.push(st);
    steps.push(st);
    onStep?.(st, "answer");
  }
  // The battle to show: a win near the middle of the wins (not the luckiest one).
  const wonSeed = final.wonSeeds.length ? final.wonSeeds[Math.floor(final.wonSeeds.length / 2)] : null;
  return { answer: hi, steps, spread: spreadOf(full, threshold), wins: final.wins, runs: final.runs, wonSeed, lostSeed: final.lostSeeds[0] ?? null };
}
