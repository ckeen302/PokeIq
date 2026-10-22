import { CATEGORIES } from "./categories";
import { factsOf } from "./facts";
import { CONN_GROUP_SIZE, CONN_GROUPS, guessKey } from "./types";

/**
 * Solves a PokéConnections grid from the sixteen Pokémon alone, using only
 * the public Pokédex data: every way to split the grid into four categories
 * of exactly four. A fair puzzle (validatePuzzle) always has at least one,
 * its own; this finds them without its groups or its seed.
 *
 * Used by the tests (every duel puzzle can be solved from the data) and the
 * end-to-end run, which races duels without the server ever telling it the
 * answers. Not used by the app.
 */
export function solveGrid(tiles: readonly number[]): number[][][] {
  const grid = new Set(tiles);
  // A category that fits exactly four of the sixteen could be one of the groups.
  const candidates = new Map<string, number[]>();
  for (const c of CATEGORIES) {
    const members = tiles.filter((id) => c.test(factsOf(id)));
    if (members.length === CONN_GROUP_SIZE) candidates.set(guessKey(members), [...members].sort((a, b) => a - b));
  }
  const sets = [...candidates.values()];
  const out: number[][][] = [];
  const pick = (from: number, used: Set<number>, chosen: number[][]) => {
    if (chosen.length === CONN_GROUPS) {
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
