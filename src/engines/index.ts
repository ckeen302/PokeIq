/**
 * Engine registry + batch generation with the self-verification gate.
 */
import { moveMasterEngine } from "./move-master/engine";
import { statShowdownEngine } from "./stat-showdown/engine";
import { typeDetectiveEngine } from "./type-detective/engine";
import { validateQuestion } from "./validate";
import { whosThatEngine } from "./whos-that/engine";
import type {
  Difficulty,
  QuizCategory,
  QuizEngine,
  QuizQuestion,
} from "./types";
import { pick } from "@/lib/random";

export const engines: Record<QuizCategory, QuizEngine> = {
  "whos-that": whosThatEngine,
  "type-detective": typeDetectiveEngine,
  "move-master": moveMasterEngine,
  "stat-showdown": statShowdownEngine,
};

export type RequestedDifficulty = Difficulty | "mixed";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

const MAX_ATTEMPTS_PER_QUESTION = 3;

/**
 * Generate one validated question, retrying on engine failure or a failed
 * Zod gate. Invalid questions are dropped and logged — never served.
 */
async function generateValidated(
  engine: QuizEngine,
  difficulty: Difficulty,
): Promise<QuizQuestion | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_QUESTION; attempt++) {
    try {
      const candidate = await engine.generate(difficulty);
      const result = validateQuestion(candidate);
      if (result.ok && result.question) return result.question;
      console.warn(
        `[engines] dropped invalid ${engine.category}/${difficulty} question:`,
        result.issues?.join("; "),
      );
    } catch (error) {
      console.warn(
        `[engines] ${engine.category}/${difficulty} generation failed (attempt ${attempt + 1}):`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return null;
}

/**
 * Generate a batch concurrently. Deduplicates identical prompts within the
 * batch and reports how many slots could not be filled.
 */
/** Generate one validated question for a given slot (used by the daily plan). */
export function generateOne(
  category: QuizCategory,
  difficulty: Difficulty,
): Promise<QuizQuestion | null> {
  return generateValidated(engines[category], difficulty);
}

const MAX_BATCH_ROUNDS = 3;

export async function generateBatch(
  category: QuizCategory,
  count: number,
  difficulty: RequestedDifficulty,
): Promise<QuizQuestion[]> {
  const engine = engines[category];
  const seenPrompts = new Set<string>();
  const questions: QuizQuestion[] = [];

  // Fill concurrently; if slots fail (flaky upstream, unlucky sampling) or
  // dedupe collides, run top-up rounds until the batch is full.
  for (
    let round = 0;
    round < MAX_BATCH_ROUNDS && questions.length < count;
    round++
  ) {
    const missing = count - questions.length;
    const targets: Difficulty[] = Array.from({ length: missing }, () =>
      difficulty === "mixed" ? pick(DIFFICULTIES) : difficulty,
    );
    const settled = await Promise.allSettled(
      targets.map((d) => generateValidated(engine, d)),
    );
    for (const result of settled) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const question = result.value;
      const dedupeKey = `${question.question}|${question.correctAnswer}`;
      if (seenPrompts.has(dedupeKey)) continue;
      seenPrompts.add(dedupeKey);
      questions.push(question);
    }
  }

  if (questions.length < count) {
    console.warn(
      `[engines] ${category}: served ${questions.length}/${count} questions`,
    );
  }
  return questions;
}
