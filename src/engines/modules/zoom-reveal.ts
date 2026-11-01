import type { QuestionBuilder } from "../types";
import { zoomCropCount } from "@/lib/server/zoom-reveal";
import { clampRating, describe, difficultyPool, genRating, pickTarget } from "../shared";

/**
 * Zoom Reveal: name the Pokémon from an extreme close-up of its official
 * artwork. Every wrong name or skip zooms out one step (six in all, the last
 * the whole artwork); the fewer steps, the more points.
 *
 * The start crop is one of the Pokémon's precomputed high-detail regions
 * (src/lib/zoom-reveal-crop.ts), chosen by the question's own random stream,
 * so a seed (the daily, a duel, a challenge link) shows everyone the same
 * crop. Each step's image is cut on the server and only ever reaches the
 * browser through an encrypted media token.
 */

/** Typed answers are harder than picking from four. */
const TYPED_BONUS = 160;

export const zoomReveal: QuestionBuilder = (rng, opts) => {
  const pool = difficultyPool(opts);
  const target = pickTarget(rng, pool, opts.used, (p) => zoomCropCount(p.id) > 0);
  if (!target) return null;
  const crop = rng.int(0, zoomCropCount(target.id) - 1);
  return {
    itemKey: `zoom-reveal:${target.id}:${crop}`,
    module: "zoom-reveal",
    prompt: "Zoom Reveal: who's that Pokémon?",
    media: { kind: "zoom-reveal", pokemonId: target.id, step: 1, crop },
    revealMedia: { kind: "artwork", pokemonId: target.id },
    options: [],
    input: "name",
    answer: target.name,
    explanation: describe(target),
    rating: clampRating(genRating(target) + TYPED_BONUS),
  };
};
