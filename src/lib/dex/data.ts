import "server-only";
import movesData from "@/data/moves.json";
import detailsData from "@/data/pokedex-details.json";
import itemsData from "@/data/items.json";
import { POKEDEX, getPokemon } from "@/lib/pokemon/pokedex";
import { buildAbilities, buildMoves, type AbilityRecord, type MoveRecord, type RawDexDetails, type RawMove } from "./build";
import type { ItemRecord } from "./items-build";

/** Build-time indexes for the Moves / Abilities / Items Pokédex tabs. */

export const MOVES: MoveRecord[] = buildMoves(movesData as unknown as Record<string, RawMove>, detailsData as unknown as Record<string, RawDexDetails>);
export const ABILITIES: AbilityRecord[] = buildAbilities(detailsData as unknown as Record<string, RawDexDetails>);
export const ITEMS = itemsData as unknown as ItemRecord[];

const MOVE_BY_SLUG = new Map(MOVES.map((m) => [m.slug, m]));
const MOVE_BY_NAME = new Map(MOVES.map((m) => [m.name.toLowerCase().replace(/[^a-z0-9]/g, ""), m]));
const ABILITY_BY_SLUG = new Map(ABILITIES.map((a) => [a.slug, a]));
const ITEM_BY_SLUG = new Map(ITEMS.map((i) => [i.slug, i]));

export const getMove = (slug: string) => MOVE_BY_SLUG.get(slug);
export const getAbility = (slug: string) => ABILITY_BY_SLUG.get(slug);
export const getItem = (slug: string) => ITEM_BY_SLUG.get(slug);
/** PokéAPI move slug ("focus-punch") -> our move record. */
export const moveFromApiSlug = (slug: string) => MOVE_BY_NAME.get(slug.replace(/[^a-z0-9]/g, ""));

export function species(id: number) {
  const p = getPokemon(id);
  return p ? { id: p.id, slug: p.slug, name: p.name, types: p.types as string[] } : null;
}
export function speciesBySlug(slug: string) {
  const p = POKEDEX.find((x) => x.slug === slug);
  return p ? { id: p.id, slug: p.slug, name: p.name, types: p.types as string[] } : null;
}
