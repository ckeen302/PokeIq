import type { Rng } from "@/lib/rng";
import { POKEDEX, evolutionFamily, titleCase, type Pokemon } from "@/lib/pokemon/pokedex";
import type { GenerateOptions, Question, QuestionBuilder } from "../types";
import {
  SIMILARITY_BY_DIFFICULTY,
  clampRating,
  describe,
  difficultyPool,
  genRating,
  pickDistractors,
  pickTarget,
} from "../shared";

/**
 * Dex Detective — Pokédex knowledge.
 *   entry:   identify a Pokémon from its (censored) Pokédex entry
 *   genus:   "Which Pokémon is known as the Seed Pokémon?"
 *   ability: "Which of these is one of Gengar's abilities?"
 */

const REDACTED = "▇▇▇";

/** Lower-case, accent- and apostrophe-folded copy of a single character. */
function foldChar(ch: string): string {
  return ch
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}

/** Fold text for comparison: accents stripped, apostrophes and whitespace unified. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A pattern matching a name however an entry spells it: case- and
 * accent-insensitive, any short punctuation between its parts
 * ("Mr. Mime", "Farfetch’d", "Ho-Oh"), and gender symbols ignored
 * ("Nidoran♀" also matches a bare "Nidoran"). Boundaries are Unicode-aware,
 * so a trailing "é" or "." never defeats them.
 */
function namePattern(name: string): string | null {
  const parts = foldText(name).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (parts.join("").length < 3) return null;
  const body = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]{0,2}");
  return `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
}

const regexCache = new Map<string, RegExp | null>();

function namesRegex(pokemon: readonly Pokemon[]): RegExp | null {
  const key = pokemon.map((p) => p.id).join(",");
  if (!regexCache.has(key)) regexCache.set(key, compileNames(pokemon));
  return regexCache.get(key)!;
}

function compileNames(pokemon: readonly Pokemon[]): RegExp | null {
  const patterns = [...new Set(pokemon.flatMap((p) => [namePattern(p.name), namePattern(p.slug)]))]
    .filter((x): x is string => x !== null)
    .sort((a, b) => b.length - a.length);
  // Patterns and haystacks are both pre-folded to lower case, so no `i` flag
  // (case-insensitive Unicode regexes are far slower to compile).
  return patterns.length ? new RegExp(patterns.join("|"), "gu") : null;
}

/**
 * Redact the target's name — and its whole evolution family, since entries
 * like "it evolves into Raichu" would give the answer away. Matching runs on
 * a folded copy whose characters line up one-to-one with the original.
 */
export function censorEntry(text: string, target: Pokemon): string {
  const re = namesRegex(evolutionFamily(target));
  if (!re) return text;
  const chars = [...text];
  const folded = chars.map((ch) => {
    const f = ch < "\x80" ? ch.toLowerCase() : foldChar(ch);
    return f.length === 1 ? f : ch;
  });
  const haystack = folded.join("");
  // Map UTF-16 offsets in the folded copy back to code-point indices.
  const indexAt: number[] = [];
  folded.forEach((ch, i) => {
    for (let k = 0; k < ch.length; k++) indexAt.push(i);
  });
  indexAt.push(chars.length);

  let out = "";
  let cursor = 0;
  for (const m of haystack.matchAll(re)) {
    const start = indexAt[m.index];
    const end = indexAt[m.index + m[0].length];
    out += chars.slice(cursor, start).join("") + REDACTED;
    cursor = end;
  }
  return out + chars.slice(cursor).join("");
}

/** True when any spelling of the target's name survives in the text. */
export function leaksName(text: string, target: Pokemon): boolean {
  const re = namesRegex([target]);
  return re !== null && foldText(text).search(re) !== -1;
}

/**
 * Entry texts shared by several species (the six Ultra Beasts share one)
 * can't identify a single answer, so they are never served.
 */
const FOLDED_FLAVOR = new Map(POKEDEX.map((p) => [p.id, p.flavor.map(foldText)]));

const SERVABLE_ENTRIES: ReadonlyMap<number, string[]> = (() => {
  const owners = new Map<string, Set<number>>();
  for (const [id, folded] of FOLDED_FLAVOR) {
    for (const key of folded) owners.set(key, (owners.get(key) ?? new Set()).add(id));
  }
  return new Map(
    POKEDEX.map((p) => [p.id, p.flavor.filter((_, i) => owners.get(FOLDED_FLAVOR.get(p.id)![i])!.size === 1)])
  );
})();

function servableEntries(p: Pokemon): string[] {
  return SERVABLE_ENTRIES.get(p.id) ?? [];
}

function entryQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const pool = difficultyPool(opts);
  const target = pickTarget(rng, pool, opts.used, (p) => servableEntries(p).length > 0);
  if (!target) return null;

  const original = rng.pick(servableEntries(target));
  const entry = censorEntry(original, target);
  if (entry.length < 40 || leaksName(entry, target)) return null;

  // A distractor whose own entries contain this text would also be correct.
  const shown = foldText(original);
  const distractors = pickDistractors(
    rng,
    target,
    pool,
    3,
    SIMILARITY_BY_DIFFICULTY[opts.difficulty],
    (p) => !(FOLDED_FLAVOR.get(p.id) ?? []).some((f) => f.includes(shown))
  );
  if (distractors.length < 3) return null;

  return {
    itemKey: `dex:entry:${target.id}`,
    module: "dex",
    prompt: "Which Pokémon does this Pokédex entry describe?",
    detail: opts.difficulty === "easy" ? `“${entry}” — the ${target.genus}` : `“${entry}”`,
    revealMedia: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([target, ...distractors].map((p) => p.name)),
    answer: target.name,
    explanation: describe(target),
    rating: clampRating(genRating(target) + (opts.difficulty === "easy" ? 40 : 180)),
  };
}

function genusQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const pool = difficultyPool(opts);
  const target = pickTarget(rng, pool, opts.used, (p) => p.genus.length > 0);
  if (!target) return null;

  // Several species share a genus ("Seed Pokémon" ×3): distractors must not.
  const distractors = pickDistractors(
    rng,
    target,
    pool,
    3,
    SIMILARITY_BY_DIFFICULTY[opts.difficulty],
    (p) => p.genus !== target.genus
  );
  if (distractors.length < 3) return null;

  return {
    itemKey: `dex:genus:${target.id}`,
    module: "dex",
    prompt: `Which Pokémon is known as the “${target.genus}”?`,
    revealMedia: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([target, ...distractors].map((p) => p.name)),
    answer: target.name,
    explanation: describe(target),
    rating: clampRating(genRating(target) + 220),
  };
}

const ALL_ABILITIES = [...new Set(POKEDEX.flatMap((p) => p.abilities.map((a) => a.name)))];

function abilityQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const pool = difficultyPool(opts);
  const target = pickTarget(rng, pool, opts.used, (p) => p.abilities.length > 0);
  if (!target) return null;

  const own = new Set(target.abilities.map((a) => a.name));
  const correct = rng.pick(target.abilities);
  // Hard mode draws distractors from same-type Pokémon so they "feel" right.
  const sameType = POKEDEX.filter((p) => p.types.some((t) => target.types.includes(t)));
  const source =
    opts.difficulty === "easy"
      ? ALL_ABILITIES
      : [...new Set(sameType.flatMap((p) => p.abilities.map((a) => a.name)))];
  const distractors = rng.sample(source.filter((a) => !own.has(a)), 3);
  if (distractors.length < 3) return null;

  const owned = target.abilities
    .map((a) => `${titleCase(a.name)}${a.hidden ? " (hidden)" : ""}`)
    .join(", ");

  return {
    itemKey: `dex:ability:${target.id}:${correct.name}`,
    module: "dex",
    prompt: `Which of these is one of ${target.name}'s abilities?`,
    media: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([correct.name, ...distractors].map(titleCase)),
    answer: titleCase(correct.name),
    explanation: `${target.name}'s abilities: ${owned}.`,
    rating: clampRating(1150 + (correct.hidden ? 200 : 0) + (opts.difficulty === "easy" ? 0 : 120)),
  };
}

export const dex: QuestionBuilder = (rng, opts) => {
  const roll = rng.next();
  if (roll < 0.6) return entryQuestion(rng, opts);
  if (roll < 0.82) return genusQuestion(rng, opts);
  return abilityQuestion(rng, opts);
};
