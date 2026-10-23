import { allFacts, baseOf, membersOf, type PdkCategory } from "./categories";
import { PDK_CELLS, PDK_SIZE, PDK_MIN_ANSWERS, type PdkDifficulty } from "./types";

/** Species ids that fit both a row and a column category, in dex order. */
export function cellAnswers(row: PdkCategory, col: PdkCategory): number[] {
  const a = membersOf(row);
  const b = membersOf(col);
  const out: number[] = [];
  for (const f of allFacts()) if (a[f.id] && b[f.id]) out.push(f.id);
  return out;
}

/** The nine cells' valid answers for a grid (row-major). */
export function gridAnswers(rows: PdkCategory[], cols: PdkCategory[]): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < PDK_SIZE; r++) for (let c = 0; c < PDK_SIZE; c++) out.push(cellAnswers(rows[r], cols[c]));
  return out;
}

/**
 * Does a set of cells have a system of distinct representatives, i.e. can each
 * be given a different Pokémon? Kuhn's augmenting-path matching. Returns the
 * assignment (cell -> id) or null.
 */
export function matchCells(cells: { cell: number; options: number[] }[], banned: ReadonlySet<number> = new Set()): Map<number, number> | null {
  // A form and its species are one Pokémon: they share a key (and `banned` holds species ids).
  const owner = new Map<number, { i: number; id: number }>();
  const tryCell = (i: number, seen: Set<number>): boolean => {
    for (const id of cells[i].options) {
      const key = baseOf(id);
      if (banned.has(key) || seen.has(key)) continue;
      seen.add(key);
      const j = owner.get(key);
      if (j === undefined || tryCell(j.i, seen)) {
        owner.set(key, { i, id });
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < cells.length; i++) if (!tryCell(i, new Set())) return null;
  return new Map([...owner.values()].map(({ i, id }) => [cells[i].cell, id]));
}

/** A grid is solvable when every cell has enough answers and nine different Pokémon can fill it. */
export function isSolvable(answers: number[][], difficulty: PdkDifficulty | number): boolean {
  const min = typeof difficulty === "number" ? difficulty : PDK_MIN_ANSWERS[difficulty];
  if (answers.length !== PDK_CELLS || answers.some((a) => a.length < Math.max(1, min))) return false;
  return matchCells(answers.map((options, cell) => ({ cell, options }))) !== null;
}

/** One full solution (cell -> id), for tests and the e2e. */
export function solveGrid(answers: number[][]): Map<number, number> | null {
  return matchCells(answers.map((options, cell) => ({ cell, options })));
}

/**
 * Soft-lock guard: would locking `id` into `cell` leave the other open cells
 * unsolvable (no distinct Pokémon for each)? `locked` maps cell -> id.
 */
export function softLockSafe(answers: number[][], locked: ReadonlyMap<number, number>, cell: number, id: number): boolean {
  const used = new Set<number>([...locked.values(), id].map(baseOf));
  const open = answers.map((options, c) => ({ cell: c, options })).filter((x) => x.cell !== cell && !locked.has(x.cell));
  return matchCells(open, used) !== null;
}
