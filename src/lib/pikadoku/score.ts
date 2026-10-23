import { PDK_CELLS } from "./types";

/**
 * The uniqueness score: the sum, over the nine cells, of the percentage of
 * players who picked the same Pokémon there. Lower is better. An empty cell
 * counts as 100. Computed on the server from the recorded answers.
 */

/** Percent (0-100, one decimal) of a cell's players who picked a Pokémon. */
export function rarityPct(picks: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((Math.min(picks, total) / total) * 1000) / 10;
}

/** The score from each cell's rarity (null = empty). */
export function uniquenessScore(pcts: readonly (number | null)[]): number {
  let sum = 0;
  for (let i = 0; i < PDK_CELLS; i++) sum += pcts[i] ?? 100;
  return Math.round(sum * 10) / 10;
}

export interface PdkBoardRow {
  name: string;
  solved: number;
  score: number;
  ms: number;
}

/** Most cells solved, then the lowest score, then the quicker time. */
export const betterResult = (a: Pick<PdkBoardRow, "solved" | "score" | "ms">, b: Pick<PdkBoardRow, "solved" | "score" | "ms">) => b.solved - a.solved || a.score - b.score || a.ms - b.ms;
