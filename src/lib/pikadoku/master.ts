import { categoryById } from "./categories";
import { gridAnswers, isSolvable } from "./solve";
import { PDK_CELLS, PDK_SIZE } from "./types";

/**
 * Hand-made "Master" dailies: six categories picked by an admin for a date.
 * Pure helpers shared by the admin editor's checks, the server and the tests.
 */

export interface MasterGrid {
  date: string;
  rows: string[];
  cols: string[];
  /** The admin who made it, shown as "Master Puzzle by <name>". */
  by: string;
}

export interface MasterCheck {
  /** Safe to schedule: six different categories and a grid nine different Pokémon can fill. */
  ok: boolean;
  errors: string[];
  /** Valid answers per cell (row-major), when all six categories exist. */
  counts: number[] | null;
  solvable: boolean;
}

/** Fewest valid answers a Master cell may have: every daily cell has more than one answer. */
export const MASTER_MIN_ANSWERS = 2;

/** Checks six category ids with the same solvability and matching test the generator uses. Every cell needs at least two answers. */
export function checkMaster(rows: readonly string[], cols: readonly string[]): MasterCheck {
  const errors: string[] = [];
  if (rows.length !== PDK_SIZE || cols.length !== PDK_SIZE) errors.push(`Pick ${PDK_SIZE} row categories and ${PDK_SIZE} column categories.`);
  const all = [...rows, ...cols];
  const cats = all.map((id) => categoryById(id));
  const unknown = all.filter((_, i) => !cats[i]);
  if (unknown.length) errors.push(`Unknown categories: ${unknown.join(", ")}.`);
  if (new Set(all).size !== all.length) errors.push("Each category can be used once.");
  if (errors.length) return { ok: false, errors, counts: null, solvable: false };
  const answers = gridAnswers(
    cats.slice(0, PDK_SIZE) as NonNullable<(typeof cats)[number]>[],
    cats.slice(PDK_SIZE) as NonNullable<(typeof cats)[number]>[]
  );
  const counts = answers.map((a) => a.length);
  const empty = counts.map((n, i) => (n === 0 ? i : -1)).filter((i) => i >= 0);
  if (empty.length) errors.push(`Cell${empty.length > 1 ? "s" : ""} ${empty.map((i) => i + 1).join(", ")} ${empty.length > 1 ? "have" : "has"} no valid Pokémon.`);
  const single = counts.map((n, i) => (n === 1 ? i : -1)).filter((i) => i >= 0);
  if (single.length) errors.push(`Cell${single.length > 1 ? "s" : ""} ${single.map((i) => i + 1).join(", ")} ${single.length > 1 ? "have" : "has"} only one valid Pokémon: every cell needs at least ${MASTER_MIN_ANSWERS}.`);
  const solvable = counts.length === PDK_CELLS && isSolvable(answers, 1);
  if (!empty.length && !solvable) errors.push("No way to fill the grid with nine different Pokémon.");
  return { ok: errors.length === 0, errors, counts, solvable };
}

export const MASTER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
