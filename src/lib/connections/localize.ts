import { Rng } from "@/lib/rng";
import type { Locale } from "@/i18n/config";
import { ALL_CATEGORIES, CATEGORIES, categoryOf, type Category } from "./categories";
import { FACTS, SV, factsOf, type Facts } from "./facts";
import { SECOND_SOLUTION, bandOf, isUniquelySolvable, secondAnswers, validatePuzzle, type Puzzle, type PuzzleGroup } from "./generator";
import { isPokemonTile } from "./tiles";

/**
 * PokéConnections in other languages: one puzzle for everyone, except groups that only work with the English names.
 *
 * A group about the names' letters ("Starts with P", "Name ends in -eon", "Hides a colour in its name", "Named after
 * food"...) makes no sense with the names in Japanese or French. On such a day every other language plays the same
 * puzzle with THAT group swapped for a group of the same colour that doesn't depend on the names (the category says
 * so: Category.englishOnly). The swap is a pure function of the puzzle and its key ("daily:2026-10-22"): every
 * language but English gets the same replacement, so players can still compare, and English never changes.
 *
 * The replacement keeps the puzzle fair, as the generator's own are (validatePuzzle, secondAnswers): its Pokémon
 * aren't anywhere else on the board and fit no other group, no other tile fits it, and on a 5×5 board the grid still
 * splits only one way. Its tiles take the old group's places in the grid.
 */

/** Whether a category only works with the English names (see Category.englishOnly). */
export const isEnglishOnly = (c: Category) => c.englishOnly === true;

/** Every English-only category id. */
export const ENGLISH_ONLY: ReadonlySet<string> = new Set(ALL_CATEGORIES.filter(isEnglishOnly).map((c) => c.id));

/** Whether a puzzle in this language needs no swap: English, or a puzzle without English-only groups. */
export const needsSwap = (puzzle: { groups: readonly PuzzleGroup[] }, locale: Locale) =>
  locale !== "en" && puzzle.groups.some((g) => ENGLISH_ONLY.has(g.category));

const POOL = FACTS.filter((f) => f.pooled);
/** Every category a replacement may be: an ordinary (not mixed) one that works in every language. */
const REPLACEMENTS = CATEGORIES.filter((c) => !c.mixed && !isEnglishOnly(c));
/** Categories tried per swap, and ways to fill each. */
const CANDIDATES = 200;
const FILLS = 40;

export interface SwapOptions {
  /** Categories never to use (switched off by moderators). */
  exclude?: ReadonlySet<string>;
}

/** Four (or five) Pokémon for `c` beside the other groups (the old group's may come back), or null. */
function fillGroup(rng: Rng, c: Category, size: number, others: readonly Category[], otherTiles: readonly Facts[], risky: readonly Category[]): number[] | null {
  const sv = c.needsSV || others.some((o) => o.needsSV);
  // No tile already on the board may fit the new group, nor be outside a game its facts need.
  if (otherTiles.some((f) => c.test(f) || c.guard?.(f) || (c.needsSV && f.learnsetGame !== SV))) return null;
  const used = new Set(otherTiles.map((f) => f.familyKey));
  const eligible = POOL.filter((f) => c.test(f) && !used.has(f.familyKey) && (!sv || f.learnsetGame === SV) && others.every((o) => !o.test(f) && !o.guard?.(f)));
  // Red herrings make a better group: Pokémon another group's lure points at come up more often (as the generator's do).
  // So do Pokémon that keep a link the board's other tiles share from becoming a lookalike group of exactly four.
  const weight = (f: Facts) => 1 + 2 * others.filter((o) => o.lure?.(f)).length + 6 * risky.filter((r) => r.test(f)).length;
  const out: number[] = [];
  let pool = eligible;
  while (out.length < size) {
    const total = pool.reduce((s, f) => s + weight(f), 0);
    if (!total) return null;
    let r = rng.next() * total;
    const f = pool.find((g) => (r -= weight(g)) < 0) ?? pool[pool.length - 1];
    out.push(f.id);
    pool = pool.filter((g) => g.familyKey !== f.familyKey);
  }
  return out;
}

/**
 * Whether new groups give the board a lookalike group or a second solution it didn't have (ignoring the English-only
 * links, which mean nothing in another language). A few early dailies already had a lookalike among the Pokémon a
 * swap keeps: that one may stay, but a swap never adds one.
 */
export function addsAnswers(before: ReadonlySet<string>, groups: readonly PuzzleGroup[]): boolean {
  const hadSecond = [...before].some((a) => a.startsWith(SECOND_SOLUTION));
  return secondAnswers({ groups }, false, isEnglishOnly).some((a) => (a.startsWith(SECOND_SOLUTION) ? !hadSecond : !before.has(a)));
}

/**
 * Every fair way to refill group `level` (validatePuzzle), in a fixed order for the key: categories of the old one's
 * difficulty band first, then the bands either side; its Pokémon take the old ones' places in the grid.
 */
function* refills(puzzle: Puzzle, level: number, key: string, options: SwapOptions): Generator<Puzzle> {
  const size = puzzle.groups.length;
  const rng = new Rng(`pokeconnections-swap:${key}:${level}`);
  const keep = puzzle.groups.filter((_, i) => i !== level);
  const others = keep.map((g) => categoryOf(g.category));
  const otherTiles = keep.flatMap((g) => g.members).filter(isPokemonTile).map(factsOf);
  const taken = new Set(puzzle.groups.map((g) => g.category));
  const families = new Set(others.map((c) => c.family));
  const usable = (c: Category) => !taken.has(c.id) && !options.exclude?.has(c.id) && !families.has(c.family);
  const band = bandOf(categoryOf(puzzle.groups[level].category));
  // Links exactly a group's worth of the kept tiles share: the old group may have held a fifth.
  const risky = ALL_CATEGORIES.filter((c) => !isEnglishOnly(c) && !taken.has(c.id) && otherTiles.filter((f) => c.test(f)).length === size);
  for (const b of [band, band - 1, band + 1]) {
    for (const c of rng.shuffle(REPLACEMENTS.filter((c) => bandOf(c) === b && usable(c))).slice(0, CANDIDATES)) {
      for (let i = 0; i < FILLS; i++) {
        const members = fillGroup(rng, c, size, others, otherTiles, risky);
        if (!members) break;
        const groups = puzzle.groups.map((g, gi) => (gi === level ? { category: c.id, members } : { category: g.category, members: [...g.members] }));
        if (validatePuzzle({ groups }).length) continue;
        const at = new Map(puzzle.groups[level].members.map((id, k) => [id, members[k]]));
        yield { groups, tiles: puzzle.tiles.map((id) => at.get(id) ?? id) };
      }
    }
  }
}

/** Refills tried for one group, at most; with two to swap, the first's tries each try the second's. */
const TRIES_ONE = 3000;
const TRIES_OUTER = 100;
const TRIES_INNER = 300;

/** Swaps the groups at `levels[from…]` in turn; the finished board must add no second answer and (5×5) split one way. */
function swapAll(puzzle: Puzzle, levels: readonly number[], from: number, key: string, ctx: { before: ReadonlySet<string>; options: SwapOptions }): Puzzle | null {
  if (from === levels.length) {
    if (addsAnswers(ctx.before, puzzle.groups)) return null;
    if (puzzle.groups.length === 5 && !isUniquelySolvable(puzzle.tiles)) return null;
    return puzzle;
  }
  let left = levels.length === 1 ? TRIES_ONE : from === levels.length - 1 ? TRIES_INNER : TRIES_OUTER;
  for (const next of refills(puzzle, levels[from], key, ctx.options)) {
    if (--left < 0) return null;
    const out = swapAll(next, levels, from + 1, key, ctx);
    if (out) return out;
  }
  return null;
}

const cache = new Map<string, Puzzle>();

/**
 * The puzzle as players in `locale` get it: English and puzzles without English-only groups unchanged (the same
 * object); otherwise its English-only groups swapped (see above). `key` names the puzzle ("daily:<date>",
 * "practice:<seed>"): the same key, puzzle and options always give the same result, in every language but English.
 * If no replacement fits (never in the dailies: tests/connections-localize.test.ts), the puzzle stays as it is.
 */
export function localizedPuzzle(puzzle: Puzzle, key: string, locale: Locale, options: SwapOptions = {}): Puzzle {
  if (!needsSwap(puzzle, locale)) return puzzle;
  const memo = `${key}|${puzzle.groups.map((g) => `${g.category}:${g.members.join(",")}`).join(";")}|${[...(options.exclude ?? [])].sort().join(",")}`;
  const hit = cache.get(memo);
  if (hit) return hit;
  const levels = puzzle.groups.map((g, level) => (ENGLISH_ONLY.has(g.category) ? level : -1)).filter((l) => l >= 0);
  const before = new Set(secondAnswers(puzzle, false, isEnglishOnly));
  const out = swapAll(puzzle, levels, 0, key, { before, options }) ?? puzzle;
  if (cache.size > 500) cache.clear();
  cache.set(memo, out);
  return out;
}
