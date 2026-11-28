/**
 * Source rows: one Pokémon met one way in one place in one version, before places become areas and versions merge.
 */
import type { EncounterKind } from "../../../src/lib/nuzlocke/model";

export type Src = "pokeapi" | "serebii" | "bulbapedia";

export interface Row {
  src: Src;
  ver: string;
  /** Place name (cleaned; becomes the area). */
  place: string;
  /** Part of the place (floor, sub-area, building). */
  sub?: string;
  species: number;
  /** PokéAPI pokemon name of a non-default form. */
  form?: string;
  /** That form's PokéAPI pokemon id (its art). */
  art?: number;
  kind: EncounterKind;
  method: string;
  rate?: number;
  levels?: [number, number];
  /** Condition text (time, season, swarm…), as the source words it. */
  cond?: string;
  /** Page the row came from. */
  url: string;
}

/** "14 - 16", "14-16", "14–16", "15", "4, 6, 8" -> [min, max]. */
export function parseLevels(s: string | undefined): [number, number] | undefined {
  if (!s) return undefined;
  const nums = [...s.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!nums.length) return undefined;
  return [Math.min(...nums), Math.max(...nums)];
}

/** "45%" -> 45; anything without a percentage -> undefined. */
export function parseRate(s: string | undefined): number | undefined {
  const m = s?.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : undefined;
}
