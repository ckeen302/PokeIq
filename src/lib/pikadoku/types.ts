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
  "Forms are their own picks: regional forms (Alolan Raichu), Megas (Mega Charizard X and Y), Gigantamax forms and a few notable forms (Partner Pikachu, Primal Kyogre, Origin formes, Crowned Zacian).",
  "A form's types, stats and abilities are its own. Its evolution line, legendary status and moves are its species'.",
  "A regional form counts for the region it debuted in: Alolan Raichu is from Alola, Galarian Meowth from Galar, Paldean Wooper from Paldea, Hisuian Growlithe from Hisui. A Mega or Gigantamax form counts for its species' region.",
  "No reuse: a form and its species are the same Pokémon. Once you use Charizard, Mega Charizard X is taken too, and the other way round. (Stricter than PokeDoku, where forms can repeat.)",
  "A species counts for 'Has an Alolan form' (and its forms of other regions); a type category needs just one of the Pokémon's types to match.",
  "Move categories use the Scarlet & Violet learnset of the species; stat categories use base stats.",
];

/** Tooltip text for a category: exactly what counts, forms included. */
export function categoryHint(id: string): string {
  const forms = "Forms are their own picks, with their own types, stats and abilities.";
  if (id.startsWith("type:") || id.startsWith("types:")) return `Counts a Pokémon's own types. ${forms} Mega Charizard X is Fire and Dragon.`;
  if (id.startsWith("region:") || id.startsWith("form:")) return `A species counts for the region it debuted in; a regional form counts for the region it debuted in (Alolan Raichu: Alola); Megas and Gigantamax forms count for their species' region.`;
  if (id.startsWith("evo:")) return "Judged by the evolution line. A form follows its species' line: Alolan Raichu is a second stage.";
  if (id.startsWith("move:")) return "Scarlet & Violet learnset of the species. Forms use their species' moves.";
  if (id.startsWith("ability:")) return `Abilities of the form picked: Mega Charizard X has Tough Claws, not Blaze. ${id === "ability:hidden" ? "Hidden abilities count." : ""}`.trim();
  if (id.startsWith("stat:")) return "Base stats of the form picked: a Mega's stats are its own.";
  if (id === "other:mega" || id === "other:gmax") return "The species has this form, so the species and each of its forms count.";
  if (id === "other:paradox" || id === "other:ultrabeast") return "From a hand-kept list of the official ones. Forms follow their species.";
  if (id === "other:partner") return "A starter or any Pokémon in a starter's evolution line, from Kanto to Paldea. Forms follow their species.";
  return `Legendary, Mythical, fossil, baby and OU status belong to the species; forms follow it. ${forms}`;
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
  difficulty: PdkDifficulty;
  rows: PdkBoardRowView[] | null;
  signedIn?: boolean;
}
