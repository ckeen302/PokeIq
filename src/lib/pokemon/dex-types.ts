import type { Pokemon, StatKey } from "./pokedex";
import type { EncGen } from "./encounter-types";

/** Serializable view model for one Pokédex page (server -> client). */

export interface DexAbility {
  name: string;
  hidden: boolean;
  effect: string;
  /** Its official name in the page's language (other languages only; `name` stays English for its link). */
  label?: string;
}

export interface DexForm {
  id: number;
  slug: string;
  name: string;
  types: string[];
  stats: Record<StatKey, number>;
  abilities: DexAbility[];
}

export interface DexMove {
  id: number;
  /** L level-up · M machine (TM/TR) · E egg · T tutor */
  method: "L" | "M" | "E" | "T";
  level: number;
  tm: string | null;
  /** /pokedex/moves/[slug] */
  slug: string;
  name: string;
  type: string;
  cls: "physical" | "special" | "status";
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  effect: string;
}

export interface EvolutionNode {
  id: number;
  slug: string;
  name: string;
  types: string[];
  /** How to evolve INTO this species (empty for the base). */
  conditions: string[];
  children: EvolutionNode[];
}

export interface DexNeighbour {
  id: number;
  slug: string;
  name: string;
}

export interface DexEntryData {
  core: Pokemon;
  captureRate: number | null;
  baseHappiness: number | null;
  /** −1 genderless, otherwise chance of female in eighths. */
  genderRate: number;
  hatchCounter: number | null;
  isBaby: boolean;
  genderDifferences: boolean;
  growthRate: string | null;
  eggGroups: string[];
  baseExp: number | null;
  evYield: Partial<Record<StatKey, number>>;
  abilities: DexAbility[];
  /** `labels`: the games' names in the page's language (other languages only; `games` then holds the colour keys). */
  entries: { text: string; games: string[]; labels?: string[] }[];
  dexNumbers: { dex: string; number: number }[];
  forms: DexForm[];
  /** The species name in each language the games ship (empty if none recorded). */
  names: { lang: string; label: string; name: string }[];
  evolutionTree: EvolutionNode | null;
  learnset: { game: string; moves: DexMove[] } | null;
  defenses: { type: string; multiplier: number }[];
  stabSuperEffective: string[];
  percentiles: Record<StatKey | "bst", number>;
  /** Where to find it, newest generation first; null until the encounter pipeline has run for this species. */
  encounters: EncGen[] | null;
  prev: DexNeighbour | null;
  next: DexNeighbour | null;
  /** Most similar silhouettes (DINOv2 embedding neighbours). */
  lookalikes: (DexNeighbour & { similarity: number; types: string[] })[];
  /** On a page in another language (the rest of the data is then in that language); absent in English. */
  local?: DexEntryLocal;
}

/** What a species page in another language needs besides its translated data. */
export interface DexEntryLocal {
  /** Type id → official name. */
  types: Record<string, string>;
  /** The species' home region. */
  region: string;
  /** The English name, shown under the heading. */
  english: string;
  /** Version key → the game's official name (the encounter badges' titles). */
  versions: Record<string, string>;
  /** Each generation's collapsed summary of where to find it, by generation. */
  encKinds: Record<number, "entries" | "notInGames" | "notWild">;
}
