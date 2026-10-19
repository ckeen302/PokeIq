/**
 * Battle Lab statistics: what one battle reports, how a run's totals add up
 * (in any order, from any number of workers), and the maths on top: Wilson
 * score intervals, medians from the turn histogram and the one-line summary.
 * Pure; no simulator.
 */

/** 0: Side A won. 1: Side B won. 2: a draw (a tie, the turn limit, or a battle that broke). */
export type Outcome = 0 | 1 | 2;
export type Pair<T> = [T, T];

/** What one battle reports. */
export interface BattleRecord {
  outcome: Outcome;
  /** Stopped at the turn limit (a draw). */
  capped: boolean;
  /** The simulator gave up on it (a draw); should never happen. */
  broken: boolean;
  /** The turn it ended on. */
  turns: number;
  /** One-on-one only: the winner's HP left, percent. */
  winnerHp: number | null;
  /** KOs each side's Pokémon scored, by team slot. */
  kos: Pair<number[]>;
  /** The other side's Pokémon that fainted to something else: status, weather, hazards, recoil, their own moves. */
  otherKos: Pair<number>;
  /** A critical hit scored a KO for this side. */
  critKo: Pair<boolean>;
  /** This side missed a move. */
  missed: Pair<boolean>;
  /** Moves used, by name. */
  moves: Pair<Record<string, number>>;
  /** Choices the simulator refused (the strategy then picked another legal one). */
  refused: number;
  /** Smart decisions that fell back to a random legal choice (the damage calc failed). */
  fallbacks: number;
}

/** A run's totals so far. */
export interface LabTotals {
  battles: number;
  wins: Pair<number>;
  draws: number;
  /** Of the draws: stopped at the turn limit. */
  capped: number;
  /** Of the draws: battles the simulator gave up on. */
  broken: number;
  turnSum: number;
  /** turns[outcome][t]: battles with that outcome that ended on turn t. */
  turns: [number[], number[], number[]];
  /** One-on-one only, per winning side: the winner's HP left in tenths (bucket 9 is 90-100%). */
  winnerHp: Pair<number[]>;
  /** KOs each side's Pokémon scored, by team slot. */
  kos: Pair<number[]>;
  otherKos: Pair<number>;
  /** Battles this side won with a critical-hit KO along the way. */
  critWins: Pair<number>;
  /** Battles this side lost after missing a move. */
  missLosses: Pair<number>;
  moves: Pair<Record<string, number>>;
  refused: number;
  fallbacks: number;
}

export function emptyTotals(): LabTotals {
  return {
    battles: 0,
    wins: [0, 0],
    draws: 0,
    capped: 0,
    broken: 0,
    turnSum: 0,
    turns: [[], [], []],
    winnerHp: [Array(10).fill(0), Array(10).fill(0)],
    kos: [[], []],
    otherKos: [0, 0],
    critWins: [0, 0],
    missLosses: [0, 0],
    moves: [{}, {}],
    refused: 0,
    fallbacks: 0,
  };
}

function bump(list: number[], index: number, by = 1) {
  while (list.length <= index) list.push(0);
  list[index] += by;
}

function addInto(into: number[], from: readonly number[]) {
  from.forEach((n, i) => n && bump(into, i, n));
}

function addCounts(into: Record<string, number>, from: Readonly<Record<string, number>>) {
  for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
}

/** Adds one battle to the totals (in place). */
export function addRecord(t: LabTotals, r: BattleRecord): LabTotals {
  t.battles++;
  if (r.outcome === 2) t.draws++;
  else t.wins[r.outcome]++;
  if (r.capped) t.capped++;
  if (r.broken) t.broken++;
  t.turnSum += r.turns;
  bump(t.turns[r.outcome], r.turns);
  if (r.outcome !== 2 && r.winnerHp !== null) bump(t.winnerHp[r.outcome], Math.min(9, Math.floor(r.winnerHp / 10)));
  for (const s of [0, 1] as const) {
    addInto(t.kos[s], r.kos[s]);
    t.otherKos[s] += r.otherKos[s];
    addCounts(t.moves[s], r.moves[s]);
  }
  if (r.outcome !== 2) {
    const loser = r.outcome === 0 ? 1 : 0;
    if (r.critKo[r.outcome]) t.critWins[r.outcome]++;
    if (r.missed[loser]) t.missLosses[loser]++;
  }
  t.refused += r.refused;
  t.fallbacks += r.fallbacks;
  return t;
}

/** Adds `b` into `a` (in place). Totals add up the same in any order. */
export function mergeTotals(a: LabTotals, b: LabTotals): LabTotals {
  a.battles += b.battles;
  a.draws += b.draws;
  a.capped += b.capped;
  a.broken += b.broken;
  a.turnSum += b.turnSum;
  a.refused += b.refused;
  a.fallbacks += b.fallbacks;
  for (const o of [0, 1, 2] as const) addInto(a.turns[o], b.turns[o]);
  for (const s of [0, 1] as const) {
    a.wins[s] += b.wins[s];
    addInto(a.winnerHp[s], b.winnerHp[s]);
    addInto(a.kos[s], b.kos[s]);
    a.otherKos[s] += b.otherKos[s];
    a.critWins[s] += b.critWins[s];
    a.missLosses[s] += b.missLosses[s];
    addCounts(a.moves[s], b.moves[s]);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

export interface Interval {
  /** The observed proportion k / n. */
  p: number;
  lo: number;
  hi: number;
}

/** z for a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

/**
 * Wilson score interval for k successes in n trials: unlike the plain
 * normal approximation it stays inside [0, 1] and behaves near 0% and 100%.
 */
export function wilson(k: number, n: number, z = Z95): Interval {
  if (n <= 0) return { p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At 0% and 100% one end is exactly 0 or 1 (floating point would land a hair inside).
  return { p, lo: k <= 0 ? 0 : Math.max(0, center - half), hi: k >= n ? 1 : Math.min(1, center + half) };
}

/** Half the interval's width: the "±" figure. */
export const margin = (i: Interval) => (i.hi - i.lo) / 2;

/** All battles' turn counts, as one histogram. */
export function turnHistogram(t: LabTotals): number[] {
  const out: number[] = [];
  for (const o of [0, 1, 2] as const) addInto(out, t.turns[o]);
  return out;
}

/** The median of a histogram (index = value); the mean of the two middle values for an even count. */
export function histogramMedian(hist: readonly number[]): number {
  const n = hist.reduce((a, b) => a + (b || 0), 0);
  if (!n) return 0;
  const at = (rank: number) => {
    let seen = 0;
    for (let i = 0; i < hist.length; i++) {
      seen += hist[i] || 0;
      if (seen > rank) return i;
    }
    return hist.length - 1;
  };
  return n % 2 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

export const meanTurns = (t: LabTotals) => (t.battles ? t.turnSum / t.battles : 0);
export const medianTurns = (t: LabTotals) => histogramMedian(turnHistogram(t));

/** A side's most-used moves: name, uses and uses per battle. */
export function topMoves(t: LabTotals, side: 0 | 1, limit = 8): { move: string; uses: number; perBattle: number; share: number }[] {
  const entries = Object.entries(t.moves[side]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([move, uses]) => ({ move, uses, perBattle: t.battles ? uses / t.battles : 0, share: total ? uses / total : 0 }));
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** 0.6321 → "63.2%". */
export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const count = (n: number) => n.toLocaleString("en-US");
const turnsText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} turn${n === 1 ? "" : "s"}`;

/**
 * The plain-English line: who's favoured, by how much, over how many battles.
 * "Piplup wins 63.2% (± 0.9%) over 10,000 battles; median 4 turns."
 */
export function summaryLine(t: LabTotals, labels: Pair<string>): string {
  if (!t.battles) return "No battles yet.";
  const fav: 0 | 1 = t.wins[1] > t.wins[0] ? 1 : 0;
  const ci = wilson(t.wins[fav], t.battles);
  const battles = `${count(t.battles)} battle${t.battles === 1 ? "" : "s"}`;
  const draws = t.draws ? `, ${pct(t.draws / t.battles)} draws` : "";
  if (t.wins[0] === t.wins[1]) {
    return `Dead even: each side wins ${pct(ci.p)} (± ${pct(margin(ci))}) over ${battles}${draws}; median ${turnsText(medianTurns(t))}.`;
  }
  return `${labels[fav]} wins ${pct(ci.p)} (± ${pct(margin(ci))}) over ${battles}${draws}; median ${turnsText(medianTurns(t))}.`;
}
