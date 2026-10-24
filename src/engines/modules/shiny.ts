import answers from "@/data/shiny/answers.json";
import { poolFor } from "@/lib/pokemon/pokedex";
import type { Difficulty, QuestionBuilder } from "../types";
import { pickTarget } from "../shared";

/**
 * Which is the real shiny? Four pre-generated sprites of one Pokémon (the
 * real shiny and three palette-shifted fakes, see scripts/shiny). The options
 * ARE the random image names, so nothing the browser receives says which is
 * real; the answer map in src/data/shiny/answers.json stays on the server.
 * Difficulty picks how close the fakes are, not which Pokémon come up.
 */

const SETS = answers.sets as Record<string, string[][]>;
const ORDER = answers.difficulties as Difficulty[];
const RATING: Record<Difficulty, number> = { easy: 950, medium: 1200, hard: 1500 };
/** The quiz's easy / normal / hard are the session's easy / medium / hard. */
const DIFFICULTY_INDEX: Record<Difficulty, number> = { easy: ORDER.indexOf("easy" as Difficulty), medium: ORDER.indexOf("normal" as Difficulty), hard: ORDER.indexOf("hard" as Difficulty) };

export const shiny: QuestionBuilder = (rng, opts) => {
  const target = pickTarget(rng, poolFor(opts.gens), opts.used, (p) => Boolean(SETS[p.id]));
  if (!target) return null;
  const [real, ...fakes] = SETS[target.id][DIFFICULTY_INDEX[opts.difficulty]];
  return {
    itemKey: `shiny:${target.id}:${opts.difficulty}`,
    module: "shiny",
    prompt: `Which one is the real shiny ${target.name}?`,
    detail: opts.difficulty === "hard" ? "The fakes are very close this time. Look at the details." : undefined,
    options: rng.shuffle([real, ...fakes]),
    answer: real,
    optionImages: true,
    explanation: `That is ${target.name}'s real shiny colouring.`,
    revealMedia: { kind: "artwork", pokemonId: target.id },
    rating: RATING[opts.difficulty],
  };
};
