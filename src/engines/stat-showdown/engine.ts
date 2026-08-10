/**
 * Stat Showdown — base-stat duels computed live from PokéAPI.
 *
 * easy   → 2-way duels with obvious gaps (≥ 35)
 * medium → 2-way duels, 12–40 gap, plus BST comparisons
 * hard   → "stat king" among 4, and duels decided by ≤ 12 points
 */
import {
  GEN_RANGES,
  baseStat,
  displayName,
  getPokemon,
  officialArtworkUrl,
  statTotal,
  type PokemonData,
} from "@/lib/pokeapi";
import { pick, rand01, randInt, shuffle } from "@/lib/random";
import type { Difficulty, QuizEngine, QuizQuestion } from "../types";

const STATS = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "special-attack", label: "Special Attack" },
  { key: "special-defense", label: "Special Defense" },
  { key: "speed", label: "Speed" },
] as const;

const GENS_BY_DIFFICULTY: Record<Difficulty, number[]> = {
  easy: [1, 2],
  medium: [1, 2, 3, 4, 5, 6],
  hard: [1, 2, 3, 4, 5, 6, 7, 8, 9],
};

function randomIdInGens(gens: number[]): number {
  const [lo, hi] = GEN_RANGES[pick(gens) - 1];
  return randInt(lo, hi);
}

async function fetchDistinct(
  count: number,
  gens: number[],
): Promise<PokemonData[]> {
  const result: PokemonData[] = [];
  const seen = new Set<string>();
  for (let tries = 0; tries < count * 8 && result.length < count; tries++) {
    const pokemon = await getPokemon(randomIdInGens(gens));
    if (seen.has(pokemon.name)) continue;
    seen.add(pokemon.name);
    result.push(pokemon);
  }
  if (result.length < count) throw new Error("could not fetch distinct Pokémon");
  return result;
}

/** Sprite per option so the client can render a visual VS duel. */
function spritesFor(contenders: PokemonData[]): Record<string, string> {
  return Object.fromEntries(
    contenders.map((p) => [displayName(p.name), officialArtworkUrl(p.id)]),
  );
}

async function duelQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  const [minGap, maxGap] =
    difficulty === "easy" ? [35, 999] : difficulty === "medium" ? [12, 40] : [1, 12];
  const stat = pick([...STATS]);

  for (let attempt = 0; attempt < 15; attempt++) {
    const [a, b] = await fetchDistinct(2, GENS_BY_DIFFICULTY[difficulty]);
    const valueA = baseStat(a, stat.key);
    const valueB = baseStat(b, stat.key);
    const gap = Math.abs(valueA - valueB);
    if (gap < minGap || gap > maxGap) continue;

    const winner = valueA > valueB ? a : b;
    const loser = winner === a ? b : a;
    const answer = displayName(winner.name);
    return {
      question: `Which Pokémon has the higher base ${stat.label}: ${displayName(a.name)} or ${displayName(b.name)}?`,
      options: shuffle([answer, displayName(loser.name)]),
      correctAnswer: answer,
      explanation: `${answer} has ${baseStat(winner, stat.key)} base ${stat.label}, beating ${displayName(loser.name)}'s ${baseStat(loser, stat.key)}.`,
      optionImages: spritesFor([a, b]),
      difficulty,
    };
  }
  throw new Error("no stat duel within the difficulty gap found");
}

async function bstQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const [a, b] = await fetchDistinct(2, GENS_BY_DIFFICULTY[difficulty]);
    const totalA = statTotal(a);
    const totalB = statTotal(b);
    const gap = Math.abs(totalA - totalB);
    if (gap === 0 || gap > 150) continue;

    const winner = totalA > totalB ? a : b;
    const loser = winner === a ? b : a;
    const answer = displayName(winner.name);
    return {
      question: `Which Pokémon has the higher base stat total: ${displayName(a.name)} or ${displayName(b.name)}?`,
      options: shuffle([answer, displayName(loser.name)]),
      correctAnswer: answer,
      explanation: `${answer}'s base stat total is ${statTotal(winner)} vs ${statTotal(loser)} for ${displayName(loser.name)}.`,
      optionImages: spritesFor([a, b]),
      difficulty,
    };
  }
  throw new Error("no BST pair found");
}

/** "Stat king": which of these four has the highest X? Requires a unique max. */
async function statKingQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  const stat = pick([...STATS]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const contenders = await fetchDistinct(4, GENS_BY_DIFFICULTY[difficulty]);
    const values = contenders.map((p) => baseStat(p, stat.key));
    const max = Math.max(...values);
    if (values.filter((v) => v === max).length !== 1) continue;

    const winner = contenders[values.indexOf(max)];
    const answer = displayName(winner.name);
    const breakdown = contenders
      .map((p) => `${displayName(p.name)} ${baseStat(p, stat.key)}`)
      .join(", ");
    return {
      question: `Which of these Pokémon has the highest base ${stat.label}?`,
      options: shuffle(contenders.map((p) => displayName(p.name))),
      correctAnswer: answer,
      explanation: `Base ${stat.label}: ${breakdown}. ${answer} takes the crown.`,
      optionImages: spritesFor(contenders),
      difficulty,
    };
  }
  throw new Error("no unique stat king found");
}

export const statShowdownEngine: QuizEngine = {
  category: "stat-showdown",
  name: "Stat Showdown",
  async generate(difficulty: Difficulty): Promise<QuizQuestion> {
    switch (difficulty) {
      case "easy":
        return duelQuestion("easy");
      case "medium":
        return rand01() < 0.6
          ? duelQuestion("medium")
          : bstQuestion("medium");
      case "hard":
        return rand01() < 0.5
          ? statKingQuestion("hard")
          : duelQuestion("hard");
    }
  },
};
