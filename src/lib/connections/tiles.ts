/**
 * What a PokéConnections tile can be, client-safe. A tile is still one
 * number, so guesses, the grid and the stored dailies keep their shape:
 * a Pokémon is its Pokédex number (always under MOVE_BASE), and every other
 * kind is a base plus an index into the repo's own lists (./mixed).
 */

export type ConnTileKind = "pokemon" | "move" | "ability" | "type";

export const MOVE_BASE = 1_000_000;
export const ABILITY_BASE = 2_000_000;
export const TYPE_BASE = 3_000_000;
/** The largest tile number the API accepts. */
export const TILE_ID_MAX = TYPE_BASE + 999_999;

export function tileKindOf(id: number): ConnTileKind {
  if (id >= TYPE_BASE) return "type";
  if (id >= ABILITY_BASE) return "ability";
  if (id >= MOVE_BASE) return "move";
  return "pokemon";
}

export const isPokemonTile = (id: number) => id < MOVE_BASE;
