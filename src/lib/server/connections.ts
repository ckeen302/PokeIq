import "server-only";
import dailiesData from "@/data/connections-dailies.json";
import { categoryOf } from "@/lib/connections/categories";
import { factsOf } from "@/lib/connections/facts";
import { generatePuzzle, herringsOf, playGuesses, type Puzzle } from "@/lib/connections/generator";
import { connNumber, type ConnGroupExplained, type ConnGroupReveal, type ConnGuessResponse, type ConnLevel, type ConnPuzzleResponse, type ConnTile } from "@/lib/connections/types";

/**
 * PokéConnections on the server: which puzzle a date or practice seed is,
 * the tiles a player gets (never the groups), and every guess checked here
 * (stateless: the client sends all its guesses each time and they're played
 * again). The groups are only revealed as they're found, and all four, with
 * the "Why?" explanations, once the game is over.
 */

interface DailiesFile {
  start: string;
  /** Per day: each group as [category, ...members], easiest first; `t` the grid order. */
  puzzles: { g: (string | number)[][]; t: number[] }[];
}

const DAILIES = dailiesData as unknown as DailiesFile;
const DAY_MS = 86_400_000;

function fromFile(entry: DailiesFile["puzzles"][number]): Puzzle {
  return {
    groups: entry.g.map(([category, ...members]) => ({ category: String(category), members: members.map(Number) })),
    tiles: entry.t,
  };
}

/** The daily for a date: the pre-generated one, or (past the file's last day) one generated from the date. */
export function dailyConnPuzzle(date: string): Puzzle {
  const day = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${DAILIES.start}T00:00:00Z`)) / DAY_MS);
  const entry = DAILIES.puzzles[day];
  return entry ? fromFile(entry) : generatePuzzle(`daily:${date}`);
}

/** The number of pre-generated dailies (the rest are generated on demand). */
export const DAILIES_COUNT = DAILIES.puzzles.length;

const practiceCache = new Map<string, Puzzle>();

/** A practice puzzle: the same generator, seeded by the player's random seed. */
export function practiceConnPuzzle(seed: string): Puzzle {
  let p = practiceCache.get(seed);
  if (!p) {
    p = generatePuzzle(`practice:${seed}`);
    if (practiceCache.size > 500) practiceCache.clear();
    practiceCache.set(seed, p);
  }
  return p;
}

const tile = (id: number): ConnTile => ({ id, name: factsOf(id).name });

/** What a player starts with: sixteen tiles, in the grid's order. */
export function puzzleView(puzzle: Puzzle, key: string, date?: string): ConnPuzzleResponse {
  return { key, ...(date && { number: connNumber(date) }), tiles: puzzle.tiles.map(tile) };
}

function reveal(puzzle: Puzzle, level: ConnLevel): ConnGroupReveal {
  const g = puzzle.groups[level];
  return { level, label: categoryOf(g.category).label, members: g.members.map(tile) };
}

/** A group with its explanation: the rule, a line per Pokémon, and the red herrings that pointed at it. */
export function explainGroup(puzzle: Puzzle, level: ConnLevel): ConnGroupExplained {
  const c = categoryOf(puzzle.groups[level].category);
  return {
    ...reveal(puzzle, level),
    rule: c.rule,
    lines: puzzle.groups[level].members.map((id) => ({ ...tile(id), why: c.why(factsOf(id)) })),
    herrings: herringsOf(puzzle, level)
      .slice(0, 3)
      .map((h) => ({ ...tile(h.id), reason: h.reason })),
  };
}

/** Plays the guesses so far (see playGuesses; throws on a malformed guess) and says how it stands. */
export function checkGuesses(puzzle: Puzzle, guesses: number[][]): ConnGuessResponse {
  const state = playGuesses(puzzle, guesses);
  return {
    results: state.results,
    found: state.found.map((lv) => reveal(puzzle, lv)),
    mistakes: state.mistakes,
    over: state.over,
    won: state.won,
    ...(state.over && { reveal: ([0, 1, 2, 3] as ConnLevel[]).map((lv) => explainGroup(puzzle, lv)) }),
  };
}
