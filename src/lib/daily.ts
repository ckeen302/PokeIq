/**
 * The Daily Gauntlet — one seeded 10-question run per UTC day, identical for
 * every player. Determinism comes from three layers:
 *
 *  1. the seed is a hash of the UTC date,
 *  2. all engine randomness flows through the AsyncLocalStorage RNG scope
 *     (see lib/random), and
 *  3. questions are generated **sequentially**, so the RNG sequence is
 *     consumed in a fixed order.
 *
 * The result is cached per day (globalThis, so all bundles share it) and the
 * generation itself is coalesced behind an in-flight promise.
 */
import { generateOne } from "@/engines";
import type { Difficulty, QuizCategory, QuizQuestion } from "@/engines/types";
import { QUIZ_CATEGORIES } from "@/engines/types";
import { hashSeed, pick, withSeededRng } from "./random";

/** Day 1 = the day PokéIQ shipped. */
const EPOCH_UTC = Date.UTC(2026, 6, 13); // 2026-07-13

const BASE_PLAN: Array<[QuizCategory, Difficulty]> = [
  ["whos-that", "easy"],
  ["type-detective", "easy"],
  ["move-master", "easy"],
  ["stat-showdown", "easy"],
  ["whos-that", "medium"],
  ["type-detective", "medium"],
  ["move-master", "medium"],
  ["stat-showdown", "medium"],
];

export interface DailyChallenge {
  dateKey: string;
  dayNumber: number;
  endsAt: string;
  questions: QuizQuestion[];
}

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dayNumberOf(dateKey: string): number {
  const ms = Date.parse(`${dateKey}T00:00:00Z`) - EPOCH_UTC;
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

function endOfDayIso(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + 86_400_000).toISOString();
}

async function generateDaily(dateKey: string): Promise<DailyChallenge> {
  const seed = hashSeed(`pokeiq-daily-${dateKey}`);
  const questions = await withSeededRng(seed, async () => {
    // Two extra hard slots, categories chosen by the seeded RNG.
    const plan: Array<[QuizCategory, Difficulty]> = [
      ...BASE_PLAN,
      [pick(QUIZ_CATEGORIES), "hard"],
      [pick(QUIZ_CATEGORIES), "hard"],
    ];
    const generated: QuizQuestion[] = [];
    const seen = new Set<string>();
    // Sequential on purpose — parallel generation would consume the seeded
    // RNG in a nondeterministic interleaving.
    for (const [category, difficulty] of plan) {
      const question = await generateOne(category, difficulty);
      if (!question) continue;
      const key = `${question.question}|${question.correctAnswer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      generated.push(question);
    }
    return generated;
  });
  if (questions.length < 6) {
    throw new Error(`daily generation produced only ${questions.length} questions`);
  }
  return {
    dateKey,
    dayNumber: dayNumberOf(dateKey),
    endsAt: endOfDayIso(dateKey),
    questions,
  };
}

// Cache on globalThis so API-route and page bundles share one challenge.
const globalCache = globalThis as unknown as {
  __pokeiqDaily?: { dateKey: string; promise: Promise<DailyChallenge> };
};

export function getDailyChallenge(): Promise<DailyChallenge> {
  const dateKey = todayKey();
  const cached = globalCache.__pokeiqDaily;
  if (cached && cached.dateKey === dateKey) return cached.promise;

  const promise = generateDaily(dateKey).catch((error) => {
    // Never cache a failure — the next request retries.
    if (globalCache.__pokeiqDaily?.dateKey === dateKey) {
      delete globalCache.__pokeiqDaily;
    }
    throw error;
  });
  globalCache.__pokeiqDaily = { dateKey, promise };
  return promise;
}
