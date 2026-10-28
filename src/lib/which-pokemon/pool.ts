import poolData from "@/data/which-pokemon.json";
import allData from "@/data/which-pokemon-all.json";
import type { PooledPokemon, Profile } from "./types";

/**
 * The result pool (src/data/which-pokemon.json): about 200 Pokémon chosen
 * because they have a real personality on record (Pokédex entries across the
 * games, Mystery Dungeon, Sleep and Legends behaviour, anime
 * characterisation), are recognisable, are distinct from their near-twins,
 * and together cover every type, every generation and every corner of the
 * trait space. Each carries a hand-set seven-axis profile and the evidence
 * it rests on.
 *
 * Every one of the 1,025 species also has a lighter profile
 * (src/data/which-pokemon-all.json, built by scripts/which-pokemon-profiles.ts
 * from type, Pokédex text and evolution stage) for the "deep cut" match, so
 * no Pokémon is left out.
 */

export const POOL = poolData.pokemon as unknown as PooledPokemon[];

/** Every species: id, slug, name, types ("fire/flying") and its light profile. */
export type SpeciesRow = [number, string, string, string, number, number, number, number, number, number, number];
export const ALL_SPECIES = allData as SpeciesRow[];

export interface SpeciesInfo {
  id: number;
  slug: string;
  name: string;
  types: string[];
  gen: number;
  p: Profile;
}

const GEN_STARTS = [1, 152, 252, 387, 494, 650, 722, 810, 906];
export const genOf = (id: number) => GEN_STARTS.filter((start) => id >= start).length;

const SPECIES_BY_ID = new Map<number, SpeciesInfo>();
for (const row of ALL_SPECIES) {
  const [id, slug, name, types, ...p] = row;
  SPECIES_BY_ID.set(id, { id, slug, name, types: types.split("/"), gen: genOf(id), p: p as unknown as Profile });
}

const POOL_BY_ID = new Map(POOL.map((p) => [p.id, p]));
const POOL_BY_SLUG = new Map(POOL.map((p) => [p.slug, p]));
const POOL_IDS = new Set(POOL.map((p) => p.id));

export const speciesInfo = (id: number): SpeciesInfo | undefined => SPECIES_BY_ID.get(id);
export const pooled = (id: number): PooledPokemon | undefined => POOL_BY_ID.get(id);
export const pooledBySlug = (slug: string): PooledPokemon | undefined => POOL_BY_SLUG.get(slug);
export const isPooled = (id: number): boolean => POOL_IDS.has(id);

/** Species not in the pool: the deep-cut candidates. */
export const DEEP_CUTS: SpeciesInfo[] = [...SPECIES_BY_ID.values()].filter((s) => !POOL_IDS.has(s.id));
