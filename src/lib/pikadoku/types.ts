/**
 * Pikadoku (Pokemon Sudoku), client-safe: the rules, the families and what
 * the API sends. The categories' answers live server-side only.
 */
export const PDK_SIZE = 3;
export const PDK_CELLS = PDK_SIZE * PDK_SIZE;
/** Guesses ("PP") in a daily; a wrong guess uses one too. */
export const PDK_PP = 9;

export type PdkDifficulty = "easy" | "normal" | "expert";
export const PDK_DIFFICULTIES: PdkDifficulty[] = ["easy", "normal", "expert"];
/** Fewest valid answers any cell must have, per difficulty. */
export const PDK_MIN_ANSWERS: Record<PdkDifficulty, number> = { easy: 8, normal: 3, expert: 1 };

export type PdkFamily = "types" | "regions" | "evolution" | "moves" | "abilities" | "other";
export const PDK_FAMILIES: PdkFamily[] = ["types", "regions", "evolution", "moves", "abilities", "other"];
export const PDK_FAMILY_LABELS: Record<PdkFamily, string> = { types: "Types", regions: "Regions", evolution: "Evolution", moves: "Moves", abilities: "Abilities", other: "Other" };

/** What the page may know about a category: never its members. */
export interface PdkCategoryView {
  id: string;
  family: PdkFamily;
  label: string;
}

export interface PdkGridView {
  rows: PdkCategoryView[];
  cols: PdkCategoryView[];
}

/** One guess: the cell (0-8, row-major) and the Pokemon's id. */
export interface PdkGuess {
  cell: number;
  id: number;
}

/** Unlimited-mode settings (also the shape of a practice seed's options). */
export interface PdkSettings {
  unlimitedPP: boolean;
  softLockGuard: boolean;
  allowSingle: boolean;
  timer: boolean;
  families: PdkFamily[];
}
export const DEFAULT_PDK_SETTINGS: PdkSettings = { unlimitedPP: false, softLockGuard: true, allowSingle: false, timer: false, families: [...PDK_FAMILIES] };

export interface PdkRevealEntry {
  id: number;
  name: string;
  /** Percent of players who picked it here, when stats are on. */
  pct: number | null;
}
export interface PdkReveal {
  cells: { total: number; answers: PdkRevealEntry[] }[];
  /** Why each of your misses didn't fit. */
  misses: { cell: number; id: number; name: string; reason: string }[];
}

export const PDK_RULES = [
  "A Pokémon is judged by its species. Its region is where the species debuted (Pikachu is Kanto).",
  "A regional form counts for the region it debuted in: Alolan Raichu is an Alola form, so Raichu matches 'Has an Alolan form' (and not 'Introduced in Alola').",
  "Mega Evolutions and Gigantamax forms count for the base Pokémon's region and for 'Has a Mega Evolution' or 'Has a Gigantamax form'.",
  "A type category needs just one of the Pokémon's types to match; forms don't change a species' answers.",
  "Move categories use the Scarlet & Violet learnset; stat categories use base stats.",
];

/** What /api/pikadoku/result sends once a game is over. */
export interface PdkResultResponse {
  won: boolean;
  solved: number;
  /** cell -> id of the cells locked. */
  locked: Record<number, number>;
  /** Rarity % per cell (null = empty or stats off). */
  pcts: (number | null)[] | null;
  /** The uniqueness score (lower is better); null when stats are off. */
  score: number | null;
  /** Today's rank on the board, when the game counts. */
  rank: { position: number; total: number } | null;
  /** True when this game was kept for the day's stats. */
  counted: boolean;
  reveal: PdkReveal;
}

export interface PdkBoardRowView {
  name: string;
  solved: number;
  score: number;
  ms: number;
  you?: boolean;
}
export interface PdkBoardResponse {
  date: string;
  difficulty: PdkDifficulty;
  rows: PdkBoardRowView[] | null;
  signedIn?: boolean;
}
