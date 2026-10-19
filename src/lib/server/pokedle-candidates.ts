import "server-only";
import type { Pokemon } from "@/lib/pokemon/pokedex";
import type { DleRow } from "@/lib/dle-types";
import { compare } from "./pokedle";

/**
 * "Pokémon still possible": how many Pokémon fit every clue a trainer has
 * been shown.
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
export function fits(guess: Pokemon, answer: Pokemon, candidate: Pokemon): boolean {
  return clueKey(compare(guess, candidate)) === clueKey(compare(guess, answer));
}

/**
 * How many of `pool` still fit after each guess, in order (the first number
 * is after guess 1). Each guess only filters what the guesses before it left,
 * so a whole board costs little more than one pass over the pool.
 */
export function stillPossible(answer: Pokemon, guesses: readonly Pokemon[], pool: readonly Pokemon[]): number[] {
  let left = pool;
  return guesses.map((guess) => {
    const want = clueKey(compare(guess, answer));
    left = left.filter((candidate) => clueKey(compare(guess, candidate)) === want);
    return left.length;
  });
}
