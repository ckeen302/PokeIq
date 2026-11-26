import table from "@/data/catch-rate.json";

/**
 * Every species' catch facts (src/data/catch-rate.json, built by scripts/catch-rate-data.ts from the site's Pokédex
 * data, which came from PokéAPI): catch rate, base HP and Speed, weight, types, generation and Ultra Beast.
 */
export interface CatchSpecies {
  id: number;
  name: string;
  rate: number;
  baseHp: number;
  baseSpeed: number;
  /** Hectograms. */
  weight: number;
  types: string[];
  gen: number;
  ultraBeast: boolean;
}

type Row = [number, string, number, number, number, number, string, number, number];

export const SPECIES: readonly CatchSpecies[] = (table as Row[]).map(([id, name, rate, baseHp, baseSpeed, weight, types, gen, ub]) => ({
  id,
  name,
  rate,
  baseHp,
  baseSpeed,
  weight,
  types: types.split("/"),
  gen,
  ultraBeast: ub === 1,
}));

const byId = new Map(SPECIES.map((s) => [s.id, s]));
export const LAST_ID = SPECIES[SPECIES.length - 1].id;
export const speciesById = (id: number): CatchSpecies | undefined => byId.get(id);
