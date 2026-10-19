import { DLE_COLUMNS, type CellStatus, type DleColumn } from "./dle-types";

/**
 * Pokédle's clues, in one place: the server's puzzles and duels, hard mode's
 * check that a guess fits the clues so far, and the Pokédex panel's clue
 * filters all use these functions. They only compare two sets of
 * attributes; nothing here knows an answer, so it's safe in the browser.
 */

/** What the clues are about: height in decimetres, weight in hectograms, stage 0 for a baby. */
export interface DleTraits {
  gen: number;
  type1: string;
  type2: string | null;
  height: number;
  weight: number;
  color: string;
  stage: number;
}

export type DleNumericColumn = "gen" | "height" | "weight" | "stage";
export const DLE_NUMERIC_COLUMNS: readonly DleNumericColumn[] = ["gen", "height", "weight", "stage"];
export const isNumericColumn = (c: DleColumn): c is DleNumericColumn => (DLE_NUMERIC_COLUMNS as readonly string[]).includes(c);

/**
 * Close (yellow, with the arrow):
 * - generation: one away;
 * - height and weight: within 25% (the larger at most 1.25 times the
 *   smaller), or 0.1 m / 0.1 kg apart, so the tiniest Pokémon can be close;
 * - stage: one away, between stages 1 to 3 (a Baby is never close: it
 *   sits outside its family's line).
 */
export function isClose(column: DleNumericColumn, guess: number, answer: number): boolean {
  if (guess === answer) return false;
  if (column === "gen") return Math.abs(guess - answer) === 1;
  if (column === "stage") return guess > 0 && answer > 0 && Math.abs(guess - answer) === 1;
  const [lo, hi] = guess < answer ? [guess, answer] : [answer, guess];
  return 4 * hi <= 5 * lo || hi - lo <= 1;
}

function numberStatus(column: DleNumericColumn, guess: number, answer: number): CellStatus {
  if (guess === answer) return "match";
  const close = isClose(column, guess, answer);
  if (answer > guess) return close ? "close-higher" : "higher";
  return close ? "close-lower" : "lower";
}

/** Type 1 / Type 2: the same type in that slot, the type in the other slot, or not a type the answer has. */
function typeStatus(guess: DleTraits, answer: DleTraits, slot: 0 | 1): CellStatus {
  const g = slot === 0 ? guess.type1 : guess.type2;
  const a = slot === 0 ? answer.type1 : answer.type2;
  if (!g) return a ? "miss" : "match";
  if (g === a) return "match";
  return g === answer.type1 || g === answer.type2 ? "partial" : "miss";
}

/** One column's clue for `guess` when the answer is `answer`. */
export function clueStatus(column: DleColumn, guess: DleTraits, answer: DleTraits): CellStatus {
  switch (column) {
    case "type1":
      return typeStatus(guess, answer, 0);
    case "type2":
      return typeStatus(guess, answer, 1);
    case "color":
      return guess.color === answer.color ? "match" : "miss";
    default:
      return numberStatus(column, guess[column], answer[column]);
  }
}

export type DleStatuses = Record<DleColumn, CellStatus>;

/** Every column's clue for `guess` when the answer is `answer`. */
export function compareTraits(guess: DleTraits, answer: DleTraits): DleStatuses {
  const out = {} as DleStatuses;
  for (const { key } of DLE_COLUMNS) out[key] = clueStatus(key, guess, answer);
  return out;
}

/**
 * The first column where `candidate` doesn't fit the clues `statuses` that
 * `guess` got, or null if it fits them all. A Pokémon could still be the
 * answer exactly when it fits every row so far (hard mode's rule).
 */
export function misfit(guess: DleTraits, statuses: DleStatuses, candidate: DleTraits): DleColumn | null {
  for (const { key } of DLE_COLUMNS) if (clueStatus(key, guess, candidate) !== statuses[key]) return key;
  return null;
}

/**
 * The values (inclusive, in the column's units) a numeric column can take
 * given that a guess with `value` got `status`; null bounds are open. Used by
 * the Pokédex panel, so a clue becomes a filter without any arithmetic.
 */
export function clueRange(column: DleNumericColumn, value: number, status: CellStatus): { min: number | null; max: number | null } {
  // The furthest close value each way (a Baby's stage has no close values above it, stage 1 none below).
  const above = column === "gen" ? value + 1 : column === "stage" ? (value === 0 ? 0 : value + 1) : Math.max(Math.floor((5 * value) / 4), value + 1);
  const below = column === "gen" ? value - 1 : column === "stage" ? (value <= 1 ? 1 : value - 1) : Math.min(Math.ceil((4 * value) / 5), value - 1);
  switch (status) {
    case "match":
      return { min: value, max: value };
    case "close-higher":
      return { min: value + 1, max: above };
    case "close-lower":
      return { min: below, max: value - 1 };
    case "higher":
      return { min: above + 1, max: null };
    case "lower":
      return { min: null, max: below - 1 };
    default:
      return { min: null, max: null };
  }
}

/** "Baby", or the stage number. */
export const stageLabel = (stage: number) => (stage === 0 ? "Baby" : String(stage));
