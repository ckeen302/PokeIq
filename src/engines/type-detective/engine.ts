/**
 * Type Detective — deduce types from the live PokéAPI type chart.
 *
 * easy   → STAB identification & immunity lookups
 * medium → weakness-finder (2 clues) & resistance quests
 * hard   → Pokémon detector (dual-type effective multipliers) & 3-clue chains
 */
import {
  ALL_TYPES,
  GEN_RANGES,
  defensiveMultiplier,
  displayName,
  getPokemon,
  getTypeChart,
  officialArtworkUrl,
  typeNames,
} from "@/lib/pokeapi";
import { pick, rand01, randInt, sample, shuffle } from "@/lib/random";
import type { Difficulty, QuizEngine, QuizQuestion } from "../types";

type Chart = Record<string, Record<string, number>>;

/** Types dealing 2x into `defender`. */
function weaknessesOf(chart: Chart, defender: string): string[] {
  return ALL_TYPES.filter((atk) => chart[atk][defender] === 2);
}

/** Types dealing ≤0.5x into `defender` (resisted or immune). */
function resistancesOf(chart: Chart, defender: string): string[] {
  return ALL_TYPES.filter((atk) => chart[atk][defender] < 1);
}

/** Is `candidate` the unique type weak to (resp. resisting) every clue? */
function uniqueMatch(
  chart: Chart,
  clues: string[],
  predicate: (chart: Chart, atk: string, def: string) => boolean,
  answer: string,
): boolean {
  for (const type of ALL_TYPES) {
    if (type === answer) continue;
    if (clues.every((clue) => predicate(chart, clue, type))) return false;
  }
  return true;
}

const isWeak = (chart: Chart, atk: string, def: string) =>
  chart[atk][def] === 2;
const resists = (chart: Chart, atk: string, def: string) =>
  chart[atk][def] < 1;

function clueQuestion(
  chart: Chart,
  mode: "weakness" | "resistance",
  clueCount: number,
  difficulty: Difficulty,
): QuizQuestion {
  const listFn = mode === "weakness" ? weaknessesOf : resistancesOf;
  const predicate = mode === "weakness" ? isWeak : resists;

  for (let attempt = 0; attempt < 40; attempt++) {
    const answer = pick(ALL_TYPES);
    const pool = listFn(chart, answer);
    if (pool.length < clueCount) continue;
    const clues = sample(pool, clueCount);
    if (!uniqueMatch(chart, clues, predicate, answer)) continue;

    const distractors = sample(
      ALL_TYPES.filter(
        (t) => t !== answer && !clues.every((c) => predicate(chart, c, t)),
      ),
      3,
    );
    const clueLabel = clues.map(displayName).join(", ");
    const verb = mode === "weakness" ? "weak to" : "resistant to";
    const allList = listFn(chart, answer).map(displayName).join(", ");
    return {
      question: `Which single type is ${verb} ${clueLabel}${clueCount > 1 ? " — all of them" : ""}?`,
      options: shuffle([displayName(answer), ...distractors.map(displayName)]),
      correctAnswer: displayName(answer),
      explanation: `${displayName(answer)} is ${verb} ${allList}. No other type matches all the clues.`,
      difficulty,
    };
  }
  throw new Error(`no unique ${mode} combination found`);
}

function immunityQuestion(chart: Chart, difficulty: Difficulty): QuizQuestion {
  const attackers = ALL_TYPES.filter((atk) =>
    ALL_TYPES.some((def) => chart[atk][def] === 0),
  );
  const attacker = pick(attackers);
  const immune = ALL_TYPES.filter((def) => chart[attacker][def] === 0);
  const answer = pick(immune);
  const distractors = sample(
    ALL_TYPES.filter((t) => chart[attacker][t] !== 0),
    3,
  );
  return {
    question: `Which type takes NO damage from ${displayName(attacker)}-type attacks?`,
    options: shuffle([displayName(answer), ...distractors.map(displayName)]),
    correctAnswer: displayName(answer),
    explanation: `${displayName(answer)} is completely immune to ${displayName(attacker)}-type moves.`,
    difficulty,
  };
}

async function stabQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  const gens = difficulty === "easy" ? [1] : [1, 2, 3, 4];
  const [lo, hi] = GEN_RANGES[pick(gens) - 1];
  const pokemon = await getPokemon(randInt(lo, hi));
  const ownTypes = typeNames(pokemon);
  const answer = pick(ownTypes);
  const distractors = sample(
    ALL_TYPES.filter((t) => !ownTypes.includes(t)),
    3,
  );
  const name = displayName(pokemon.name);
  return {
    question: `Which of these types does ${name} get STAB (Same-Type Attack Bonus) on?`,
    options: shuffle([displayName(answer), ...distractors.map(displayName)]),
    correctAnswer: displayName(answer),
    explanation: `${name} is ${ownTypes.map(displayName).join("/")}-type, so its ${displayName(answer)} moves get the 1.5× STAB boost.`,
    imageUrl: officialArtworkUrl(pokemon.id),
    difficulty,
  };
}

/** Hard: exactly one of four Pokémon is weak to a given attacking type. */
async function pokemonDetectorQuestion(
  difficulty: Difficulty,
): Promise<QuizQuestion> {
  const chart = await getTypeChart();
  for (let attempt = 0; attempt < 8; attempt++) {
    const [lo, hi] = GEN_RANGES[pick([1, 2, 3, 4, 5]) - 1];
    const target = await getPokemon(randInt(lo, hi));
    const targetTypes = typeNames(target);
    const weakTo = ALL_TYPES.filter(
      (atk) => defensiveMultiplier(chart, atk, targetTypes) >= 2,
    );
    if (weakTo.length === 0) continue;
    const attacker = pick(weakTo);

    // Find three distractors that are NOT weak to the chosen attacker.
    const distractors: string[] = [];
    const optionImages: Record<string, string> = {
      [displayName(target.name)]: officialArtworkUrl(target.id),
    };
    const seen = new Set([target.name]);
    for (let tries = 0; tries < 20 && distractors.length < 3; tries++) {
      const candidate = await getPokemon(randInt(lo, hi));
      if (seen.has(candidate.name)) continue;
      seen.add(candidate.name);
      if (defensiveMultiplier(chart, attacker, typeNames(candidate)) < 2) {
        distractors.push(displayName(candidate.name));
        optionImages[displayName(candidate.name)] = officialArtworkUrl(
          candidate.id,
        );
      }
    }
    if (distractors.length < 3) continue;

    const answer = displayName(target.name);
    const mult = defensiveMultiplier(chart, attacker, targetTypes);
    return {
      question: `Which of these Pokémon is weak to ${displayName(attacker)}-type attacks?`,
      options: shuffle([answer, ...distractors]),
      correctAnswer: answer,
      explanation: `${answer} is ${targetTypes.map(displayName).join("/")}-type and takes ${mult}× damage from ${displayName(attacker)} moves.`,
      optionImages,
      difficulty,
    };
  }
  throw new Error("could not assemble a unique Pokémon-detector question");
}

export const typeDetectiveEngine: QuizEngine = {
  category: "type-detective",
  name: "Type Detective",
  async generate(difficulty: Difficulty): Promise<QuizQuestion> {
    const chart = await getTypeChart();
    switch (difficulty) {
      case "easy":
        // STAB-heavy: only 8 distinct immunity pairs exist in the chart, so
        // immunity questions alone cannot fill a deduplicated 10-batch.
        return rand01() < 0.7
          ? stabQuestion("easy")
          : immunityQuestion(chart, "easy");
      case "medium":
        return rand01() < 0.5
          ? clueQuestion(chart, "weakness", 2, "medium")
          : clueQuestion(chart, "resistance", 2, "medium");
      case "hard":
        return rand01() < 0.5
          ? pokemonDetectorQuestion("hard")
          : clueQuestion(chart, "resistance", 3, "hard");
    }
  },
};
