/**
 * "About me" on a trainer profile: the slots, and the fixed lists the game
 * slots pick from (no free text). Client-safe; the server validates every
 * choice against these and the Pokédex (see about-validate.ts).
 */

export type PokemonRule = "any" | "starter" | "mega" | "gmax" | "regional" | "eeveelution";

export interface PokemonSlot {
  id: string;
  label: string;
  rule: PokemonRule;
  /** Shiny is on and can't be turned off. */
  shinyForced?: boolean;
}

export const POKEMON_SLOTS: readonly PokemonSlot[] = [
  { id: "favorite", label: "Favorite", rule: "any" },
  { id: "second-favorite", label: "2nd Favorite", rule: "any" },
  { id: "least-favorite", label: "Least Favorite", rule: "any" },
  { id: "underrated", label: "Underrated", rule: "any" },
  { id: "overrated", label: "Overrated", rule: "any" },
  { id: "best-starter", label: "Best Starter", rule: "starter" },
  { id: "best-dynamax", label: "Best Dynamax", rule: "gmax" },
  { id: "best-mega", label: "Best Mega", rule: "mega" },
  { id: "best-regional", label: "Best Regional Variant", rule: "regional" },
  { id: "best-eeveelution", label: "Best Eeveelution", rule: "eeveelution" },
  { id: "pet", label: "Would Have as a Pet", rule: "any" },
  { id: "best-shiny", label: "Best-Looking Shiny", rule: "any", shinyForced: true },
  { id: "idk-why", label: "Idk why I like this, but I do", rule: "any" },
  { id: "personal-story", label: "Has a Personal Story", rule: "any" },
  { id: "nostalgic", label: "Very Nostalgic", rule: "any" },
];

export const RULE_HINT: Record<PokemonRule, string> = {
  any: "Any Pokémon or form",
  starter: "Starter lines only",
  mega: "Mega forms only",
  gmax: "Gigantamax forms only",
  regional: "Alolan, Galarian, Hisuian and Paldean forms only",
  eeveelution: "Eeveelutions only",
};

/** The first Pokémon of every starter line, Gens 1 to 9. */
export const STARTER_BASES = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912] as const;
export const EEVEELUTIONS = [134, 135, 136, 196, 197, 470, 471, 700] as const;

// ---- Games ------------------------------------------------------------------

export interface Choice {
  id: string;
  label: string;
  group?: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const make = (group: string | undefined, labels: readonly string[]): Choice[] => labels.map((label) => ({ id: slug(label), label, group }));
const grouped = (groups: Record<string, readonly string[]>): Choice[] => Object.entries(groups).flatMap(([g, l]) => make(g, l));

/** Mainline games, remakes and the Legends games. */
export const GAMES: readonly Choice[] = grouped({
  "Gen 1": ["Red", "Blue", "Yellow"],
  "Gen 2": ["Gold", "Silver", "Crystal"],
  "Gen 3": ["Ruby", "Sapphire", "Emerald", "FireRed", "LeafGreen"],
  "Gen 4": ["Diamond", "Pearl", "Platinum", "HeartGold", "SoulSilver"],
  "Gen 5": ["Black", "White", "Black 2", "White 2"],
  "Gen 6": ["X", "Y", "Omega Ruby", "Alpha Sapphire"],
  "Gen 7": ["Sun", "Moon", "Ultra Sun", "Ultra Moon", "Let's Go, Pikachu!", "Let's Go, Eevee!"],
  "Gen 8": ["Sword", "Shield", "Brilliant Diamond", "Shining Pearl", "Legends: Arceus"],
  "Gen 9": ["Scarlet", "Violet", "Legends: Z-A"],
});

export const REGIONS: readonly Choice[] = make(undefined, ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Hisui", "Paldea"]);

export const GYM_LEADERS: readonly Choice[] = grouped({
  Kanto: ["Brock", "Misty", "Lt. Surge", "Erika", "Janine", "Sabrina", "Blaine", "Giovanni", "Koga"],
  Johto: ["Falkner", "Bugsy", "Whitney", "Morty", "Chuck", "Jasmine", "Pryce", "Clair"],
  Hoenn: ["Roxanne", "Brawly", "Wattson", "Flannery", "Norman", "Winona", "Tate & Liza", "Wallace", "Juan"],
  Sinnoh: ["Roark", "Gardenia", "Maylene", "Crasher Wake", "Fantina", "Byron", "Candice", "Volkner"],
  Unova: ["Cilan, Chili & Cress", "Lenora", "Burgh", "Elesa", "Clay", "Skyla", "Brycen", "Drayden", "Marlon", "Roxie", "Cheren"],
  Kalos: ["Viola", "Grant", "Korrina", "Ramos", "Clemont", "Valerie", "Olympia", "Wulfric"],
  Alola: ["Hala", "Olivia", "Nanu", "Hapu"],
  Galar: ["Milo", "Nessa", "Kabu", "Bea", "Allister", "Opal", "Gordie", "Melony", "Piers", "Raihan"],
  Paldea: ["Katy", "Brassius", "Iono", "Kofu", "Larry", "Ryme", "Tulip", "Grusha"],
  Champions: ["Blue", "Red", "Lance", "Steven Stone", "Cynthia", "Alder", "Iris", "Diantha", "Kukui", "Leon", "Geeta", "Nemona"],
});

// Blue, Cheren and Nemona repeat across groups (champion and gym roles); keep ids unique.
const unique = (list: Choice[]): Choice[] => {
  const seen = new Set<string>();
  return list.filter((c) => !seen.has(c.id) && !!seen.add(c.id));
};
export const GYM_LEADERS_UNIQUE: readonly Choice[] = unique([...GYM_LEADERS]);

export const RIVALS: readonly Choice[] = make(undefined, [
  "Blue",
  "Silver",
  "Brendan",
  "May",
  "Wally",
  "Barry",
  "Cheren",
  "Bianca",
  "Hugh",
  "Serena",
  "Calem",
  "Shauna",
  "Hau",
  "Gladion",
  "Hop",
  "Bede",
  "Marnie",
  "Nemona",
  "Arven",
]);

export const PROFESSORS: readonly Choice[] = make(undefined, [
  "Professor Oak",
  "Professor Elm",
  "Professor Birch",
  "Professor Rowan",
  "Professor Juniper",
  "Professor Sycamore",
  "Professor Kukui",
  "Professor Magnolia",
  "Professor Sada",
  "Professor Turo",
  "Professor Laventon",
]);

export const VILLAIN_TEAMS: readonly Choice[] = make(undefined, [
  "Team Rocket",
  "Team Magma",
  "Team Aqua",
  "Team Galactic",
  "Team Plasma",
  "Team Flare",
  "Team Skull",
  "Aether Foundation",
  "Macro Cosmos",
  "Team Yell",
  "Team Star",
  "Team Cipher",
  "Team Rainbow Rocket",
]);

export interface GameSlot {
  id: string;
  label: string;
  choices: readonly Choice[];
}

export const GAME_SLOTS: readonly GameSlot[] = [
  { id: "favorite-game", label: "Favorite game", choices: GAMES },
  { id: "least-favorite-game", label: "Least favorite game", choices: GAMES },
  { id: "first-game", label: "First game you played", choices: GAMES },
  { id: "nostalgic-game", label: "Most nostalgic game", choices: GAMES },
  { id: "best-region", label: "Best region", choices: REGIONS },
  { id: "best-soundtrack", label: "Best soundtrack", choices: GAMES },
  { id: "underrated-game", label: "Most underrated game", choices: GAMES },
  { id: "gym-leader", label: "Favorite Gym Leader / Champion", choices: GYM_LEADERS_UNIQUE },
  { id: "rival", label: "Favorite rival", choices: RIVALS },
  { id: "professor", label: "Favorite professor", choices: PROFESSORS },
  { id: "villain-team", label: "Favorite villain team", choices: VILLAIN_TEAMS },
];

/** Label of a stored game choice, or null. */
export function choiceLabel(slotId: string, id: string): string | null {
  return GAME_SLOTS.find((s) => s.id === slotId)?.choices.find((c) => c.id === id)?.label ?? null;
}

// ---- Stored shape -------------------------------------------------------------

export interface AboutPick {
  /** A species (1-1025) or an alternate form (10001+). */
  id: number;
  shiny: boolean;
}

export interface AboutData {
  pokemon: Record<string, AboutPick>;
  games: Record<string, string>;
}

export const EMPTY_ABOUT: AboutData = { pokemon: {}, games: {} };
export const aboutIsEmpty = (a: AboutData) => !Object.keys(a.pokemon).length && !Object.keys(a.games).length;
