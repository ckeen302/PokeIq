/** Pokédle wire types (shared by server + client). */

/**
 * A clue: right; the right type in the other slot (partial); close, with
 * the direction to go (gen or stage one away, height or weight within
 * 25%); the
 * direction to go; or wrong.
 */
export type CellStatus = "match" | "partial" | "close-higher" | "close-lower" | "higher" | "lower" | "miss";

/** Which way the answer lies, for a numeric clue. */
export function statusArrow(status: CellStatus): "up" | "down" | null {
  if (status === "higher" || status === "close-higher") return "up";
  if (status === "lower" || status === "close-lower") return "down";
  return null;
}

/** Partial or close: the yellow clues. */
export const isNear = (status: CellStatus) => status === "partial" || status === "close-higher" || status === "close-lower";

export interface DleCell {
  value: string;
  status: CellStatus;
}

export interface DleRow {
  id: number;
  name: string;
  imageUrl: string;
  cells: {
    gen: DleCell;
    type1: DleCell;
    type2: DleCell;
    height: DleCell;
    weight: DleCell;
    color: DleCell;
    stage: DleCell;
  };
  solved: boolean;
}

export type DleColumn = keyof DleRow["cells"];

export const DLE_COLUMNS: { key: DleColumn; label: string }[] = [
  { key: "gen", label: "Gen" },
  { key: "type1", label: "Type 1" },
  { key: "type2", label: "Type 2" },
  { key: "height", label: "Height" },
  { key: "weight", label: "Weight" },
  { key: "color", label: "Color" },
  { key: "stage", label: "Stage" },
];

/**
 * One guessable Pokémon for the reference Pokédex beside the board: the
 * attributes Pokédle's clues are about (height in decimetres, weight in
 * hectograms, as the board's clues compare them; stage 0 is a baby).
 */
export type DleDexRow = [id: number, name: string, gen: number, type1: string, type2: string | null, height: number, weight: number, color: string, stage: number];

export const DLE_MAX_GUESSES = 8;

/**
 * From this date the daily answer comes from the curated pool (see
 * src/lib/server/pokedle-schedule.ts); earlier dates keep their original
 * answers. Chosen so that no player anywhere had reached it when the
 * schedule shipped.
 */
export const DLE_CURATED_FROM = "2026-10-22";

/** The daily's difficulty tier by weekday (0 = Sunday): easier early in the week, harder at the weekend. */
export const DLE_WEEKDAY_TIER = [2, 0, 0, 0, 1, 1, 2] as const;
/**
 * Hints are opt-in, solo and in duels: nothing is shown until the player
 * taps to use one (after their first guess), and each costs points.
 */
export const DLE_HINT_KINDS = ["genus", "silhouette"] as const;
export type DleHint = (typeof DLE_HINT_KINDS)[number];
export const DLE_HINT_COST: Record<DleHint, number> = { genus: 150, silhouette: 300 };
export const DLE_HINT_LABEL: Record<DleHint, string> = { genus: "Category", silhouette: "Silhouette" };
/** The share's marker for each hint used. */
export const DLE_HINT_EMOJI: Record<DleHint, string> = { silhouette: "👤", genus: "📖" };

/** A first-guess solve. Each guess after the first costs DLE_GUESS_COST, down to 300 on the last guess. */
export const DLE_SOLVE_POINTS = 1000;
export const DLE_GUESS_COST = Math.round(700 / (DLE_MAX_GUESSES - 1));

/** Points for solving in `guesses`. */
export const dleBasePoints = (guesses: number) => DLE_SOLVE_POINTS - (guesses - 1) * DLE_GUESS_COST;
/** What the hints used cost, in all. */
export const dleHintCost = (hints: readonly DleHint[]) => DLE_HINT_KINDS.reduce((sum, h) => sum + (hints.includes(h) ? DLE_HINT_COST[h] : 0), 0);

/**
 * A puzzle's points, the same rule as a duel round without the speed bonus:
 * the solve's points (0 if unsolved) less the hints used, never below 0.
 */
export function dleScore(guesses: number, solved: boolean, hints: readonly DleHint[]): number {
  return Math.max(0, (solved ? dleBasePoints(guesses) : 0) - dleHintCost(hints));
}

export interface DleResponse {
  rows: DleRow[];
  solved: boolean;
  over: boolean;
  /** Only the hints asked for, and only while the puzzle is on (the answer shows after). */
  hints: { silhouetteUrl?: string; genus?: string };
  /** Only once the puzzle is over. */
  answer?: { id: number; name: string; imageUrl: string; genus: string };
}
