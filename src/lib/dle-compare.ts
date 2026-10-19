import { DLE_COLUMNS, type CellStatus, type DleColumn } from "./dle-types";

/**
 * Pokédle's clues, in one place: the server's puzzles and duels, hard mode's
 * check that a guess fits the clues so far, and the Pokédex panel's greying
 * all use these functions. They only compare two sets of
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
function typeStatus(guess: DlePanelTraits, answer: DlePanelTraits, slot: 0 | 1): CellStatus {
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
 * The clues the Pokédex beside the board reads for you, like Wordle's
 * keyboard: generation and types, which anyone can see in the Pokédex. A
 * Pokémon's height, weight, colour and stage are never in it (or sent to
 * the browser), so those clues are for the player to work out from memory.
 * Hard mode checks only these too, or a rejected guess would tell you a
 * hidden attribute for free.
 */
export const DLE_PANEL_COLUMNS = ["gen", "type1", "type2"] as const;
export type DlePanelColumn = (typeof DLE_PANEL_COLUMNS)[number];
export type DlePanelTraits = Pick<DleTraits, "gen" | "type1" | "type2">;

/** A generation or type clue, from just the generation and types. */
export function panelClueStatus(column: DlePanelColumn, guess: DlePanelTraits, answer: DlePanelTraits): CellStatus {
  return column === "gen" ? numberStatus("gen", guess.gen, answer.gen) : typeStatus(guess, answer, column === "type1" ? 0 : 1);
}

/**
 * The first generation or type clue that `guess` got (`statuses`) and that
 * `candidate` couldn't have given, or null: the Pokédex greys `candidate`
 * out exactly when this isn't null for some guess.
 */
export function panelMisfit(guess: DlePanelTraits, statuses: Pick<DleStatuses, DlePanelColumn>, candidate: DlePanelTraits): DlePanelColumn | null {
  for (const key of DLE_PANEL_COLUMNS) if (panelClueStatus(key, guess, candidate) !== statuses[key]) return key;
  return null;
}

/** "Baby", or the stage number. */
export const stageLabel = (stage: number) => (stage === 0 ? "Baby" : String(stage));
