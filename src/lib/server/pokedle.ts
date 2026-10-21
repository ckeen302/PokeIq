import "server-only";
import { artworkUrl, formatHeight, formatWeight, getPokemon, poolFor, type Pokemon } from "@/lib/pokemon/pokedex";
import { capitalize } from "@/lib/pokemon/type-matrix";
import { deriveSeed } from "./crypto";
import { hashString } from "@/lib/rng";
import { mediaUrl } from "./session";
import { dailyAnswerId } from "./pokedle-schedule";
import { DLE_COLUMNS, dleScore, type DleColumn, type DleHint, type DleResponse, type DleRow } from "@/lib/dle-types";
import { CLASSIC_RULES, dailyRules, rulesBonus, type DleDailyFormat, type DleRules } from "@/lib/dle-format";
import { DLE_DEFAULT_ASSIST, type DleAssist } from "@/lib/dle-assist";
import { compareTraits, panelMisfit, stageLabel, type DleTraits } from "@/lib/dle-compare";

/**
 * Pokédle — daily Pokémon deduction, in Classic, Squirdle-style or custom
 * formats (dle-format.ts).
 *
 * A daily's answer comes from the curated schedule (pokedle-schedule.ts),
 * one per format; a practice puzzle's is HMAC(secret, puzzleId) mod pool.
 * Either way it's the same for every player but can't be computed from the
 * open-source code. The API is stateless: the client sends its guess list
 * (and, for practice, its settings) and gets every row's feedback
 * recomputed under the rules the server settles on, which keeps the server
 * free of per-player storage.
 */

export interface DlePuzzle {
  /** "daily:YYYY-MM-DD" (Classic), "squirdle:YYYY-MM-DD" (the Squirdle-style daily) or "practice:<seed>". */
  id: string;
  gens?: number[];
  /** Legendary and mythical Pokémon only. */
  legendary?: boolean;
}

/** A format's daily puzzle on `date`. */
export const dailyPuzzleOf = (date: string, format: DleDailyFormat = "classic"): DlePuzzle => ({ id: `${format === "squirdle" ? "squirdle" : "daily"}:${date}` });

/** A practice puzzle under `rules` (their generations and pool). */
export const practicePuzzle = (seed: string, rules: Pick<DleRules, "gens" | "pool">): DlePuzzle => ({
  id: `practice:${seed}`,
  gens: rules.gens,
  ...(rules.pool === "legendary" && { legendary: true }),
});

/** The Pokémon a puzzle can be: its generations, and only legendary and mythical ones if asked (never an empty pool). */
export function puzzlePool(puzzle: Pick<DlePuzzle, "gens" | "legendary">): Pokemon[] {
  const pool = poolFor(puzzle.gens);
  if (!puzzle.legendary) return pool;
  const rare = pool.filter((p) => p.legendary || p.mythical);
  return rare.length ? rare : pool;
}

export function answerFor(puzzle: DlePuzzle): Pokemon {
  if (puzzle.id.startsWith("daily:") && !puzzle.gens?.length) return getPokemon(dailyAnswerId(puzzle.id.slice(6)))!;
  if (puzzle.id.startsWith("squirdle:")) return getPokemon(dailyAnswerId(puzzle.id.slice(9), "squirdle"))!;
  const pool = puzzlePool(puzzle);
  // Every-Pokémon puzzles keep the key they had before pools.
  const key = `${puzzle.id}|${(puzzle.gens ?? []).join(",")}${puzzle.legendary ? "|legendary" : ""}`;
  return pool[hashString(deriveSeed("pokedle", key)) % pool.length];
}

/** The rules of a daily puzzle (the same for everyone), or null for practice. */
export function puzzleRules(puzzle: DlePuzzle): DleRules | null {
  if (puzzle.id.startsWith("squirdle:")) return dailyRules("squirdle");
  if (puzzle.id.startsWith("daily:")) return CLASSIC_RULES;
  return null;
}

/**
 * Baby Pokémon (PokéAPI's is_baby): a stage of their own, below 1, and not
 * counted in their family's stages, so Pikachu is stage 1 and Raichu 2 as
 * players expect, with Pichu a Baby. Checked against the Pokédex data in
 * tests/pokedle-clues.test.ts.
 */
export const BABY_IDS: ReadonlySet<number> = new Set([172, 173, 174, 175, 236, 238, 239, 240, 298, 360, 406, 433, 438, 439, 440, 446, 447, 458, 848]);

/** Pokédle's evolution stage: 0 for a baby, else the stage counted from the first non-baby. */
export function dleStage(p: Pokemon): number {
  if (BABY_IDS.has(p.id)) return 0;
  let stage = p.stage;
  for (let q = p; q.evolvesFrom; ) {
    q = getPokemon(q.evolvesFrom)!;
    if (BABY_IDS.has(q.id)) stage--;
  }
  return stage;
}

/** The attributes Pokédle's clues compare. */
export function traitsOf(p: Pokemon): DleTraits {
  return { gen: p.gen, type1: p.types[0], type2: p.types[1] ?? null, height: p.height, weight: p.weight, color: p.color, stage: dleStage(p) };
}

/** How each of a guess's attributes reads on the board. */
function cellValues(t: DleTraits): Record<DleColumn, string> {
  return {
    gen: String(t.gen),
    type1: capitalize(t.type1),
    type2: t.type2 ? capitalize(t.type2) : "None",
    height: formatHeight(t.height),
    weight: formatWeight(t.weight),
    color: capitalize(t.color),
    stage: stageLabel(t.stage),
  };
}

/**
 * A guess's row: the clue of each column the rules show (from dle-compare,
 * the one definition of them all) with the guess's own values. Columns the
 * rules hide are never worked out, so they can't reach the browser.
 */
export function compare(guess: Pokemon, answer: Pokemon, rules: Pick<DleRules, "columns" | "close"> = CLASSIC_RULES): DleRow {
  const g = traitsOf(guess);
  const statuses = compareTraits(g, traitsOf(answer), rules);
  const values = cellValues(g);
  const cells: DleRow["cells"] = {};
  for (const key of rules.columns) cells[key] = { value: values[key], status: statuses[key]! };
  return { id: guess.id, name: guess.name, imageUrl: artworkUrl(guess.id), solved: guess.id === answer.id, cells };
}

/** The guesses that count: known Pokémon, each once, up to the limit, stopping at the answer. */
function countedGuesses(guessIds: number[], answer: Pokemon, max: number): Pokemon[] {
  const out: Pokemon[] = [];
  for (const id of guessIds) {
    if (out.length >= max) break;
    const guess = getPokemon(id);
    if (!guess || out.some((p) => p.id === id)) continue;
    out.push(guess);
    if (guess.id === answer.id) break;
  }
  return out;
}

/**
 * Hard mode: every guess must fit the generation and type clues so far,
 * the ones the Pokédex greys out for you (DLE_PANEL_COLUMNS), as Wordle's
 * hard mode holds you to the letters its keyboard shows, and only those the
 * game's rules show, as they show them. A Pokémon fits an earlier guess's
 * clues when, were it the answer, that guess would have got the same ones.
 * Height, weight, colour and stage aren't checked: a turned down guess
 * would tell you those for free. Null when every guess fits, else why one
 * doesn't.
 */
export function hardModeError(puzzle: DlePuzzle, guessIds: number[], rules: DleRules = CLASSIC_RULES): string | null {
  const answer = traitsOf(answerFor(puzzle));
  const guesses = countedGuesses(guessIds, answerFor(puzzle), rules.maxGuesses);
  for (let i = 1; i < guesses.length; i++) {
    const candidate = traitsOf(guesses[i]);
    for (const earlier of guesses.slice(0, i)) {
      const t = traitsOf(earlier);
      const column = panelMisfit(t, compareTraits(t, answer, rules), candidate, rules.close);
      if (column) {
        const label = DLE_COLUMNS.find((c) => c.key === column)!.label;
        return `Hard mode: ${guesses[i].name} doesn't fit the ${label} clue from ${earlier.name}.`;
      }
    }
  }
  return null;
}

/**
 * Every guess's clues (only the columns the rules show), and the hints asked
 * for (once there's a guess, while the puzzle is on, if the rules have
 * hints). Once it's over, the points too, at the Pokédex assist level the
 * game is played at, with the rules' bonus. `timedOut`: a timed game's clock
 * ran out, so it's over (and lost, unless already solved).
 */
export function evaluate(
  puzzle: DlePuzzle,
  guessIds: number[],
  hints: readonly DleHint[] = [],
  assist: DleAssist = DLE_DEFAULT_ASSIST,
  rules: DleRules = CLASSIC_RULES,
  timedOut = false
): DleResponse {
  const answer = answerFor(puzzle);
  const rows = countedGuesses(guessIds, answer, rules.maxGuesses).map((guess) => compare(guess, answer, rules));
  const solved = rows.some((r) => r.solved);
  const clockOut = !solved && timedOut && rules.timer !== "none";
  const over = solved || clockOut || rows.length >= rules.maxGuesses;
  const open = !over && rows.length > 0;
  const used = rules.hints ? hints : [];

  return {
    rules,
    rows,
    solved,
    over,
    ...(clockOut && { timedOut: true }),
    hints: {
      silhouetteUrl: open && used.includes("silhouette") ? mediaUrl({ kind: "silhouette", pokemonId: answer.id }) : undefined,
      genus: open && used.includes("genus") ? `The ${answer.genus}` : undefined,
    },
    score: over ? dleScore(rows.length, solved, used, assist, rulesBonus(rules)) : undefined,
    answer: over ? { id: answer.id, name: answer.name, imageUrl: artworkUrl(answer.id), genus: answer.genus } : undefined,
  };
}
