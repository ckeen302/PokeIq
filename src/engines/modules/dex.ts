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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Redact the target's name — and its whole evolution family, since entries
 * like "it evolves into Raichu" would give the answer away.
 */
export function censorEntry(text: string, target: Pokemon): string {
  const names = [...new Set(evolutionFamily(target).flatMap((p) => [p.name, p.slug]))]
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of names) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), REDACTED);
  }
  return out;
}

function entryQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const pool = difficultyPool(opts);
  const target = pickTarget(rng, pool, opts.used, (p) => p.flavor.length > 0);
  if (!target) return null;

  const entry = censorEntry(rng.pick(target.flavor), target);
  if (entry.length < 40 || entry.toLowerCase().includes(target.name.toLowerCase())) return null;

  const distractors = pickDistractors(rng, target, pool, 3, SIMILARITY_BY_DIFFICULTY[opts.difficulty]);
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
