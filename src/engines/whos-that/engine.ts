/**
 * Who's That Pokémon? — the anime experience.
 *
 * EVERY question shows only the Pokémon's silhouette (the client renders the
 * artwork shadow-first on the classic burst frame) and reveals the full-color
 * artwork after the player answers. Difficulty scales by generation:
 *
 * easy   → Gen 1–2 icons
 * medium → Gen 3–6
 * hard   → Gen 7–9, plus alternate-form shadows (regional/Mega/Origin/…)
 */
import { urlOk } from "@/lib/http";
import {
  GEN_RANGES,
  displayName,
  generationOf,
  getFormList,
  getPokemon,
  getPokemonNameList,
  officialArtworkUrl,
  typeNames,
} from "@/lib/pokeapi";
import { pick, rand01, randInt, sample, shuffle } from "@/lib/random";
import type { Difficulty, QuizEngine, QuizQuestion } from "../types";

const GENS_BY_DIFFICULTY: Record<Difficulty, number[]> = {
  easy: [1, 2],
  medium: [3, 4, 5, 6],
  hard: [7, 8, 9],
};

function randomIdInGens(gens: number[]): number {
  const [lo, hi] = GEN_RANGES[pick(gens) - 1];
  return randInt(lo, hi);
}

/** 3 distractor names drawn from the same generation as the answer. */
function sameGenDistractors(
  names: string[],
  answerId: number,
  count: number,
): string[] {
  const gen = generationOf(answerId);
  const [lo, hi] = GEN_RANGES[gen - 1];
  const pool: string[] = [];
  for (let id = lo; id <= hi; id++) {
    if (id !== answerId && names[id - 1]) pool.push(names[id - 1]);
  }
  return sample(pool, count).map(displayName);
}

function describe(pokemonId: number, name: string, types: string[]): string {
  const typeLabel = types.map(displayName).join("/");
  const article = /^[aeiou]/i.test(typeLabel) ? "an" : "a";
  return `${name} is ${article} ${typeLabel}-type Pokémon from Generation ${generationOf(pokemonId)} (#${pokemonId}).`;
}

/** The classic: a shadow on the burst, revealed in colour after answering. */
async function silhouetteQuestion(
  difficulty: Difficulty,
): Promise<QuizQuestion> {
  const names = await getPokemonNameList();
  const id = randomIdInGens(GENS_BY_DIFFICULTY[difficulty]);
  const imageUrl = officialArtworkUrl(id);
  if (!(await urlOk(imageUrl))) {
    throw new Error(`artwork missing for #${id}`);
  }
  const pokemon = await getPokemon(id);
  const answer = displayName(pokemon.name);
  return {
    question: "Who's that Pokémon?",
    options: shuffle([answer, ...sameGenDistractors(names, id, 3)]),
    correctAnswer: answer,
    explanation: `It's ${answer}! ${describe(id, answer, typeNames(pokemon))}`,
    imageUrl,
    imageHint: "silhouette",
    difficulty,
  };
}

/** Hard twist: the shadow belongs to an alternate form of the answer. */
async function formSilhouetteQuestion(
  difficulty: Difficulty,
): Promise<QuizQuestion> {
  const [names, forms] = await Promise.all([
    getPokemonNameList(),
    getFormList(),
  ]);
  const interesting = forms.filter((f) =>
    /-(alola|galar|hisui|paldea|mega|origin|therian)/.test(f.name),
  );
  if (interesting.length === 0) throw new Error("no alternate forms available");
  for (let attempt = 0; attempt < 5; attempt++) {
    const form = await getPokemon(pick(interesting).name);
    const artwork = form.sprites.other?.["official-artwork"]?.front_default;
    if (!artwork || !(await urlOk(artwork))) continue;
    const speciesName = form.species.name;
    const speciesId = names.indexOf(speciesName) + 1;
    if (speciesId <= 0) continue;
    const answer = displayName(speciesName);
    return {
      question: "Who's that Pokémon? (Its shadow is one of its alternate forms!)",
      options: shuffle([answer, ...sameGenDistractors(names, speciesId, 3)]),
      correctAnswer: answer,
      explanation: `It's ${answer} — that shadow was ${displayName(form.name)}, one of its alternate forms.`,
      imageUrl: artwork,
      imageHint: "silhouette",
      difficulty,
    };
  }
  throw new Error("no renderable alternate form found");
}

export const whosThatEngine: QuizEngine = {
  category: "whos-that",
  name: "Who's That Pokémon?",
  async generate(difficulty: Difficulty): Promise<QuizQuestion> {
    if (difficulty === "hard" && rand01() < 0.4) {
      return formSilhouetteQuestion("hard");
    }
    return silhouetteQuestion(difficulty);
  },
};
