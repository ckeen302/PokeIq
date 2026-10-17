import type { Pokemon, StatKey } from "./pokedex";

/** Serializable view model for one Pokédex page (server -> client). */

export interface DexAbility {
  name: string;
  hidden: boolean;
  effect: string;
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
  entries: { text: string; games: string[] }[];
  dexNumbers: { dex: string; number: number }[];
  forms: DexForm[];
  evolutionTree: EvolutionNode | null;
  learnset: { game: string; moves: DexMove[] } | null;
  defenses: { type: string; multiplier: number }[];
  stabSuperEffective: string[];
  percentiles: Record<StatKey | "bst", number>;
  prev: DexNeighbour | null;
  next: DexNeighbour | null;
  /** Most similar silhouettes (DINOv2 embedding neighbours). */
  lookalikes: (DexNeighbour & { similarity: number; types: string[] })[];
}
