import type { QuestionBuilder } from "../types";
import {
  SIMILARITY_BY_DIFFICULTY,
  clampRating,
  describe,
  difficultyPool,
  genRating,
  pickDistractors,
  pickTarget,
  typeLabel,
} from "../shared";

/** Cry Quiz — identify a Pokémon from its in-game cry (audio served via media token). */
export const cry: QuestionBuilder = (rng, opts) => {
  const pool = difficultyPool(opts);
  const target = pickTarget(rng, pool, opts.used);
  if (!target) return null;

  const distractors = pickDistractors(rng, target, pool, 3, SIMILARITY_BY_DIFFICULTY[opts.difficulty]);
  if (distractors.length < 3) return null;

  const hint = {
    easy: `Hint: it's a ${typeLabel(target)} type from Gen ${target.gen}.`,
    medium: `Hint: it debuted in Gen ${target.gen}.`,
    hard: undefined,
  }[opts.difficulty];

  return {
    itemKey: `cry:${target.id}:${opts.difficulty}`,
    module: "cry",
    prompt: "Whose cry is this?",
    detail: hint,
    media: { kind: "cry", pokemonId: target.id },
    revealMedia: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([target, ...distractors].map((p) => p.name)),
    answer: target.name,
    explanation: describe(target),
    rating: clampRating(genRating(target) + { easy: 120, medium: 280, hard: 420 }[opts.difficulty]),
  };
};
