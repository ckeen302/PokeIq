import type { QuizLang } from "./i18n";
import type { Question } from "./types";

/**
 * Questions in other languages. Every builder writes its question in English exactly as it always did, and registers
 * beside it how to word the same question in another language: the same Pokémon, items and answer, the options in the
 * same order, only the words differ. So a seed gives the same quiz in every language (the Daily Challenge, challenge
 * links and duels stay comparable), and English runs are untouched.
 *
 * A wording returns null when the question has no faithful translation (a Pokédex entry the language doesn't have, a
 * trivia question that only works in English, a name with no official translation): the run then swaps in another
 * question of the same kind (see buildLocalizedQuestion in ./index.ts).
 */

/** What a language changes in a question: its words. */
export type Wording = Partial<Pick<Question, "prompt" | "detail" | "options" | "answer" | "explanation" | "cards" | "optionAliases">>;

export type Reword = (L: QuizLang) => Wording | null;

const REWORDS = new WeakMap<Question, Reword>();

/** Registers how to word `q` in other languages; returns `q` unchanged. */
export function localizable(q: Question, reword: Reword): Question {
  REWORDS.set(q, reword);
  return q;
}

/**
 * Options in the language, in the English order: `name` words each English option (undefined when it can't, which
 * makes the whole question unwordable). The answer is worded the same way.
 */
export function wordOptions(q: Question, name: (english: string) => string | undefined): { options: string[]; answer: string } | null {
  const options: string[] = [];
  for (const o of q.options) {
    const w = name(o);
    if (!w) return null;
    options.push(w);
  }
  const answer = q.input === "name" ? name(q.answer) : options[q.options.indexOf(q.answer)];
  return answer ? { options, answer } : null;
}

/** Throws (making the wording null) when a name is missing: for wordings that need many names at once. */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null || value === "") throw new Unworded(what);
  return value;
}

class Unworded extends Error {}

/** `q` in the language, or null when it can't be faithfully worded there (a missing name is expected: those questions are swapped). */
export function localize(q: Question, L: QuizLang): Question | null {
  const reword = REWORDS.get(q);
  if (!reword) return null;
  try {
    const wording = reword(L);
    if (!wording) return null;
    const out: Question = { ...q, ...wording };
    for (const k of Object.keys(out) as (keyof Question)[]) if (out[k] === undefined) delete out[k];
    return out;
  } catch (err) {
    if (!(err instanceof Unworded)) console.warn(`[engine:${q.module}] no ${L.locale} wording for ${q.itemKey}:`, err);
    return null;
  }
}
