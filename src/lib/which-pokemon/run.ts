import { matchProfile, type MatchResult } from "./match";
import { RUN_LENGTH, TIE_BREAKERS_MAX, TIE_MARGIN, drawQuestions, scoreResponses, tieBreaker, type Response } from "./questions";
import type { Answer, Question } from "./types";

/**
 * One run of the quiz as a pure step function, shared by the page and the
 * simulation: eighteen drawn questions, then up to two tie-breakers while the
 * top two matches are within TIE_MARGIN points of each other.
 */

export type Step = { done: false; question: Question; index: number; total: number } | { done: true; result: MatchResult };

/** What comes next after `responses` to `questions` (which may grow by a tie-breaker). */
export function nextStep(questions: Question[], responses: readonly Response[]): Step {
  if (responses.length < questions.length) {
    return { done: false, question: questions[responses.length], index: responses.length, total: questions.length };
  }
  const result = matchProfile(scoreResponses(responses));
  const breakers = responses.length - RUN_LENGTH;
  if (breakers < TIE_BREAKERS_MAX && result.top.similarity - result.runnersUp[0].similarity < TIE_MARGIN) {
    const extra = tieBreaker(
      responses.map((r) => r.id),
      result.top.pokemon.p,
      result.runnersUp[0].pokemon.p
    );
    if (extra) {
      questions.push(extra);
      return { done: false, question: extra, index: responses.length, total: questions.length };
    }
  }
  return { done: true, result };
}

/** A whole run, answered by `answer`. */
export function runQuiz(seed: string | number, answer: (q: Question) => Answer): { questions: Question[]; responses: Response[]; result: MatchResult } {
  const questions = drawQuestions(seed);
  const responses: Response[] = [];
  for (;;) {
    const step = nextStep(questions, responses);
    if (step.done) return { questions, responses, result: step.result };
    responses.push({ id: step.question.id, answer: answer(step.question) });
  }
}
