import { CATEGORIES } from "./categories";
import { factsOf } from "./facts";
import { MIXED_CATEGORIES, tileRef } from "./mixed";
import { isPokemonTile } from "./tiles";
import { guessKey } from "./types";

/**
 * Solves a PokéConnections grid from the sixteen Pokémon alone, using only
 * the public Pokédex data: every way to split the grid into four categories
 * of exactly four. A fair puzzle (validatePuzzle) always has at least one,
 * its own; this finds them without its groups or its seed. `limit` stops
 * the search once that many are found (2 is enough to tell "unique"). Also
 * solves a 5x5 board (25 tiles, five groups of five).
 *
 * Used by the tests (every duel puzzle can be solved from the data) and the
 * end-to-end run, which races duels without the server ever telling it the
 * answers. Not used by the app.
 */
export function solveGrid(tiles: readonly number[], limit = Infinity): number[][][] {
  // 16 tiles: four groups of four; 25: five groups of five.
  const size = Math.round(Math.sqrt(tiles.length));
  const grid = new Set(tiles);
  // A category that fits exactly a group's worth of the tiles could be one of the groups.
  const candidates = new Map<string, number[]>();
  // Move, ability and type tiles only fit mixed groups, through testTile.
  const fits = (c: (typeof CATEGORIES)[number], id: number) => (isPokemonTile(id) ? c.test(factsOf(id)) : (c.testTile?.(tileRef(id)) ?? false));
  for (const c of new Set([...CATEGORIES, ...MIXED_CATEGORIES])) {
    const members = tiles.filter((id) => fits(c, id));
    if (members.length === size) candidates.set(guessKey(members), [...members].sort((a, b) => a - b));
  }
  const sets = [...candidates.values()];
  const out: number[][][] = [];
  const pick = (from: number, used: Set<number>, chosen: number[][]) => {
    if (out.length >= limit) return;
    if (chosen.length === size) {
      if (used.size === grid.size) out.push(chosen);
      return;
    }
    for (let i = from; i < sets.length; i++) {
      if (sets[i].some((id) => used.has(id))) continue;
      pick(i + 1, new Set([...used, ...sets[i]]), [...chosen, sets[i]]);
    }
  };
  pick(0, new Set(), []);
  return out;
}
