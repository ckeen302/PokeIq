/**
 * Move Master — move effects, learnsets and base-power duels.
 *
 * easy   → "what type is this move?" & wide-gap power comparisons (iconic moves)
 * medium → effect/flavor-text identification
 * hard   → learnset questions & razor-thin power comparisons
 */
import {
  ALL_TYPES,
  displayName,
  getMove,
  getMoveList,
  getPokemonNameList,
  getType,
  idFromUrl,
  officialArtworkUrl,
  type MoveData,
} from "@/lib/pokeapi";
import { pick, rand01, sample, shuffle } from "@/lib/random";
import type { Difficulty, QuizEngine, QuizQuestion } from "../types";

/** Gen 1 iconic move pool = ids 1–165. */
const ICONIC_MOVE_MAX_ID = 165;

async function randomMove(maxId?: number): Promise<MoveData> {
  const list = await getMoveList();
  const pool = maxId
    ? list.filter((m) => {
        const id = idFromUrl(m.url);
        return id !== null && id <= maxId;
      })
    : list;
  return getMove(pick(pool).name);
}

function englishFlavor(move: MoveData): string | null {
  const entry =
    move.flavor_text_entries.find((f) => f.language.name === "en") ?? null;
  if (entry) return entry.flavor_text.replace(/[\n\f\r]+/g, " ").trim();
  const effect = move.effect_entries.find((e) => e.language.name === "en");
  return effect ? effect.short_effect.replace(/\$effect_chance/g, "…") : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove the move's own name from its description so it can't self-answer.
 * Returns null when a give-away word form remains (e.g. Coil → "coils up"),
 * signalling the caller to pick a different move.
 */
function scrubName(text: string, moveName: string): string | null {
  const pretty = displayName(moveName);
  let scrubbed = text.replace(
    new RegExp(`\\b${escapeRegExp(pretty)}\\b`, "gi"),
    "this move",
  );
  scrubbed = scrubbed.replace(
    new RegExp(`\\b${escapeRegExp(moveName.replace(/-/g, " "))}\\b`, "gi"),
    "this move",
  );
  // Any leftover word sharing a ≥4-char stem with the move name is a hint.
  for (const part of pretty.split(" ")) {
    if (part.length < 4) continue;
    if (new RegExp(escapeRegExp(part), "i").test(scrubbed)) return null;
  }
  return scrubbed;
}

async function moveTypeQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  const move = await randomMove(difficulty === "easy" ? ICONIC_MOVE_MAX_ID : undefined);
  const answer = move.type.name;
  if (!(ALL_TYPES as readonly string[]).includes(answer)) {
    throw new Error(`move ${move.name} has non-standard type ${answer}`);
  }
  const distractors = sample(
    ALL_TYPES.filter((t) => t !== answer),
    3,
  );
  const name = displayName(move.name);
  return {
    question: `What type is the move ${name}?`,
    options: shuffle([displayName(answer), ...distractors.map(displayName)]),
    correctAnswer: displayName(answer),
    explanation: `${name} is a ${displayName(answer)}-type ${move.damage_class.name} move${move.power ? ` with ${move.power} base power` : ""}.`,
    difficulty,
  };
}

async function effectQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const move = await randomMove();
    const flavor = englishFlavor(move);
    if (!flavor || flavor.length < 30) continue;
    const scrubbed = scrubName(flavor, move.name);
    if (scrubbed === null) continue; // description gives the name away

    // Context-aware distractors: other moves of the same type.
    const typeData = await getType(move.type.name);
    const sameTypePool = typeData.moves
      .map((m) => m.name)
      .filter((n) => {
        return n !== move.name;
      });
    if (sameTypePool.length < 3) continue;
    const distractors = sample(sameTypePool, 3).map(displayName);
    const answer = displayName(move.name);
    return {
      question: `Which ${displayName(move.type.name)}-type move is described here: “${scrubbed}”`,
      options: shuffle([answer, ...distractors]),
      correctAnswer: answer,
      explanation: `That's ${answer}${move.power ? ` (${move.power} BP` : " (status"}${move.accuracy ? `, ${move.accuracy}% accuracy)` : ")"}.`,
      difficulty,
    };
  }
  throw new Error("no move with usable flavor text found");
}

async function learnerQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  const allNames = await getPokemonNameList();
  for (let attempt = 0; attempt < 8; attempt++) {
    const move = await randomMove();
    const learners = new Set(move.learned_by_pokemon.map((p) => p.name));
    // Need a real learnset that is neither empty nor "almost everything".
    if (learners.size < 4 || learners.size > allNames.length - 10) continue;

    const canonicalLearners = move.learned_by_pokemon
      .map((p) => p.name)
      .filter((n) => allNames.includes(n));
    if (canonicalLearners.length === 0) continue;
    const correct = pick(canonicalLearners);
    const nonLearners = sample(
      allNames.filter((n) => !learners.has(n)),
      3,
    );
    if (nonLearners.length < 3) continue;

    const moveName = displayName(move.name);
    const answer = displayName(correct);
    // Canonical dex position = id, so each option gets its artwork sprite.
    const optionImages = Object.fromEntries(
      [correct, ...nonLearners].map((n) => [
        displayName(n),
        officialArtworkUrl(allNames.indexOf(n) + 1),
      ]),
    );
    return {
      question: `Which of these Pokémon can learn ${moveName}?`,
      options: shuffle([answer, ...nonLearners.map(displayName)]),
      correctAnswer: answer,
      explanation: `${answer} learns ${moveName}; the other three cannot learn it by any method.`,
      optionImages,
      difficulty,
    };
  }
  throw new Error("no move with suitable learnset found");
}

async function powerQuestion(difficulty: Difficulty): Promise<QuizQuestion> {
  const [minGap, maxGap] =
    difficulty === "easy" ? [35, 999] : difficulty === "medium" ? [15, 40] : [1, 12];
  const maxId = difficulty === "easy" ? ICONIC_MOVE_MAX_ID : undefined;

  for (let attempt = 0; attempt < 15; attempt++) {
    const [a, b] = await Promise.all([randomMove(maxId), randomMove(maxId)]);
    if (a.name === b.name || a.power === null || b.power === null) continue;
    const gap = Math.abs(a.power - b.power);
    if (gap < minGap || gap > maxGap) continue;

    const winner = a.power > b.power ? a : b;
    const loser = winner === a ? b : a;
    const answer = displayName(winner.name);
    return {
      question: `Which move has the higher base power: ${displayName(a.name)} or ${displayName(b.name)}?`,
      options: shuffle([answer, displayName(loser.name)]),
      correctAnswer: answer,
      explanation: `${answer} has ${winner.power} base power vs ${loser.power} for ${displayName(loser.name)}.`,
      difficulty,
    };
  }
  throw new Error("no power pair within the difficulty gap found");
}

export const moveMasterEngine: QuizEngine = {
  category: "move-master",
  name: "Move Master",
  async generate(difficulty: Difficulty): Promise<QuizQuestion> {
    switch (difficulty) {
      case "easy":
        return rand01() < 0.5
          ? moveTypeQuestion("easy")
          : powerQuestion("easy");
      case "medium":
        return rand01() < 0.7
          ? effectQuestion("medium")
          : powerQuestion("medium");
      case "hard":
        return rand01() < 0.6
          ? learnerQuestion("hard")
          : powerQuestion("hard");
    }
  },
};
