/**
 * The Cognitive PokéIQ test: five timed sections that use Pokémon as the
 * material, never as the answer. Four of them (reasoning, memory, speed,
 * spatial) make up the cognitive composite; the fifth is the existing
 * adaptive knowledge quiz, scored separately (src/lib/rating.ts).
 */

export const COG_SECTIONS = ["fluid", "memory", "speed", "spatial"] as const;
export type CogSection = (typeof COG_SECTIONS)[number];
/** The five domains on the profile, knowledge included. */
export type Domain = CogSection | "knowledge";
export const DOMAINS: readonly Domain[] = [...COG_SECTIONS, "knowledge"];

export const DOMAIN_INFO: Record<Domain, { title: string; short: string; intro: string }> = {
  fluid: { title: "Fluid reasoning", short: "Reasoning", intro: "Find the hidden rule and pick the missing piece." },
  memory: { title: "Working memory", short: "Memory", intro: "Hold a sequence or a sum in your head, then answer." },
  speed: { title: "Processing speed", short: "Speed", intro: "75 seconds: tap every match as fast as you can." },
  spatial: { title: "Spatial", short: "Spatial", intro: "Turn, route and count things in your mind's eye." },
  knowledge: { title: "Pokémon knowledge", short: "Knowledge", intro: "20 adaptive questions on the Pokémon themselves." },
};

/** Adaptive difficulty: 1 (easiest) to 5 (hardest). */
export type Level = 1 | 2 | 3 | 4 | 5;
export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5];

export type TypeName =
  | "normal" | "fire" | "water" | "electric" | "grass" | "ice" | "fighting" | "poison" | "ground"
  | "flying" | "psychic" | "bug" | "rock" | "ghost" | "dragon" | "dark" | "steel" | "fairy";

export type BallKind = "poke" | "great" | "ultra" | "master" | "premier" | "net";
export type Rot = 0 | 90 | 180 | 270;

/**
 * One cell of a matrix (or one option): a drawing described by data, so a
 * generator can alter one attribute to make a one-rule-off distractor and a
 * test can compare cells exactly.
 */
export type Cell =
  | { k: "mon"; id: number; rot: Rot; size: 1 | 2 | 3; n: 1 | 2 | 3; flip?: boolean }
  | { k: "type"; t: TypeName; n: 1 | 2 | 3 | 4 }
  | { k: "ball"; b: BallKind; n: 1 | 2 | 3 | 4; rot: Rot }
  /** A 3×3 pattern of Poké Ball dots, as a 9-bit mask (bit 0 top-left). */
  | { k: "dots"; bits: number }
  | { k: "num"; v: number }
  | { k: "blank" };

/** Canonical text for a cell: two cells are the same drawing iff their keys match. */
export function cellKey(c: Cell): string {
  switch (c.k) {
    case "mon":
      return `mon:${c.id}:${c.rot}:${c.size}:${c.n}:${c.flip ? 1 : 0}`;
    case "type":
      return `type:${c.t}:${c.n}`;
    case "ball":
      return `ball:${c.b}:${c.n}:${c.rot}`;
    case "dots":
      return `dots:${c.bits}`;
    case "num":
      return `num:${c.v}`;
    case "blank":
      return "blank";
  }
}

interface BaseItem {
  id: string;
  level: Level;
  /** The clock for this item. */
  timeMs: number;
  /** Index of the right option. */
  answer: number;
  /** The rule, in words (shown nowhere during the test; for tests and debugging). */
  rule: string;
}

/** 3×3 matrix, the last cell missing: pick it from six options. */
export interface MatrixItem extends BaseItem {
  kind: "matrix";
  cells: Cell[];
  options: Cell[];
}

/** A number sequence with the last term missing. */
export interface NumberItem extends BaseItem {
  kind: "number";
  terms: number[];
  options: number[];
}

/** Sprites shown one by one; tap them back in order (or in reverse). */
export interface SpanItem extends BaseItem {
  kind: "span";
  sequence: number[];
  /** The grid to tap: the sequence's Pokémon plus a few others, shuffled. */
  grid: number[];
  reverse: boolean;
  /** The order of grid indices that is right. */
  target: number[];
  /** How long each sprite stays up. */
  showMs: number;
}

/** HP arithmetic, answered from options. */
export interface ArithItem extends BaseItem {
  kind: "arith";
  monId: number;
  prompt: string;
  options: number[];
}

/** Mental rotation: which option is the same sprite turned, not mirrored? */
export interface RotationItem extends BaseItem {
  kind: "rotation";
  monId: number;
  options: { rot: number; flip: boolean }[];
}

/** Route map: the fewest steps from the trainer to the gym. */
export interface PathItem extends BaseItem {
  kind: "path";
  size: number;
  walls: boolean[];
  start: number;
  goal: number;
  options: number[];
}

/** A stack of Poké Balls: how many, hidden ones included. */
export interface PileItem extends BaseItem {
  kind: "pile";
  /** Layers from the bottom: [rows, cols] each. */
  layers: [number, number][];
  options: number[];
}

export type CogItem = MatrixItem | NumberItem | SpanItem | ArithItem | RotationItem | PathItem | PileItem;

/** One glyph in the speed section. */
export type Glyph = { k: "type"; t: TypeName } | { k: "mon"; id: number };

export interface SpeedRow {
  id: string;
  target: Glyph;
  row: Glyph[];
  /** Indices in `row` that match the target. */
  matches: number[];
}
