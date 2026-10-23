import { Rng } from "@/lib/rng";
import { allCategories, categoryById, type PdkCategory } from "./categories";
import { gridAnswers, isSolvable } from "./solve";
import { PDK_FAMILIES, PDK_MIN_ANSWERS, PDK_SIZE, type PdkDifficulty, type PdkFamily } from "./types";

export interface PdkGrid {
  rows: PdkCategory[];
  cols: PdkCategory[];
  answers: number[][];
}
export interface PdkGridIds {
  rows: string[];
  cols: string[];
}

const MAX_TIER: Record<PdkDifficulty, number> = { easy: 1, normal: 2, expert: 3 };
const TRIES = 600;

export interface GenOptions {
  difficulty: PdkDifficulty;
  families?: readonly PdkFamily[];
  /** Cells may have a single valid answer (Unlimited). */
  allowSingle?: boolean;
}

/** Builds a grid from category ids (the stored dailies). */
export function gridFromIds(ids: PdkGridIds): PdkGrid {
  const rows = ids.rows.map((id) => categoryById(id)!);
  const cols = ids.cols.map((id) => categoryById(id)!);
  return { rows, cols, answers: gridAnswers(rows, cols) };
}

/**
 * A seeded, provably solvable grid: three rows, three columns, every cell
 * with enough answers and a matching that gives nine different Pokémon.
 */
export function generateGrid(seed: string, opts: GenOptions): PdkGridIds {
  const rng = new Rng(`pikadoku:${opts.difficulty}:${seed}`);
  const families = opts.families?.length ? opts.families : PDK_FAMILIES;
  const pool = allCategories().filter((c) => c.tier <= MAX_TIER[opts.difficulty] && families.includes(c.family));
  const byFamily = new Map<PdkFamily, PdkCategory[]>();
  for (const c of pool) byFamily.set(c.family, [...(byFamily.get(c.family) ?? []), c]);
  const fams = [...byFamily.keys()];
  if (!fams.length) throw new Error("No categories for those settings.");
  const min = opts.allowSingle ? 1 : PDK_MIN_ANSWERS[opts.difficulty];
  for (let t = 0; t < TRIES; t++) {
    const picked: PdkCategory[] = [];
    const groups = new Set<string>();
    for (let guard = 0; picked.length < PDK_SIZE * 2 && guard < 60; guard++) {
      const c = rng.pick(byFamily.get(rng.pick(fams))!);
      if (groups.has(c.group)) continue;
      groups.add(c.group);
      picked.push(c);
    }
    if (picked.length < PDK_SIZE * 2) continue;
    if (fams.length > 1 && new Set(picked.map((c) => c.family)).size < 2) continue;
    const rows = picked.slice(0, PDK_SIZE);
    const cols = picked.slice(PDK_SIZE);
    const answers = gridAnswers(rows, cols);
    if (!isSolvable(answers, min)) continue;
    return { rows: rows.map((c) => c.id), cols: cols.map((c) => c.id) };
  }
  throw new Error(`No solvable grid found for ${opts.difficulty}:${seed}`);
}
