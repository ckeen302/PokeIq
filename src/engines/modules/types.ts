import type { Rng } from "@/lib/rng";
import type { Pokemon } from "@/lib/pokemon/pokedex";
import {
  TYPES,
  capitalize,
  defensiveProfile,
  effectiveness,
  formatMultiplier,
  type PokemonType,
} from "@/lib/pokemon/type-matrix";
import type { GenerateOptions, Question, QuestionBuilder } from "../types";
import { clampRating, difficultyPool, genRating, pickTarget, typeLabel } from "../shared";

/**
 * Type Master — every answer is computed from the 18×18 effectiveness
 * matrix, so correctness holds by construction. On hard, the defender's
 * typing is hidden: you need to know the Pokémon *and* the chart.
 */

function typingKey(types: readonly string[]): string {
  return [...types].sort().join("/");
}

function defenderLabel(p: Pokemon, opts: GenerateOptions): string {
  return opts.difficulty === "hard" ? p.name : `${p.name} (${typeLabel(p)})`;
}

function typingQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const target = pickTarget(rng, difficultyPool(opts), opts.used);
  if (!target) return null;

  const answerKey = typingKey(target.types);
  const candidates = new Map<string, PokemonType[]>();
  const add = (types: PokemonType[]) => {
    const key = typingKey(types);
    if (key !== answerKey && new Set(types).size === types.length) candidates.set(key, types);
  };
  // Near-misses first: each half of a dual typing, or a mono type plus a partner.
  for (const t of target.types) add([t]);
  for (let i = 0; i < 6; i++) add([target.types[0], rng.pick(TYPES)]);
  if (target.types[1]) add([rng.pick(TYPES), target.types[1]]);
  while (candidates.size < 8) add(rng.chance(0.5) ? [rng.pick(TYPES)] : [rng.pick(TYPES), rng.pick(TYPES)]);

  const label = (types: readonly string[]) => types.map(capitalize).join(" / ");
  const distractors = rng.sample([...candidates.values()].slice(0, 6), 3).map(label);

  return {
    itemKey: `types:typing:${target.id}`,
    module: "types",
    prompt: `What type is ${target.name}?`,
    media: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([label(target.types), ...distractors]),
    answer: label(target.types),
    explanation: `${target.name} is ${typeLabel(target)} type.`,
    rating: clampRating(genRating(target) + (target.types.length === 2 ? 60 : -40)),
  };
}

const MULTIPLIERS = [0, 0.25, 0.5, 1, 2, 4];

function effectivenessQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const target = pickTarget(rng, difficultyPool(opts), opts.used, (p) =>
    opts.difficulty === "easy" ? true : p.types.length === 2
  );
  if (!target) return null;

  const attacker = rng.pick(TYPES);
  const multiplier = effectiveness(attacker, target.types);
  // Neutral hits are dull — keep only a few of them.
  if (multiplier === 1 && rng.chance(0.75)) return null;

  const distractors = rng.sample(MULTIPLIERS.filter((m) => m !== multiplier), 3);
  const extreme = multiplier === 4 || multiplier === 0.25 || multiplier === 0;

  return {
    itemKey: `types:eff:${attacker}>${typingKey(target.types)}${opts.difficulty === "hard" ? ":hidden" : ""}`,
    module: "types",
    prompt: `How effective is a ${capitalize(attacker)}-type move against ${defenderLabel(target, opts)}?`,
    media: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([multiplier, ...distractors].map(formatMultiplier)),
    answer: formatMultiplier(multiplier),
    explanation: `${capitalize(attacker)} → ${typeLabel(target)} = ${target.types
      .map((t) => formatMultiplier(effectiveness(attacker, [t])))
      .join(" × ")} = ${formatMultiplier(multiplier)}.`,
    rating: clampRating(
      { easy: 950, medium: 1120, hard: 1350 }[opts.difficulty] + (extreme ? 80 : 0)
    ),
  };
}

function weaknessQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const target = pickTarget(rng, difficultyPool(opts), opts.used, (p) =>
    [...defensiveProfile(p.types).values()].includes(4)
  );
  if (!target) return null;

  const profile = defensiveProfile(target.types);
  const fourX = TYPES.filter((t) => profile.get(t) === 4);
  const answer = rng.pick(fourX);
  // Hard: tempt with plain 2× weaknesses. Otherwise anything below 4×.
  const tempting = TYPES.filter((t) => profile.get(t) === 2);
  const safe = TYPES.filter((t) => (profile.get(t) ?? 1) < 4);
  const pool = opts.difficulty === "hard" && tempting.length >= 2 ? tempting : safe;
  const distractors = rng.sample(pool, 3);
  if (distractors.length < 3) return null;

  return {
    itemKey: `types:4x:${typingKey(target.types)}${opts.difficulty === "hard" ? ":hidden" : ""}`,
    module: "types",
    prompt: `Which type is 4× super effective against ${defenderLabel(target, opts)}?`,
    media: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([answer, ...distractors].map(capitalize)),
    answer: capitalize(answer),
    explanation: `${typeLabel(target)} is 4× weak to ${fourX.map(capitalize).join(" and ")}.`,
    rating: clampRating({ easy: 1050, medium: 1200, hard: 1420 }[opts.difficulty]),
  };
}

function immunityQuestion(rng: Rng, opts: GenerateOptions): Question | null {
  const target = pickTarget(rng, difficultyPool(opts), opts.used, (p) =>
    [...defensiveProfile(p.types).values()].includes(0)
  );
  if (!target) return null;

  const profile = defensiveProfile(target.types);
  const immune = TYPES.filter((t) => profile.get(t) === 0);
  const answer = rng.pick(immune);
  const resisted = TYPES.filter((t) => (profile.get(t) ?? 1) === 0.5 || (profile.get(t) ?? 1) === 0.25);
  const notImmune = TYPES.filter((t) => profile.get(t) !== 0);
  const pool = opts.difficulty !== "easy" && resisted.length >= 3 ? resisted : notImmune;
  const distractors = rng.sample(pool, 3);
  if (distractors.length < 3) return null;

  return {
    itemKey: `types:immune:${typingKey(target.types)}${opts.difficulty === "hard" ? ":hidden" : ""}`,
    module: "types",
    prompt: `Which attacking type has NO effect on ${defenderLabel(target, opts)}?`,
    media: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([answer, ...distractors].map(capitalize)),
    answer: capitalize(answer),
    explanation: `${typeLabel(target)} is immune to ${immune.map(capitalize).join(" and ")}.`,
    rating: clampRating({ easy: 1000, medium: 1150, hard: 1380 }[opts.difficulty]),
  };
}

export const types: QuestionBuilder = (rng, opts) => {
  const roll = rng.next();
  if (roll < 0.3) return typingQuestion(rng, opts);
  if (roll < 0.65) return effectivenessQuestion(rng, opts);
  if (roll < 0.85) return weaknessQuestion(rng, opts);
  return immunityQuestion(rng, opts);
};
