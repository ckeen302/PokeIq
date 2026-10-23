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

const FORMS_OWN = "Forms are their own picks with their own types, stats and abilities.";
const FORMS_FOLLOW = "A form follows its species here.";

/**
 * Tooltip text for a category header: exactly what counts, forms included.
 * Matches how the categories are computed (lib/pikadoku/categories).
 */
export function categoryHint(id: string): string {
  const [kind, a] = id.split(":");
  switch (kind) {
    case "type":
      return `Counts a Pokémon with ${a[0].toUpperCase() + a.slice(1)} as one of its types. ${FORMS_OWN} Mega Charizard X is Fire and Dragon, Alolan Raichu is Electric and Psychic.`;
    case "types":
      return `Counts the Pokémon's own types, so a form can differ from its species: Charizard is dual-typed, and so is Mega Charizard X. ${FORMS_OWN}`;
    case "region":
      return a === "hisui"
        ? "Only Hisuian forms: their debut region is Hisui (Pokémon Legends: Arceus). Species count for the region they debuted in; Megas and Gigantamax forms count for their species' region."
        : "A species counts for the region it debuted in. A regional form counts for the region it debuted in (Alolan Raichu is Alola, Raichu is Kanto). Megas and Gigantamax forms count for their species' region.";
    case "form":
      return "The species has a regional form from that region, so the species and each of its forms count (Raichu and Alolan Raichu both match 'Has an Alolan form').";
    case "evo":
      return `Judged by the evolution line. ${FORMS_FOLLOW} Alolan Raichu is a second stage, like Raichu; Mega Charizard X is a fully evolved Charmander line member.`;
    case "move":
      return "Needs the move in the Scarlet & Violet learnset of the species. Forms use their species' moves.";
    case "ability":
      return id === "ability:hidden"
        ? "Has an ability marked hidden. Abilities belong to the form picked: Mega Charizard X has only Tough Claws, so it has no hidden ability."
        : "Has this ability in any slot. Abilities belong to the form picked: Mega Charizard X has Tough Claws, not Blaze.";
    case "stat":
      return "Uses base stats of the form picked: a Mega Evolution's stats are its own, higher than its species'.";
    default:
      break;
  }
  switch (id) {
    case "other:mega":
    case "other:gmax":
      return "The species has this form, so the species and each of its forms count (Charizard and Mega Charizard X both match 'Has a Mega Evolution').";
    case "other:paradox":
      return "Hand-kept list of the official Paradox Pokémon (Great Tusk to Iron Crown). Forms follow their species.";
    case "other:ultrabeast":
      return "Hand-kept list of the eleven Ultra Beasts (Nihilego to Blacephalon). Necrozma is not one. Forms follow their species.";
    case "other:partner":
      return "Any Pokémon in the evolution line of a main-series starter from Kanto to Paldea. " + FORMS_FOLLOW;
    case "other:ou":
      return `Appears in the Gen 9 OU usage data. ${FORMS_FOLLOW}`;
    default:
      return `Legendary, Mythical, fossil and baby status belong to the species. ${FORMS_FOLLOW}`;
  }
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
