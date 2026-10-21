import { DLE_PANEL_COLUMNS, panelMisfit, type DlePanelColumn, type DlePanelTraits, type DleTraits } from "./dle-compare";
import type { CellStatus, DleDexRow, DleRow } from "./dle-types";

/**
 * The Pokédex beside the Pokédle board works like Wordle's keyboard: it
 * greys out for you whatever the generation and type clues already rule
 * out, and nothing more. Height, weight, colour and stage clues are yours
 * to apply (the Pokédex doesn't know those values), by crossing Pokémon
 * off by hand.
 */

/** A guess's generation and type clues: all the Pokédex reads from a board row. */
export interface DexClue {
  guessId: number;
  /** Only the columns the game shows. */
  statuses: Partial<Record<DlePanelColumn, CellStatus>>;
}

export const dexTraits = (row: DleDexRow): DlePanelTraits => ({ gen: row[2], type1: row[3], type2: row[4] });

/** The clues the Pokédex reads from a board's rows. */
export function dexClues(rows: readonly Pick<DleRow, "id" | "cells">[]): DexClue[] {
  return rows.map((r) => ({
    guessId: r.id,
    statuses: Object.fromEntries(DLE_PANEL_COLUMNS.flatMap((c) => (r.cells[c] ? [[c, r.cells[c].status]] : []))) as DexClue["statuses"],
  }));
}

/**
 * The Pokédex numbers in `rows` that some clue rules out: were one of them
 * the answer, a guess would have got a different generation or type clue.
 * Guesses missing from `rows` (none, in practice) rule nothing out.
 */
export function ruledOut(rows: readonly DleDexRow[], clues: readonly DexClue[], close = true): Set<number> {
  const byId = new Map(rows.map((r) => [r[0], r]));
  const guesses = clues.flatMap((c) => {
    const row = byId.get(c.guessId);
    return row ? [{ traits: dexTraits(row), statuses: c.statuses }] : [];
  });
  const out = new Set<number>();
  for (const row of rows) {
    const t = dexTraits(row);
    if (guesses.some((g) => panelMisfit(g.traits, g.statuses, t, close) !== null)) out.add(row[0]);
  }
  return out;
}

/** Every attribute the clues compare, from a Full Pokédex row; null for a lighter level's row, which doesn't have them. */
export function dexFullTraits(row: DleDexRow): DleTraits | null {
  const [, , gen, type1, type2, stage, color, height, weight] = row;
  if (stage === undefined || color === undefined || height === undefined || weight === undefined) return null;
  return { gen, type1, type2, stage, color, height, weight };
}
