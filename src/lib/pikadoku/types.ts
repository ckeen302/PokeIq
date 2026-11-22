/**
 * Pikadoku (Pokemon Sudoku), client-safe: the rules, the families and what
 * the API sends. The categories' answers live server-side only.
 */
export const PDK_SIZE = 3;
export const PDK_CELLS = PDK_SIZE * PDK_SIZE;
/** Guesses ("PP") in a daily; a wrong guess uses one too. */
export const PDK_PP = 9;

export type PdkDifficulty = "easy" | "normal" | "expert";
/** Where a board lives: a daily difficulty, or the weekly grid. */
export type PdkSlot = PdkDifficulty | "weekly";
export const PDK_DIFFICULTIES: PdkDifficulty[] = ["easy", "normal", "expert"];
/** Fewest valid answers any cell must have, per difficulty. */
export const PDK_MIN_ANSWERS: Record<PdkDifficulty, number> = { easy: 8, normal: 3, expert: 2 };

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

/** Unlimited's difficulty, judged by how many valid answers the board's cells have. */
export type PdkBand = "easy" | "normal" | "hard";
export const PDK_BANDS: PdkBand[] = ["easy", "normal", "hard"];

/** Unlimited-mode settings (also the shape of a practice seed's options). */
export interface PdkSettings {
  unlimitedPP: boolean;
  /** Every board can be finished, and a pick that would strand the other cells is refused. */
  softLockGuard: boolean;
  allowSingle: boolean;
  timer: boolean;
  families: PdkFamily[];
  /**
   * The categories the player ticked on the setup panel, packed (lib/pikadoku/catalog).
   * Absent on older links and devices: those deal from `families` the way they always did.
   */
  pick?: string;
  /** With `pick`: how many answers the cells may have. */
  band?: PdkBand;
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

/**
 * A page in another language's words for Pikadoku, from the server (lib/pikadoku/local): the grids, the picker and
 * the results come from the API in English, and the page shows them in its own language. English pages send none.
 */
export interface PdkLocal {
  /** Category id → its label in the page's language (official type, move and ability names). */
  labels: Record<string, string>;
  /**
   * Pokémon id (species and forms) → its name in the page's language, then the other names it answers to besides
   * the English one (rōmaji). Only where there is something to say: a name the same as English is left out.
   */
  names: Record<number, string[]>;
  /** Weekly theme id → its name and blurb in the page's language (the API sends English). */
  themes: Record<string, { name: string; blurb: string }>;
}

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
  difficulty: PdkSlot;
  rows: PdkBoardRowView[] | null;
  signedIn?: boolean;
}

/** Daily grids baked into the page (categories only): by date, then difficulty. */
export interface PdkPublicDays {
  /** The UTC date the page was rendered on: the grid shown before the player's local date is known. */
  serverDate: string;
  days: Record<string, Record<PdkDifficulty, { grid: PdkGridView; master?: string }>>;
}
