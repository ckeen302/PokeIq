import { compareTraits, stageLabel, type DleTraits } from "@/lib/dle-compare";
import type { DleColumn, DleRow } from "@/lib/dle-types";
import { formatHeight, formatWeight } from "@/lib/pokemon/constants";

/**
 * The example boards in Pokédle's how-to (the animated demo and the worked
 * example). Real Pokédex values, as Pokédle reads them (height in dm, weight
 * in hg, stage 0 for a baby), run through the game's own clue code, so an
 * example can never teach a clue the game wouldn't give.
 * tests/pokedle-accuracy.test.ts checks each against the Pokédex.
 */

export interface DleExampleMon {
  id: number;
  name: string;
  t: DleTraits;
}

export const DLE_EXAMPLE_MONS = {
  mareep: { id: 179, name: "Mareep", t: { gen: 2, type1: "electric", type2: null, height: 6, weight: 78, color: "white", stage: 1 } },
  pikachu: { id: 25, name: "Pikachu", t: { gen: 1, type1: "electric", type2: null, height: 4, weight: 60, color: "yellow", stage: 1 } },
  raichu: { id: 26, name: "Raichu", t: { gen: 1, type1: "electric", type2: null, height: 8, weight: 300, color: "yellow", stage: 2 } },
} satisfies Record<string, DleExampleMon>;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** `guess`'s row on the board when the answer is `answer`, under the given columns. */
export function exampleRow(guess: DleExampleMon, answer: DleExampleMon, columns: readonly DleColumn[]): DleRow {
  const status = compareTraits(guess.t, answer.t, { columns: [...columns], close: true });
  const value: Record<DleColumn, string> = {
    gen: String(guess.t.gen),
    type1: cap(guess.t.type1),
    type2: guess.t.type2 ? cap(guess.t.type2) : "None",
    height: formatHeight(guess.t.height),
    weight: formatWeight(guess.t.weight),
    color: cap(guess.t.color),
    stage: stageLabel(guess.t.stage),
  };
  const cells: DleRow["cells"] = {};
  for (const c of columns) cells[c] = { value: value[c], status: status[c]! };
  return { id: guess.id, name: guess.name, imageUrl: "", solved: guess.id === answer.id, cells };
}
