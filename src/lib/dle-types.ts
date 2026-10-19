/** Pokédle wire types (shared by server + client). */

export type CellStatus = "match" | "partial" | "higher" | "lower" | "miss";

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
 * hectograms, as the board's clues compare them).
 */
export type DleDexRow = [id: number, name: string, gen: number, type1: string, type2: string | null, height: number, weight: number, color: string, stage: number];

export const DLE_MAX_GUESSES = 8;
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
