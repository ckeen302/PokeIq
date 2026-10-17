import data from "@/data/pokedex.json";
import type { PokemonType } from "./type-matrix";

/**
 * Typed, indexed access to the committed Pokédex snapshot
 * (see scripts/ingest-pokedex.ts). Server-only: the full snapshot is ~1 MB
 * and contains every answer.
 */

import type { StatKey } from "./constants";

export type { StatKey };
export { STAT_LABELS, GENERATION_REGIONS, formatHeight, formatWeight, titleCase } from "./constants";

export interface Pokemon {
  id: number;
  slug: string;
  name: string;
  names: Partial<Record<"en" | "es" | "fr" | "de" | "it" | "ja" | "ko", string>>;
  genus: string;
  gen: number;
  types: PokemonType[];
  stats: Record<StatKey, number>;
  bst: number;
  /** Decimetres. */
  height: number;
  /** Hectograms. */
  weight: number;
  color: string;
  habitat: string | null;
  shape: string | null;
  stage: number;
  fullyEvolved: boolean;
  chain: number;
  evolvesFrom: number | null;
  legendary: boolean;
  mythical: boolean;
  abilities: { name: string; hidden: boolean }[];
  flavor: string[];
}

export const POKEDEX = data as unknown as Pokemon[];
export const MAX_GEN = Math.max(...POKEDEX.map((p) => p.gen));

const BY_ID = new Map(POKEDEX.map((p) => [p.id, p]));
const BY_SLUG = new Map(POKEDEX.map((p) => [p.slug, p]));
const BY_CHAIN = new Map<number, Pokemon[]>();
for (const p of POKEDEX) {
  const family = BY_CHAIN.get(p.chain) ?? [];
  family.push(p);
  BY_CHAIN.set(p.chain, family);
}

export function getPokemon(id: number): Pokemon | undefined {
  return BY_ID.get(id);
}

export function getPokemonBySlug(slug: string): Pokemon | undefined {
  return BY_SLUG.get(slug);
}

export function evolutionFamily(p: Pokemon): Pokemon[] {
  return BY_CHAIN.get(p.chain) ?? [p];
}

/** Species pool, optionally restricted to a set of generations. */
export function poolFor(gens?: readonly number[]): Pokemon[] {
  if (!gens || gens.length === 0) return POKEDEX;
  return POKEDEX.filter((p) => gens.includes(p.gen));
}

export function artworkUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

export function cryUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;
}

