import { wilson, Z95 } from "@/lib/battle/lab/stats";
import type { SideIndex } from "./parse";

/**
 * The analysis's numbers: a win chance with its 95% interval from each
 * turn's rollouts, the swing from one turn to the next, and which swings
 * are big enough to be more than the rollouts' own noise.
 */

export interface WinPoint {
  /** The state at the start of this turn; lastTurn + 1 is the result. */
  turn: number;
  /** Rollouts behind it (0: the actual result, exact). */
  n: number;
  /** Win chance for the viewer, 0 to 1 (a draw counts half). */
  p: number;
  lo: number;
  hi: number;
}

/** A turn's rollouts as the viewer's win chance. */
export function winPoint(turn: number, totals: { battles: number; wins: [number, number]; draws: number }, viewer: SideIndex): WinPoint {
  const n = totals.battles;
  const score = totals.wins[viewer] + totals.draws / 2;
  const i = wilson(score, n);
  return { turn, n, p: n ? score / n : 0.5, lo: i.lo, hi: i.hi };
}

/** The battle's actual result for the viewer: 1 won, 0 lost, ½ a draw. */
export function resultPoint(turn: number, winner: SideIndex | null, viewer: SideIndex): WinPoint {
  const p = winner === null ? 0.5 : winner === viewer ? 1 : 0;
  return { turn, n: 0, p, lo: p, hi: p };
}

/** The standard error of a point (0 for the exact result). */
export const standardError = (w: WinPoint) => (w.n ? Math.sqrt((w.p * (1 - w.p)) / w.n) : 0);

export interface Swing {
  /** The turn whose play moved the win chance (from the start of `turn` to the start of the next). */
  turn: number;
  before: WinPoint;
  after: WinPoint;
  delta: number;
  /** Bigger than the rollouts' noise at 95%. */
  significant: boolean;
}

/** Each turn's swing, from consecutive points (sorted by turn, the result last). */
export function swings(points: readonly WinPoint[]): Swing[] {
  const out: Swing[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const before = points[i];
    const after = points[i + 1];
    const delta = after.p - before.p;
    const noise = Z95 * Math.sqrt(standardError(before) ** 2 + standardError(after) ** 2);
    out.push({ turn: before.turn, before, after, delta, significant: Math.abs(delta) > noise && Math.abs(delta) >= 0.05 });
  }
  return out;
}

/** The biggest significant swings, at most `max`, in turn order. Fewer if fewer stand out from the noise. */
export function keySwings(all: readonly Swing[], max = 5): Swing[] {
  return all
    .filter((s) => s.significant)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, max)
    .sort((a, b) => a.turn - b.turn);
}

/** Share of damage rolls that knock out a Pokémon with `hp` HP left, times the move's accuracy (1 for moves that can't miss). */
export function koChance(rolls: readonly number[], hp: number, accuracy: number | true = true): number {
  if (!rolls.length || hp <= 0) return 0;
  const share = rolls.filter((r) => r >= hp).length / rolls.length;
  return share * (accuracy === true ? 1 : Math.max(0, Math.min(100, accuracy)) / 100);
}

/**
 * Rollouts for the next turn: what's left of the time budget spread over
 * the turns left at the pace so far, within [min, max].
 */
export function rolloutsFor(opts: { budgetMs: number; elapsedMs: number; turnsLeft: number; msPerRollout: number; min: number; max: number }): number {
  const { budgetMs, elapsedMs, turnsLeft, msPerRollout, min, max } = opts;
  if (!msPerRollout || turnsLeft <= 0) return max;
  const per = (budgetMs - elapsedMs) / turnsLeft / msPerRollout;
  return Math.max(min, Math.min(max, Math.round(per / 10) * 10));
}

/** "61%". */
export const pct = (p: number) => `${Math.round(p * 100)}%`;
