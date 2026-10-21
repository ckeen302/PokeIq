import type { Difficulty } from "../types";

/**
 * Trivia question banks (Mainline Games, Pokémon Anime).
 *
 * Unlike the Pokédex modules, these facts can't be computed, so every
 * question is authored or generated from a small data table under
 * src/data/quiz, and each carries the Bulbapedia page it was checked
 * against. Generated questions record the row they came from so tests can
 * re-check the answer against the table (see tests/trivia.test.ts).
 */
export interface TriviaItem {
  /** Stable id, unique within its bank (also the calibration item key). */
  id: string;
  topic: string;
  /** Generation (games) or series (anime) for the optional filter, 1-based. */
  group: number;
  difficulty: Difficulty;
  prompt: string;
  answer: string;
  /** Every acceptable wrong answer; a session shows three of them. */
  distractors: string[];
  source: string;
  explanation?: string;
  /** Generated items: the table row and field the answer comes from. */
  from?: { table: string; index: number; field: string };
}

export interface HandwrittenRow {
  id: string;
  topic: string;
  difficulty: Difficulty;
  prompt: string;
  answer: string;
  distractors: string[];
  source: string;
  explanation?: string;
  verify?: string[];
}

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

export function harder(d: Difficulty, steps = 1): Difficulty {
  return DIFFICULTY_ORDER[Math.min(2, DIFFICULTY_ORDER.indexOf(d) + steps)];
}

export const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Wrong answers: unique, never the answer (case-insensitively) and never in `exclude`. */
export function pool(candidates: Iterable<string | undefined>, answer: string, exclude: Iterable<string> = []): string[] {
  const banned = new Set([answer, ...exclude].map((s) => s.toLowerCase()));
  const out: string[] = [];
  for (const c of candidates) {
    if (!c || banned.has(c.toLowerCase())) continue;
    banned.add(c.toLowerCase());
    out.push(c);
  }
  return out;
}

export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
