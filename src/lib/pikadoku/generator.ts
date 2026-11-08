import { Rng } from "@/lib/rng";
import { allCategories, allFacts, categoryById, membersOf, type PdkCategory } from "./categories";
import { gridAnswers, isSolvable } from "./solve";
import { PDK_FAMILIES, PDK_MIN_ANSWERS, PDK_SIZE, type PdkBand, type PdkDifficulty, type PdkFamily } from "./types";

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
  // An unlucky seed retries on derived seeds, and a narrow family choice (only moves, say) widens its pool: first the
  // plain tier rule, then every tier of those families. A seed that dealt a grid before still deals the same one.
  for (const widen of [0, 1, 2] as const) {
    for (let round = 0; round < (widen ? 4 : 12); round++) {
      const ids = generateOnce(round ? `${seed}~${round}` : seed, opts, widen);
      if (ids) return ids;
    }
  }
  // Some choices can never fill a grid on their own (only regions: no Pokémon debuted in two; only abilities): add types.
  if (opts.families?.length && !opts.families.includes("types")) return generateGrid(seed, { ...opts, families: [...opts.families, "types"] });
  throw new Error(`No solvable grid found for ${opts.difficulty}:${seed}`);
}

function generateOnce(seed: string, opts: GenOptions, widen: 0 | 1 | 2): PdkGridIds | null {
  const rng = new Rng(`pikadoku:${opts.difficulty}:${seed}`);
  const families = opts.families?.length ? opts.families : PDK_FAMILIES;
  const inFamilies = allCategories().filter((c) => c.tier <= (widen === 2 ? 3 : MAX_TIER[opts.difficulty]) && families.includes(c.family));
  // Easy: types, regions and simple categories. Normal (and Unlimited's defaults): PokeDoku's mix. Expert: everything, trivia included.
  // A family choice the mix can't serve (say, only abilities) falls back to the plain tier rule.
  const styled = inFamilies.filter((c) => (opts.difficulty === "normal" ? c.classic : opts.difficulty === "easy" ? c.family !== "moves" && c.family !== "abilities" : true));
  const pool = styled.length >= 6 && !widen ? styled : inFamilies;
  // At most one move in PokeDoku's mix, when there is enough else to fill the grid.
  const oneMove = pool !== inFamilies && opts.difficulty === "normal" && pool.filter((c) => c.family !== "moves").length >= 5;
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
      if (oneMove && c.family === "moves" && picked.some((x) => x.family === "moves")) continue;
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
  return null;
}

/** Unlimited's rules for a board dealt from the categories the player ticked. */
export interface PickedOptions {
  /** Category ids the board may use. */
  allowed: readonly string[];
  /** Cells may have a single valid answer (else at least two). */
  allowSingle: boolean;
  /** Guaranteed solvable: nine different Pokémon can fill the board. */
  guard: boolean;
  band: PdkBand;
}
export type PickedResult = { ok: true; ids: PdkGridIds } | { ok: false; reason: "few" | "none" };

/** Easy: every cell has plenty of answers. Hard: a few cells have only a handful. */
export const BAND_RULES = { easyMin: PDK_MIN_ANSWERS.easy, hardSmall: 6, hardCells: 3 } as const;
/** Bounded work, so a choice that can't make a board answers quickly instead of hanging. */
const ROW_TRIES = 600;
const COL_TRIES = 10;

let speciesIds: number[] | null = null;
const idsOf = new Map<string, number[]>();
/** A category's members as a list (for quick pair counts). */
function memberList(c: PdkCategory): number[] {
  let l = idsOf.get(c.id);
  if (!l) {
    speciesIds ??= allFacts().map((f) => f.id);
    const m = membersOf(c);
    idsOf.set(c.id, (l = speciesIds.filter((id) => m[id])));
  }
  return l;
}
function pairCount(a: PdkCategory, b: PdkCategory): number {
  const [small, big] = memberList(a).length <= memberList(b).length ? [a, b] : [b, a];
  const m = membersOf(big);
  let n = 0;
  for (const id of memberList(small)) n += m[id];
  return n;
}

/** Three categories of different groups (and none of `taken`), a family first so a big family (moves) doesn't crowd the rest out. */
function drawThree(rng: Rng, pool: PdkCategory[], taken: ReadonlySet<string>): PdkCategory[] | null {
  const byFamily = new Map<PdkFamily, PdkCategory[]>();
  for (const c of pool) if (!taken.has(c.group)) byFamily.set(c.family, [...(byFamily.get(c.family) ?? []), c]);
  const fams = [...byFamily.keys()];
  if (!fams.length) return null;
  const picked: PdkCategory[] = [];
  const groups = new Set<string>();
  for (let guard = 0; picked.length < PDK_SIZE && guard < 40; guard++) {
    const c = rng.pick(byFamily.get(rng.pick(fams))!);
    if (groups.has(c.group)) continue;
    groups.add(c.group);
    picked.push(c);
  }
  return picked.length === PDK_SIZE ? picked : null;
}

/**
 * Unlimited's board from the player's own categories, seeded: the same seed
 * and settings always deal the same board. Every cell has at least two valid
 * answers (one with single answers allowed, eight on Easy, as in the Easy daily); Hard wants a few
 * cells with only a handful; the guard also asks for nine different Pokémon
 * that fill it. Gives up after a bounded number of tries and says why.
 */
export function generatePickedGrid(seed: string, opts: PickedOptions): PickedResult {
  const pool = [...new Set(opts.allowed)].map((id) => categoryById(id)).filter((c): c is PdkCategory => !!c);
  if (new Set(pool.map((c) => c.group)).size < PDK_SIZE * 2) return { ok: false, reason: "few" };
  const rng = new Rng(`pikadoku:pick:${opts.band}:${seed}`);
  const min = opts.band === "easy" ? BAND_RULES.easyMin : opts.allowSingle ? 1 : 2;
  const manyFamilies = new Set(pool.map((c) => c.family)).size > 1;
  const counts = new Map<string, number>();
  const count = (a: PdkCategory, b: PdkCategory) => {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    let n = counts.get(key);
    if (n === undefined) counts.set(key, (n = pairCount(a, b)));
    return n;
  };
  for (let t = 0; t < ROW_TRIES; t++) {
    const rows = drawThree(rng, pool, new Set());
    if (!rows) continue;
    const taken = new Set(rows.map((c) => c.group));
    // Only columns that give every row enough answers.
    const fits = pool.filter((c) => !taken.has(c.group) && rows.every((r) => count(r, c) >= min));
    if (new Set(fits.map((c) => c.group)).size < PDK_SIZE) continue;
    for (let k = 0; k < COL_TRIES; k++) {
      const cols = drawThree(rng, fits, taken);
      if (!cols) continue;
      if (manyFamilies && new Set([...rows, ...cols].map((c) => c.family)).size < 2) continue;
      const answers = gridAnswers(rows, cols);
      if (opts.band === "hard" && answers.filter((a) => a.length <= BAND_RULES.hardSmall).length < BAND_RULES.hardCells) continue;
      if (opts.guard ? !isSolvable(answers, min) : answers.some((a) => a.length < min)) continue;
      return { ok: true, ids: { rows: rows.map((c) => c.id), cols: cols.map((c) => c.id) } };
    }
  }
  return { ok: false, reason: "none" };
}

/** Plain words for a choice that can't make a board, with what to widen. */
export function noBoardMessage(reason: "few" | "none", opts: { allowSingle: boolean; band: PdkBand }): string {
  if (reason === "few") return "Those categories can't fill a board on their own. Tick more categories, in more groups.";
  const tips = ["tick more categories"];
  if (opts.band !== "normal") tips.push("try Normal difficulty");
  if (!opts.allowSingle && opts.band !== "easy") tips.push("allow one-answer cells");
  const list = tips.length > 1 ? `${tips.slice(0, -1).join(", ")} or ${tips.at(-1)}` : tips[0];
  return `No board fits those settings. To widen them, ${list}.`;
}
