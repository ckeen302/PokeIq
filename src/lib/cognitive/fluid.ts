import { Rng } from "@/lib/rng";
import { BALLS, MON_IDS, ROTS, TYPES, cell } from "./materials";
import { cellKey, type BallKind, type Cell, type Level, type MatrixItem, type NumberItem, type Rot, type TypeName } from "./types";

/**
 * Fluid reasoning items, generated from rule templates with a seeded RNG:
 * 3×3 matrices whose last cell is missing (type cycles, count progressions,
 * rotation, size, Poké Ball colours, dot-pattern OR / XOR) and number
 * sequences. Each level draws from its own templates, so the adaptive test
 * can step up and down. Every distractor is "one rule off": the right cell
 * with a single attribute changed, or the result of a near-miss rule.
 */

export const MATRIX_OPTIONS = 6;
const MATRIX_MS = 60_000;
const NUMBER_MS = 45_000;

const nextRot = (r: Rot, steps = 1): Rot => ROTS[(ROTS.indexOf(r) + steps + 4) % 4];

/** Six options: the right cell plus five distinct one-off distractors, shuffled. Returns null if there aren't enough. */
function finish(rng: Rng, id: string, level: Level, rule: string, cells: Cell[], correct: Cell, candidates: Cell[]): MatrixItem | null {
  const right = cellKey(correct);
  const seen = new Set<string>([right]);
  const distractors: Cell[] = [];
  for (const c of rng.shuffle(candidates)) {
    const k = cellKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    distractors.push(c);
    if (distractors.length === MATRIX_OPTIONS - 1) break;
  }
  if (distractors.length < MATRIX_OPTIONS - 1) return null;
  const options = rng.shuffle([correct, ...distractors]);
  return { kind: "matrix", id, level, timeMs: MATRIX_MS, rule, cells: [...cells.slice(0, 8), { k: "blank" }], options, answer: options.findIndex((o) => cellKey(o) === right) };
}

/** Every one-attribute variation of a "mon" cell, drawn from the ids / rotations in play. */
function monVariants(c: Extract<Cell, { k: "mon" }>, ids: readonly number[]): Cell[] {
  const out: Cell[] = [];
  for (const id of ids) if (id !== c.id) out.push({ ...c, id });
  out.push({ ...c, rot: nextRot(c.rot) }, { ...c, rot: nextRot(c.rot, -1) }, { ...c, rot: nextRot(c.rot, 2) });
  for (const size of [1, 2, 3] as const) if (size !== c.size) out.push({ ...c, size });
  for (const n of [1, 2, 3] as const) if (n !== c.n) out.push({ ...c, n });
  return out;
}

function typeVariants(c: Extract<Cell, { k: "type" }>, types: readonly TypeName[]): Cell[] {
  const out: Cell[] = [];
  for (const t of types) if (t !== c.t) out.push({ ...c, t });
  for (const n of [1, 2, 3, 4] as const) if (n !== c.n) out.push({ ...c, n });
  // Both off at once, for when one-off runs short.
  for (const t of types) for (const n of [1, 2, 3, 4] as const) if (t !== c.t && n !== c.n) out.push({ k: "type", t, n });
  return out;
}

function ballVariants(c: Extract<Cell, { k: "ball" }>, balls: readonly BallKind[]): Cell[] {
  const out: Cell[] = [];
  for (const b of balls) if (b !== c.b) out.push({ ...c, b });
  for (const n of [1, 2, 3, 4] as const) if (n !== c.n) out.push({ ...c, n });
  out.push({ ...c, rot: nextRot(c.rot) }, { ...c, rot: nextRot(c.rot, -1) });
  for (const b of balls) for (const n of [1, 2, 3, 4] as const) if (b !== c.b && n !== c.n) out.push({ k: "ball", b, n, rot: c.rot });
  return out;
}

// ---------------------------------------------------------------------------
// Matrix templates
// ---------------------------------------------------------------------------

type Template = (rng: Rng, id: string, level: Level) => MatrixItem | null;

/** Each row one Pokémon; the count grows 1, 2, 3 across the row. */
const countRows: Template = (rng, id, level) => {
  const ids = rng.sample(MON_IDS, 3);
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(cell.mon(ids[r], 0, 1, (c + 1) as 1 | 2 | 3));
  return finish(rng, id, level, "count grows across each row", cells, cells[8], monVariants(cells[8] as Extract<Cell, { k: "mon" }>, ids));
};

/** Three types in a Latin square: every row and column has each once. */
const latinType: Template = (rng, id, level) => {
  const types = rng.sample(TYPES, 3);
  const shift = rng.int(0, 2);
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(cell.type(types[(r + c + shift) % 3], 1));
  return finish(rng, id, level, "each type once per row and column", cells, cells[8], typeVariants(cells[8] as Extract<Cell, { k: "type" }>, types));
};

/** Poké Ball kinds in a Latin square, with the count fixed per row. */
const latinBall: Template = (rng, id, level) => {
  const balls = rng.sample(BALLS, 3);
  const counts = rng.shuffle([1, 2, 3] as const);
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(cell.ball(balls[(r + c) % 3], counts[r]));
  return finish(rng, id, level, "each ball once per row and column; count fixed per row", cells, cells[8], ballVariants(cells[8] as Extract<Cell, { k: "ball" }>, balls));
};

/** Each row one Pokémon, turning a quarter turn per column. */
const rotate: Template = (rng, id, level) => {
  const ids = rng.sample(MON_IDS, 3);
  const dir = rng.chance(0.5) ? 1 : -1;
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) {
    const start = rng.pick(ROTS);
    for (let c = 0; c < 3; c++) cells.push(cell.mon(ids[r], nextRot(start, dir * c), 2, 1));
  }
  return finish(rng, id, level, `a quarter turn ${dir > 0 ? "clockwise" : "anticlockwise"} per column`, cells, cells[8], monVariants(cells[8] as Extract<Cell, { k: "mon" }>, ids));
};

/** Rotation per column and size per row, on one Pokémon per row. */
const rotateSize: Template = (rng, id, level) => {
  const ids = rng.sample(MON_IDS, 3);
  const sizes = rng.shuffle([1, 2, 3] as const);
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) {
    const start = rng.pick(ROTS);
    for (let c = 0; c < 3; c++) cells.push(cell.mon(ids[r], nextRot(start, c), sizes[r], 1));
  }
  return finish(rng, id, level, "a quarter turn per column; size fixed per row", cells, cells[8], monVariants(cells[8] as Extract<Cell, { k: "mon" }>, ids));
};

/** Types in a Latin square and counts in another: both must hold. */
const latinTypeCount: Template = (rng, id, level) => {
  const types = rng.sample(TYPES, 3);
  const counts = rng.shuffle([1, 2, 3] as const);
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(cell.type(types[(r + c) % 3], counts[(r + 2 * c) % 3]));
  return finish(rng, id, level, "each type and each count once per row and column", cells, cells[8], typeVariants(cells[8] as Extract<Cell, { k: "type" }>, types));
};

/** Pokémon in a Latin square, turning per column, count by row. */
const monLatinRotCount: Template = (rng, id, level) => {
  const ids = rng.sample(MON_IDS, 3);
  const counts = rng.shuffle([1, 2, 3] as const);
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(cell.mon(ids[(r + c) % 3], nextRot(0, c), 1, counts[r]));
  return finish(rng, id, level, "each Pokémon once per row and column; a quarter turn per column; count fixed per row", cells, cells[8], monVariants(cells[8] as Extract<Cell, { k: "mon" }>, ids));
};

const popcount = (b: number) => b.toString(2).split("1").length - 1;

/** Dot patterns: the third column combines the first two (OR, XOR or AND), row by row. */
function dotsTemplate(op: "or" | "xor" | "and", byColumn: boolean): Template {
  return (rng, id, level) => {
    const apply = (a: number, b: number) => (op === "or" ? a | b : op === "xor" ? a ^ b : a & b) & 0x1ff;
    const pairs: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      let a = 0;
      let b = 0;
      let out = 0;
      // Patterns with something to combine: 2–5 dots each, overlapping somewhere, a result that is neither input.
      for (let tries = 0; tries < 50; tries++) {
        a = rng.int(1, 0x1ff);
        b = rng.int(1, 0x1ff);
        out = apply(a, b);
        if (popcount(a) >= 2 && popcount(a) <= 5 && popcount(b) >= 2 && popcount(b) <= 5 && (a & b) !== 0 && out !== a && out !== b && out !== 0) break;
      }
      pairs.push([a, b]);
    }
    const grid: number[][] = pairs.map(([a, b]) => [a, b, apply(a, b)]);
    const cells: Cell[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(cell.dots(byColumn ? grid[c][r] : grid[r][c]));
    const [a, b] = pairs[2];
    const correct = cells[8];
    const candidates: Cell[] = [cell.dots(a | b), cell.dots(a ^ b), cell.dots(a & b), cell.dots(a), cell.dots(b)];
    for (let bit = 0; bit < 9; bit++) candidates.push(cell.dots((correct as { bits: number }).bits ^ (1 << bit)));
    return finish(rng, id, level, `${byColumn ? "bottom row" : "right column"} = ${op.toUpperCase()} of the other two`, cells, correct, candidates);
  };
}

const TEMPLATES: Record<Level, Template[]> = {
  1: [countRows, latinType],
  2: [latinBall, rotate, latinType],
  3: [rotateSize, dotsTemplate("or", false), latinBall],
  4: [latinTypeCount, dotsTemplate("xor", false), rotateSize],
  5: [monLatinRotCount, dotsTemplate("xor", true), dotsTemplate("and", true), latinTypeCount],
};

export const MATRIX_TEMPLATE_NAMES = ["countRows", "latinType", "latinBall", "rotate", "rotateSize", "latinTypeCount", "monLatinRotCount", "dotsOr", "dotsXor", "dotsXorCol", "dotsAndCol"] as const;

/** A matrix item at `level` from a seed; retakes with another seed draw different material and rules. */
export function matrixItem(seed: string, level: Level): MatrixItem {
  const rng = new Rng(`matrix:${seed}`);
  const templates = TEMPLATES[level];
  for (let attempt = 0; attempt < 20; attempt++) {
    const t = templates[(rng.int(0, templates.length - 1) + attempt) % templates.length];
    const item = t(rng, `mx:${seed}`, level);
    if (item) return item;
  }
  throw new Error(`no matrix item for ${seed} at level ${level}`);
}

// ---------------------------------------------------------------------------
// Number sequences
// ---------------------------------------------------------------------------

type Seq = { terms: number[]; next: number; rule: string; near: number[] };

function sequence(rng: Rng, level: Level): Seq {
  const pickGen = rng.int(0, 1);
  switch (level) {
    case 1: {
      const d = rng.int(2, 9);
      const a = rng.int(1, 20);
      const terms = [0, 1, 2, 3].map((i) => a + d * i);
      return { terms, next: a + 4 * d, rule: `+${d}`, near: [a + 4 * d + 1, a + 4 * d - 1, a + 3 * d + d + d, a + 5 * d, a + 4 * d - 2] };
    }
    case 2: {
      if (pickGen === 0) {
        const a = rng.int(1, 6);
        const terms = [0, 1, 2, 3].map((i) => a * 2 ** i);
        return { terms, next: a * 16, rule: "×2", near: [a * 16 + a, a * 8 + 8, a * 12, a * 14, a * 16 - 1] };
      }
      const a = rng.int(10, 40);
      const up = rng.int(5, 12);
      const down = rng.int(1, 4);
      const terms = [a, a + up, a + up - down, a + 2 * up - down, a + 2 * up - 2 * down];
      return { terms, next: a + 3 * up - 2 * down, rule: `+${up}, −${down}`, near: [a + 3 * up - 3 * down, a + 2 * up - 3 * down, a + 3 * up - 2 * down + 1, a + 3 * up - down, a + 2 * up - 2 * down + up + up] };
    }
    case 3: {
      if (pickGen === 0) {
        const s = rng.int(1, 5);
        const terms = [0, 1, 2, 3].map((i) => (s + i) ** 2);
        const n = (s + 4) ** 2;
        return { terms, next: n, rule: "squares", near: [n - 1, n + 1, n - 2 * (s + 4) + 1 + 2 * (s + 3) + 1, (s + 3) ** 2 + 2 * (s + 3) + 2, n + 2] };
      }
      const a = rng.int(1, 10);
      const d0 = rng.int(1, 4);
      const terms = [a, a + d0, a + d0 + (d0 + 1), a + d0 + (d0 + 1) + (d0 + 2), a + d0 + (d0 + 1) + (d0 + 2) + (d0 + 3)];
      const n = terms[4] + d0 + 4;
      return { terms, next: n, rule: "the gap grows by 1", near: [terms[4] + d0 + 3, terms[4] + d0 + 5, n + 1, n - 1, terms[4] + d0 + 4 + 2] };
    }
    case 4: {
      if (pickGen === 0) {
        const a = rng.int(1, 5);
        const b = rng.int(a + 1, a + 6);
        const terms = [a, b, a + b, a + 2 * b, 2 * a + 3 * b];
        const n = 3 * a + 5 * b;
        return { terms, next: n, rule: "each term is the sum of the two before", near: [n + 1, n - 1, 2 * terms[4], terms[4] + terms[3] + terms[2], n + a] };
      }
      const a = rng.int(1, 4);
      const terms = [a, 2 * a + 1, 4 * a + 3, 8 * a + 7];
      const n = 16 * a + 15;
      return { terms, next: n, rule: "×2 + 1", near: [16 * a + 14, 16 * a + 16, 16 * a + 13, 12 * a + 11, 2 * terms[3] - 1] };
    }
    case 5: {
      if (pickGen === 0) {
        const a = rng.int(2, 9);
        const b = rng.int(1, 5);
        const d = rng.int(3, 8);
        const terms = [a, b * 10, a + d, b * 20, a + 2 * d, b * 30];
        const n = a + 3 * d;
        return { terms, next: n, rule: "two sequences interleaved", near: [b * 40, n + 1, n - 1, a + 2 * d + d + 1, b * 35] };
      }
      const a = rng.int(2, 6);
      const terms = [a, a * 3 - 1, (a * 3 - 1) * 3 - 1, ((a * 3 - 1) * 3 - 1) * 3 - 1];
      const n = terms[3] * 3 - 1;
      return { terms, next: n, rule: "×3 − 1", near: [terms[3] * 3, terms[3] * 3 - 2, terms[3] * 3 + 1, terms[3] * 2 + (terms[3] - terms[2]), n + 3] };
    }
  }
}

/** A number-sequence item: five numbers given, the next one from six options. */
export function numberItem(seed: string, level: Level): NumberItem {
  const rng = new Rng(`number:${seed}`);
  const s = sequence(rng, level);
  const seen = new Set<number>([s.next]);
  const distractors: number[] = [];
  const pool = [...s.near, s.next + 2, s.next - 2, s.next + 3, s.next - 3, s.next + 10, s.next * 2];
  for (const v of pool) {
    if (!Number.isInteger(v) || v < 0 || seen.has(v)) continue;
    seen.add(v);
    distractors.push(v);
    if (distractors.length === MATRIX_OPTIONS - 1) break;
  }
  const options = rng.shuffle([s.next, ...distractors]);
  return { kind: "number", id: `nb:${seed}`, level, timeMs: NUMBER_MS, rule: s.rule, terms: s.terms, options, answer: options.indexOf(s.next) };
}
