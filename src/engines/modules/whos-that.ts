import type { QuestionBuilder } from "../types";
import { evolutionFamily } from "@/lib/pokemon/pokedex";
import { lookalikesOf } from "@/lib/pokemon/lookalikes";
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
 * Who's That Pokémon? — silhouette recognition.
 *
 * The silhouette is rendered server-side (src/app/api/media) from an
 * encrypted media token, so the browser never receives the full-colour art
 * (or the dex number in a URL) until after the answer is locked in.
 *
 * Hard mode draws wrong answers from the silhouette lookalike index (DINOv2
 * embeddings), so the options genuinely share a shape; medium mixes in one.
 */

const SIMILARITY_BONUS = { random: 0, type: 90, close: 180 };
const LOOKALIKES_BY_DIFFICULTY = { easy: 0, medium: 1, hard: 3 } as const;

export const whosThat: QuestionBuilder = (rng, opts) => {
  const pool = difficultyPool(opts);
  const target = pickTarget(rng, pool, opts.used);
  if (!target) return null;

  const similarity = SIMILARITY_BY_DIFFICULTY[opts.difficulty];
  const zoom = opts.difficulty === "hard" && rng.chance(0.4);

  const inPool = new Set(pool.map((p) => p.id));
  const family = new Set(evolutionFamily(target).map((p) => p.id));
  const lookalikes = rng
    .sample(
      lookalikesOf(target.id, (p) => inPool.has(p.id) && !family.has(p.id)).slice(0, 6),
      LOOKALIKES_BY_DIFFICULTY[opts.difficulty]
    )
    .map((l) => l.pokemon);
  const taken = new Set(lookalikes.map((p) => p.id));
  const rest = pickDistractors(rng, target, pool, 3 - lookalikes.length, similarity, (p) => !taken.has(p.id));
  const distractors = [...lookalikes, ...rest];
  if (distractors.length < 3) return null;

  return {
    itemKey: `whos-that:${target.id}${zoom ? ":zoom" : ""}:${opts.difficulty}`,
    module: "whos-that",
    prompt: zoom ? "Who's that Pokémon? (Zoomed in!)" : "Who's that Pokémon?",
    media: { kind: zoom ? "silhouette-zoom" : "silhouette", pokemonId: target.id },
    revealMedia: { kind: "artwork", pokemonId: target.id },
    options: rng.shuffle([target, ...distractors].map((p) => p.name)),
    answer: target.name,
    explanation: describe(target),
    rating: clampRating(genRating(target) + SIMILARITY_BONUS[similarity] + lookalikes.length * 40 + (zoom ? 220 : 0)),
  };
};
