import type { Rng } from "@/lib/rng";
import type { Difficulty, GenerateOptions, Question, QuestionBuilder } from "../types";
import type { TriviaItem } from "../trivia/bank";
import { GAMES_BANK } from "../trivia/games";
import { ANIME_BANK } from "../trivia/anime";

/**
 * Mainline Games and Pokémon Anime: fixed, source-checked question banks
 * (src/engines/trivia). A session mixes difficulties, weighted towards the
 * chosen one; the optional generation (games) or series (anime) filter
 * narrows the bank. The `used` set keeps a question from repeating in a run.
 */

const MIX: Record<Difficulty, [Difficulty, number][]> = {
  easy: [["easy", 0.65], ["medium", 0.3], ["hard", 0.05]],
  medium: [["easy", 0.3], ["medium", 0.45], ["hard", 0.25]],
  hard: [["easy", 0.05], ["medium", 0.35], ["hard", 0.6]],
};

export const TRIVIA_RATING: Record<Difficulty, number> = { easy: 950, medium: 1150, hard: 1350 };

function rollDifficulty(rng: Rng, setting: Difficulty): Difficulty {
  let roll = rng.next();
  for (const [d, w] of MIX[setting]) if ((roll -= w) < 0) return d;
  return setting;
}

function triviaBuilder(module: "games" | "anime", bank: readonly TriviaItem[], offset: number): QuestionBuilder {
  return (rng: Rng, opts: GenerateOptions): Question | null => {
    const filter = opts.gens && opts.gens.length > 0 ? new Set(opts.gens) : null;
    const open = bank
      .map((item, i) => ({ item, key: offset + i }))
      .filter(({ item, key }) => !opts.used.has(key) && (!filter || filter.has(item.group)));
    if (open.length === 0) return null;
    const wanted = rollDifficulty(rng, opts.difficulty);
    const tier = open.filter(({ item }) => item.difficulty === wanted);
    const { item, key } = rng.pick(tier.length ? tier : open);
    opts.used.add(key);
    const options = rng.shuffle([item.answer, ...rng.sample(item.distractors, 3)]);
    return {
      itemKey: `${module}:${item.id}`,
      module,
      prompt: item.prompt,
      options,
      answer: item.answer,
      explanation: item.explanation,
      source: item.source,
      rating: TRIVIA_RATING[item.difficulty],
    };
  };
}

export const games = triviaBuilder("games", GAMES_BANK, 100_000);
export const anime = triviaBuilder("anime", ANIME_BANK, 200_000);
