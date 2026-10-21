import "server-only";
import type { Pokemon } from "@/lib/pokemon/pokedex";
import type { DleRow } from "@/lib/dle-types";
import { compare } from "./pokedle";
import { CLASSIC_RULES, type DleRules } from "@/lib/dle-format";

/**
 * "Pokémon still possible": how many Pokémon fit every clue a trainer has
 * been shown (only the columns the game shows, as it shows them).
 *
 * A candidate fits a guess exactly when that guess, compared with the
 * candidate, would have shown the same clues (and the same solved-or-not)
 * as it did against the real answer. That's defined through compare()
 * alone, so it stays exact whatever clue states compare() learns.
 */

/** A row's clues as one string: solved or not, then every cell's status. */
export function clueKey(row: DleRow): string {
  let key = row.solved ? "1" : "0";
  for (const cell of Object.values(row.cells)) key += `|${cell.status}`;
  return key;
}

/** Whether `candidate` could still be the answer after `guess` showed its clues against `answer`. */
export function fits(guess: Pokemon, answer: Pokemon, candidate: Pokemon, rules: Pick<DleRules, "columns" | "close"> = CLASSIC_RULES): boolean {
  return clueKey(compare(guess, candidate, rules)) === clueKey(compare(guess, answer, rules));
}

/**
 * How many of `pool` still fit after each guess, in order (the first number
 * is after guess 1). Each guess only filters what the guesses before it left,
 * so a whole board costs little more than one pass over the pool.
 */
export function stillPossible(answer: Pokemon, guesses: readonly Pokemon[], pool: readonly Pokemon[], rules: Pick<DleRules, "columns" | "close"> = CLASSIC_RULES): number[] {
  let left = pool;
  return guesses.map((guess) => {
    const want = clueKey(compare(guess, answer, rules));
    left = left.filter((candidate) => clueKey(compare(guess, candidate, rules)) === want);
    return left.length;
  });
}
