import "server-only";
import { artworkUrl, formatHeight, formatWeight, getPokemon, poolFor, type Pokemon } from "@/lib/pokemon/pokedex";
import { capitalize } from "@/lib/pokemon/type-matrix";
import { deriveSeed } from "./crypto";
import { hashString } from "@/lib/rng";
import { mediaUrl } from "./session";
import { DLE_HINTS, DLE_MAX_GUESSES, type DleCell, type DleResponse, type DleRow } from "@/lib/dle-types";

/**
 * Pokédle — daily Pokémon deduction (Squirdle-style).
 *
 * The answer is HMAC(secret, puzzleId) mod pool, so it's identical for every
 * player that day but can't be computed from the open-source code. The API is
 * stateless: the client sends its guess list and gets every row's feedback
 * recomputed, which keeps the server free of per-player storage.
 */

export interface DlePuzzle {
  id: string;
  gens?: number[];
}

export function answerFor(puzzle: DlePuzzle): Pokemon {
  const pool = poolFor(puzzle.gens);
  const key = `${puzzle.id}|${(puzzle.gens ?? []).join(",")}`;
  return pool[hashString(deriveSeed("pokedle", key)) % pool.length];
}

function compareNumber(guess: number, answer: number, label: string): DleCell {
  if (guess === answer) return { value: label, status: "match" };
  return { value: label, status: answer > guess ? "higher" : "lower" };
}

function compareType(guess: Pokemon, answer: Pokemon, slot: 0 | 1): DleCell {
  const g = guess.types[slot];
  const a = answer.types[slot];
  if (!g) return { value: "None", status: a ? "miss" : "match" };
  if (g === a) return { value: capitalize(g), status: "match" };
  return { value: capitalize(g), status: answer.types.includes(g) ? "partial" : "miss" };
}

export function compare(guess: Pokemon, answer: Pokemon): DleRow {
  return {
    id: guess.id,
    name: guess.name,
    imageUrl: artworkUrl(guess.id),
    solved: guess.id === answer.id,
    cells: {
      gen: compareNumber(guess.gen, answer.gen, String(guess.gen)),
      type1: compareType(guess, answer, 0),
      type2: compareType(guess, answer, 1),
      height: compareNumber(guess.height, answer.height, formatHeight(guess.height)),
      weight: compareNumber(guess.weight, answer.weight, formatWeight(guess.weight)),
      color: { value: capitalize(guess.color), status: guess.color === answer.color ? "match" : "miss" },
      stage: compareNumber(guess.stage, answer.stage, String(guess.stage)),
    },
  };
}

export function evaluate(puzzle: DlePuzzle, guessIds: number[]): DleResponse {
  const answer = answerFor(puzzle);
  const rows: DleRow[] = [];
  for (const id of guessIds.slice(0, DLE_MAX_GUESSES)) {
    const guess = getPokemon(id);
    if (!guess || rows.some((r) => r.id === id)) continue;
    rows.push(compare(guess, answer));
    if (guess.id === answer.id) break;
  }

  const solved = rows.some((r) => r.solved);
  const over = solved || rows.length >= DLE_MAX_GUESSES;
  const misses = rows.filter((r) => !r.solved).length;

  return {
    rows,
    solved,
    over,
    hints: {
      silhouetteUrl:
        !over && misses >= DLE_HINTS.silhouette ? mediaUrl({ kind: "silhouette", pokemonId: answer.id }) : undefined,
      genus: !over && misses >= DLE_HINTS.genus ? `The ${answer.genus}` : undefined,
    },
    answer: over
      ? { id: answer.id, name: answer.name, imageUrl: artworkUrl(answer.id), genus: answer.genus }
      : undefined,
  };
}
