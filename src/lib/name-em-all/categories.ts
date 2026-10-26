import { Rng } from "@/lib/rng";

/**
 * Name 'em All's categories, client-safe: ids, labels and page copy only.
 * Which Pokémon each one holds is worked out from the Pokédex data on the
 * server (lib/name-em-all/targets.ts).
 */

export type NeaGroup = "all" | "gen" | "type" | "special" | "forms" | "dex";

export interface NeaCategory {
  /** Also the page's slug: /quiz/name-em-all/<id>. */
  id: string;
  group: NeaGroup;
  /** "Gen 1", "Fire type", "Mega Evolutions". */
  label: string;
  /** Page heading. */
  h1: string;
  /** Page <title>. */
  title: string;
  description: string;
}

export const NEA_PATH = "/quiz/name-em-all";
export const NEA_TITLE = "Name 'em All";

export const NEA_GROUPS: { id: NeaGroup; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "gen", label: "Generations" },
  { id: "type", label: "Types" },
  { id: "special", label: "Legends & more" },
  { id: "forms", label: "Forms" },
  { id: "dex", label: "Regional Pokédexes" },
];

export const NEA_GEN_REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

export const NEA_TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "flying",
  "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy", "ground",
] as const;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const all: NeaCategory = {
  id: "all",
  group: "all",
  label: "All 1,025",
  h1: "Name all 1,025 Pokémon",
  title: "Name All 1,025 Pokémon Quiz: Can You Name Every Pokémon?",
  description: "Type the name of every Pokémon from Bulbasaur to Pecharunt. Each one fills its slot the moment you spell it right. Timer, hints, shiny sprites and leaderboards.",
};

const gens: NeaCategory[] = NEA_GEN_REGIONS.map((region, i) => ({
  id: `gen-${i + 1}`,
  group: "gen",
  label: `Gen ${i + 1}`,
  h1: `Name every Gen ${i + 1} Pokémon`,
  title: `Name Every Gen ${i + 1} Pokémon Quiz (${region})`,
  description: `How many of the Pokémon that debuted in ${region} can you name from memory? Type them in any order and race the clock.`,
}));

const types: NeaCategory[] = NEA_TYPES.map((t) => ({
  id: `type-${t}`,
  group: "type",
  label: cap(t),
  h1: `Name every ${cap(t)}-type Pokémon`,
  title: `Name Every ${cap(t)}-Type Pokémon Quiz`,
  description: `Name every Pokémon with the ${cap(t)} type, single or dual typed, from all nine generations.`,
}));

const special: NeaCategory[] = [
  {
    id: "legendary",
    group: "special",
    label: "Legendary",
    h1: "Name every Legendary Pokémon",
    title: "Name Every Legendary Pokémon Quiz",
    description: "Every Pokémon the games class as Legendary, from the Kanto birds to Terapagos, sub-legendaries included.",
  },
  {
    id: "sub-legendary",
    group: "special",
    label: "Sub-legendary",
    h1: "Name every sub-legendary Pokémon",
    title: "Name Every Sub-Legendary Pokémon Quiz",
    description: "The Legendaries that aren't the headline box legends: trios, Tapus, Treasures of Ruin, the Loyal Three and more.",
  },
  {
    id: "mythical",
    group: "special",
    label: "Mythical",
    h1: "Name every Mythical Pokémon",
    title: "Name Every Mythical Pokémon Quiz",
    description: "Mew, Celebi, Jirachi and the rest of the event-only Mythical Pokémon, all the way to Pecharunt.",
  },
  {
    id: "ultra-beasts",
    group: "special",
    label: "Ultra Beasts",
    h1: "Name every Ultra Beast",
    title: "Name Every Ultra Beast Quiz",
    description: "The visitors from Ultra Space, from Nihilego to Blacephalon.",
  },
  {
    id: "paradox",
    group: "special",
    label: "Paradox",
    h1: "Name every Paradox Pokémon",
    title: "Name Every Paradox Pokémon Quiz",
    description: "The ancient and future Paradox Pokémon from Scarlet and Violet and their DLC.",
  },
];

const forms: NeaCategory[] = [
  {
    id: "mega-evolutions",
    group: "forms",
    label: "Mega Evolutions",
    h1: "Name every Mega Evolution",
    title: "Name Every Mega Evolution Quiz",
    description: "Every Mega Evolution from X and Y and Omega Ruby and Alpha Sapphire. Type “Mega Venusaur”, or just “Venusaur”.",
  },
  {
    id: "gigantamax",
    group: "forms",
    label: "Gigantamax",
    h1: "Name every Gigantamax Pokémon",
    title: "Name Every Gigantamax Pokémon Quiz",
    description: "Every Gigantamax form from Sword and Shield. Type “Gigantamax Snorlax”, “Gmax Snorlax”, or just “Snorlax”.",
  },
  {
    id: "regional-forms",
    group: "forms",
    label: "Regional forms",
    h1: "Name every regional form",
    title: "Name Every Regional Form Quiz (Alolan, Galarian, Hisuian, Paldean)",
    description: "Every Alolan, Galarian, Hisuian and Paldean form. Type “Alolan Vulpix” or “Vulpix Alola”.",
  },
];

/** The regional dexes: the latest version of each region's own Pokédex (and the source label in the data). */
export const NEA_DEXES: { id: string; region: string; game: string; sources: string[] }[] = [
  { id: "kanto-dex", region: "Kanto", game: "Red, Blue and Yellow", sources: ["Kanto"] },
  { id: "johto-dex", region: "Johto", game: "HeartGold and SoulSilver", sources: ["Updated Johto"] },
  { id: "hoenn-dex", region: "Hoenn", game: "Omega Ruby and Alpha Sapphire", sources: ["Updated Hoenn"] },
  { id: "sinnoh-dex", region: "Sinnoh", game: "Platinum", sources: ["Extended Sinnoh"] },
  { id: "unova-dex", region: "Unova", game: "Black 2 and White 2", sources: ["Updated Unova"] },
  { id: "kalos-dex", region: "Kalos", game: "X and Y (Central, Coastal and Mountain)", sources: ["Kalos Central", "Kalos Coastal", "Kalos Mountain"] },
  { id: "alola-dex", region: "Alola", game: "Ultra Sun and Ultra Moon", sources: ["Updated Alola"] },
  { id: "galar-dex", region: "Galar", game: "Sword and Shield", sources: ["Galar"] },
  { id: "paldea-dex", region: "Paldea", game: "Scarlet and Violet", sources: ["Paldea"] },
];

const dexes: NeaCategory[] = NEA_DEXES.map((d) => ({
  id: d.id,
  group: "dex",
  label: `${d.region} Dex`,
  h1: `Name the ${d.region} Pokédex`,
  title: `Name Every Pokémon in the ${d.region} Pokédex Quiz`,
  description: `Every Pokémon in the ${d.region} regional Pokédex of ${d.game}, numbered as in the game.`,
}));

export const NEA_CATEGORIES: NeaCategory[] = [all, ...gens, ...types, ...special, ...forms, ...dexes];

const BY_ID = new Map(NEA_CATEGORIES.map((c) => [c.id, c]));

export function neaCategory(id: string): NeaCategory | undefined {
  return BY_ID.get(id);
}

export const neaHref = (id: string) => `${NEA_PATH}/${id}`;

/**
 * The standard time for a category: about five seconds a name, at least
 * two minutes and at most an hour. Ranked "most named" boards count the
 * names inside it, whatever timer the player chose.
 */
export function standardMinutes(total: number): number {
  return Math.min(60, Math.max(2, Math.ceil(total / 12)));
}

// ---------------------------------------------------------------------------
// The daily
// ---------------------------------------------------------------------------

/** Categories that make a good day's quiz: everything but the big ones (All and the regional dexes). */
export const NEA_DAILY_POOL: string[] = NEA_CATEGORIES.filter((c) => c.group !== "all" && c.group !== "dex").map((c) => c.id);

const DAY_MS = 86_400_000;
const EPOCH = Date.parse("2026-01-01T00:00:00Z");

/**
 * The day's shared category: the same for everyone on a date. The pool is
 * dealt in shuffled cycles, so no category repeats until all have been.
 */
export function neaDailyCategory(date: string): string {
  const day = Math.floor((Date.parse(`${date}T00:00:00Z`) - EPOCH) / DAY_MS);
  const n = NEA_DAILY_POOL.length;
  const cycle = Math.floor(day / n);
  const pos = ((day % n) + n) % n;
  const order = [...NEA_DAILY_POOL];
  const rng = new Rng(`nea-daily:${cycle}`);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[pos];
}

export const isNeaDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
