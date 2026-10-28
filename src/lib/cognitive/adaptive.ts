import type { Level } from "./types";

/**
 * Adaptive stepping for the reasoning, memory and spatial sections: start
 * in the middle-low, one level harder after a right answer, one easier after
 * a wrong one. The raw section score is the sum of the levels of the items
 * answered right, so a run that climbs earns more than one that stays low.
 */

export const START_LEVEL: Level = 2;

export function stepLevel(level: Level, correct: boolean): Level {
  const next = level + (correct ? 1 : -1);
  return Math.max(1, Math.min(5, next)) as Level;
}

export function rawScore(results: readonly { level: Level; correct: boolean }[]): number {
  return results.reduce((s, r) => s + (r.correct ? r.level : 0), 0);
}

/** The most a section of `items` items can score (2, 3, 4, 5, 5, 5…). */
export function maxRaw(items: number): number {
  let level: Level = START_LEVEL;
  let total = 0;
  for (let i = 0; i < items; i++) {
    total += level;
    level = stepLevel(level, true);
  }
  return total;
}
