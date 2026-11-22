import { draw, shuffled } from "./rng";

/**
 * Bracket mode: a single-elimination bracket. Entrants are seeded 1…n; the bracket is the next power of two, laid out
 * the standard way (1 meets the lowest seed, 1 and 2 can only meet in the final), and the top seeds get the byes when
 * n isn't a power of two. The picks, in play order (round by round, top to bottom, byes skipped), are the whole
 * result: 0 for the top entrant of a match, 1 for the bottom one.
 */

export type Seeding = "random" | "dex" | "bst" | "manual";
export const SEEDINGS: readonly Seeding[] = ["random", "dex", "bst", "manual"];
export const BRACKET_SIZES = [8, 16, 32, 64, 128] as const;
/** 0 means the whole template. */
export type BracketSize = (typeof BRACKET_SIZES)[number] | 0;

export interface Match {
  /** Entrant keys; null for a bye (or a side not decided yet). */
  a: string | null;
  b: string | null;
  winner: string | null;
  bye: boolean;
}

export interface Resolved {
  rounds: Match[][];
  /** The match to play now, or null when the bracket is done. */
  current: { round: number; index: number } | null;
  champion: string | null;
  /** Per round: picks made and picks needed (byes don't count). */
  progress: { done: number; total: number }[];
  /** How many picks are needed in all. */
  totalPicks: number;
}

export const nextPow2 = (n: number) => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)));

/** The seed (1-based) at each position of a bracket of `size` (a power of two): [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
export function seedPositions(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export interface EntrantSource {
  k: string;
  d: number;
  b: number;
}

/**
 * The entrants in seed order. A bracket smaller than the pool draws its entrants at random (from `seed`); then the
 * seeding orders them: at random, by National Dex number, by base stat total (highest first), or as the player set
 * them (`manual`, keys in order; anything missing goes after, in dex order).
 */
export function seedEntrants(pool: readonly EntrantSource[], size: BracketSize, seeding: Seeding, seed: string, manual?: readonly string[]): string[] {
  const n = size === 0 ? pool.length : Math.min(size, pool.length);
  const chosen = n < pool.length ? draw(pool, n, `${seed}:entrants`) : pool.slice();
  const dexOrder = (a: EntrantSource, b: EntrantSource) => a.d - b.d || pool.indexOf(a) - pool.indexOf(b);
  switch (seeding) {
    case "random":
      return shuffled(chosen.sort(dexOrder), `${seed}:seeds`).map((e) => e.k);
    case "bst":
      return chosen.sort((a, b) => b.b - a.b || dexOrder(a, b)).map((e) => e.k);
    case "manual": {
      const keys = new Set(chosen.map((e) => e.k));
      const first = (manual ?? []).filter((k) => keys.has(k));
      const firstSet = new Set(first);
      return [...first, ...chosen.sort(dexOrder).map((e) => e.k).filter((k) => !firstSet.has(k))];
    }
    default:
      return chosen.sort(dexOrder).map((e) => e.k);
  }
}

/** The bracket with the picks so far applied (picks past the end, or for no match, are ignored). */
export function resolveBracket(entrants: readonly string[], picks: readonly number[]): Resolved {
  const size = nextPow2(Math.max(2, entrants.length));
  const positions = seedPositions(size).map((s) => (s <= entrants.length ? entrants[s - 1] : null));
  const rounds: Match[][] = [];
  let sides: (string | null)[] = positions;
  let p = 0;
  let current: Resolved["current"] = null;
  const progress: Resolved["progress"] = [];
  let totalPicks = 0;
  let r = 0;
  // A side is "pending" (undefined) while the match feeding it is undecided.
  let pending: boolean[] = positions.map(() => false);
  while (sides.length > 1) {
    const round: Match[] = [];
    const next: (string | null)[] = [];
    const nextPending: boolean[] = [];
    let done = 0;
    let total = 0;
    for (let i = 0; i < sides.length; i += 2) {
      const a = sides[i], b = sides[i + 1];
      const pa = pending[i], pb = pending[i + 1];
      const bye = !pa && !pb && (a === null || b === null);
      const m: Match = { a, b, winner: null, bye };
      if (bye) m.winner = a ?? b;
      else {
        total++;
        if (!pa && !pb) {
          if (p < picks.length) {
            m.winner = picks[p] === 1 ? b : a;
            p++;
            done++;
          } else if (!current) current = { round: r, index: round.length };
        }
      }
      round.push(m);
      next.push(m.winner);
      nextPending.push(m.winner === null && !(m.bye && a === null && b === null));
    }
    rounds.push(round);
    progress.push({ done, total });
    totalPicks += total;
    sides = next;
    pending = nextPending;
    r++;
  }
  const last = rounds[rounds.length - 1]?.[0];
  return { rounds, current, champion: last?.winner ?? null, progress, totalPicks };
}

/** Picks that still apply (a pick list longer than the bracket needs is cut). */
export function clampPicks(entrants: readonly string[], picks: readonly number[]): number[] {
  const { totalPicks } = resolveBracket(entrants, []);
  return picks.slice(0, totalPicks).map((x) => (x === 1 ? 1 : 0));
}

/** Round names from the end: the final, the semifinals, the quarterfinals, then "Round of n". */
export function roundLabel(roundIndex: number, roundCount: number): { kind: "final" | "semi" | "quarter" | "round"; n: number } {
  const fromEnd = roundCount - 1 - roundIndex;
  if (fromEnd === 0) return { kind: "final", n: 2 };
  if (fromEnd === 1) return { kind: "semi", n: 4 };
  if (fromEnd === 2) return { kind: "quarter", n: 8 };
  return { kind: "round", n: 2 ** (fromEnd + 1) };
}

/** The order each entrant went out in, for a full ranking: champion first, then the runner-up, then by round lost. */
export function finishingOrder(res: Resolved): string[] {
  if (!res.champion) return [];
  const out: string[] = [res.champion];
  for (let r = res.rounds.length - 1; r >= 0; r--) {
    for (const m of res.rounds[r]) {
      if (m.bye || !m.winner) continue;
      const loser = m.winner === m.a ? m.b : m.a;
      if (loser) out.push(loser);
    }
  }
  return out;
}
