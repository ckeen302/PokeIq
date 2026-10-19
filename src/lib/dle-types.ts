/** Pokédle wire types (shared by server + client). */

/**
 * A clue: right; the right type in the other slot (partial); close, with
 * the direction to go (gen one away, height or weight within 25%); the
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
/** Wrong guesses needed to unlock each hint. */
export const DLE_HINTS = { silhouette: 4, genus: 6 } as const;

export interface DleResponse {
  rows: DleRow[];
  solved: boolean;
  over: boolean;
  hints: { silhouetteUrl?: string; genus?: string };
  /** Only once the puzzle is over. */
  answer?: { id: number; name: string; imageUrl: string; genus: string };
}
