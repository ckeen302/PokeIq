import type { Difficulty } from "../types";
import type { QuizLang } from "../i18n";
import { anyName } from "./words";

/**
 * A trivia question in another language: its prompt and explanation, and the language's name for each English
 * option (undefined when it has none). Null when the question can't be faithfully asked in that language.
 */
export interface TriviaWording {
  prompt: string;
  explanation?: string;
  option(english: string): string | undefined;
}
export type TriviaLoc = (L: QuizLang) => TriviaWording | null;

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
  /** How to ask it in another language (see ../localize.ts). */
  loc?: TriviaLoc;
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
  /** Only makes sense in English (a line from the English dub, an English title): never asked in other languages. */
  englishOnly?: boolean;
}

/** A hand-written question in another language (src/data/quiz/<bank>/i18n/<locale>.json). */
export interface HandwrittenWording {
  prompt: string;
  explanation?: string;
  /** The answer and distractors, in the English order; left out when they're names the language data has. */
  answer?: string;
  distractors?: string[];
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

/**
 * A hand-written question in another language, from its translation (src/data/quiz/<bank>/i18n/<locale>.json). Options
 * the translation doesn't give are names the language data has (Pokémon, people, items, moves, places, games). A
 * question marked English-only, or not translated, is never asked in that language.
 */
export function handwrittenLoc(bank: "games" | "anime", row: HandwrittenRow): TriviaLoc | undefined {
  if (row.englishOnly) return undefined;
  return (L) => {
    const w = L.handwritten(bank, row.id);
    if (!w) return null;
    const given = new Map<string, string>();
    if (w.answer) given.set(row.answer, w.answer);
    w.distractors?.forEach((d, i) => given.set(row.distractors[i], d));
    return { prompt: w.prompt, explanation: w.explanation, option: (o) => given.get(o) ?? anyName(L, o, bank === "anime" ? "anime" : "games") };
  };
}
