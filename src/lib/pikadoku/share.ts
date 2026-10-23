import { PDK_CELLS } from "./types";

/**
 * Pikadoku's share card: each cell's colour is how rare the pick was (the
 * share of players who chose that Pokémon there). Colours only, never a
 * Pokémon, so a daily's result can't spoil the puzzle.
 *
 *   🟪 under 1%   🟦 under 10%   🟩 under 25%   🟨 25% and over   ⬛ wrong or empty
 */
export type RarityLetter = "p" | "b" | "g" | "y" | "x";

export const RARITY_LETTERS = "pbgyx";
export const RARITY_EMOJI: Record<RarityLetter, string> = { p: "🟪", b: "🟦", g: "🟩", y: "🟨", x: "⬛" };
export const RARITY_LABEL: Record<RarityLetter, string> = { p: "under 1%", b: "under 10%", g: "under 25%", y: "25% or more", x: "wrong or empty" };

/** The colour of one cell. `pct` is the percent of players who picked it (null when rarity is off). */
export function rarityLetter(pct: number | null | undefined, solved: boolean): RarityLetter {
  if (!solved) return "x";
  // A solved cell with no rarity data (the board is off) is shown as the middle colour.
  if (pct === null || pct === undefined) return "g";
  if (pct < 1) return "p";
  if (pct < 10) return "b";
  if (pct < 25) return "g";
  return "y";
}

/** Nine letters, row-major, from the cells that were filled and their rarities. */
export function rarityGrid(filled: (i: number) => boolean, pcts: readonly (number | null | undefined)[] | null): string {
  return Array.from({ length: PDK_CELLS }, (_, i) => rarityLetter(pcts?.[i], filled(i))).join("");
}

/** Three lines of emoji for nine letters. */
export function rarityLines(grid: string): string[] {
  const cells = [...grid.padEnd(PDK_CELLS, "x").slice(0, PDK_CELLS)].map((c) => RARITY_EMOJI[c as RarityLetter] ?? RARITY_EMOJI.x);
  return [0, 1, 2].map((r) => cells.slice(r * 3, r * 3 + 3).join(""));
}
