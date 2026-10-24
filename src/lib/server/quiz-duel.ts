import "server-only";
import type { Difficulty, ModuleId, Question } from "@/engines/types";
import type { SessionSpec } from "@/lib/session-types";
import {
  PVP_LEAD_MS,
  QUIZ_DUEL_IDLE_QUESTIONS,
  QUIZ_DUEL_QUESTIONS,
  QUIZ_DUEL_QUESTION_MS,
  QUIZ_DUEL_REVEAL_MS,
  quizDuelPoints,
  type QuizDuelPick,
  type QuizDuelQuestionView,
  type QuizDuelResult,
  type QuizDuelView,
} from "@/lib/pvp-types";
import { FORMAT_RULES, learnHref, mediaUrl, questionAt, toPublic } from "./session";
import {
  baseView,
  fail,
  finish,
  newSeat,
  notPlaying,
  pvpBase,
  seatOf,
  seated,
  type PvpBase,
  type PvpOutcome,
  type PvpRules,
} from "./duel-core";

/**
 * Quiz duels: two trainers answer the same ten questions of any quiz mode,
 * built from one seed by the solo quiz's engines. Each question is open for
 * 15 seconds; a right answer scores 100 plus up to 50 for speed, and the
 * most points after ten questions wins (a points race: see QUIZ_DUEL_POINTS).
 *
 * Each trainer sees when the other has locked in, never what they picked;
 * the right answer and both picks leave the server in the reveal, once both
 * have answered or time is up. As everywhere in the quiz, media only reaches
 * the browser through encrypted tokens.
 */

interface QuizDuelQuestion {
  startsAt: number;
  /** One per seat, null until that trainer answers. */
  picks: ({ choice: string; at: number } | null)[];
  /** Trainers who pressed Next during the reveal. */
  skip: boolean[];
  /**
   * When each trainer's browser had the question's images loaded (see
   * loadedQuiz). That trainer's 15 seconds and speed bonus count from here.
   */
  loaded?: (number | null)[];
  /** Set by the reveal. */
  result?: { at: number; points: number[]; nextAt: number };
}

export interface QuizDuel extends PvpBase {
  kind: "quiz";
  module: ModuleId;
  difficulty: Difficulty;
  /** Points so far. */
  scores: number[];
  questions: QuizDuelQuestion[];
}

/** An answer sent just before the bell still counts if it arrives within this long after it. */
const GRACE_MS = 1_000;

/** The duel as a solo session sees it: the same engines and generator, seeded by the duel. */
const specOf = (d: QuizDuel): SessionSpec => ({ module: d.module, format: "classic", difficulty: d.difficulty, seed: `duel:${d.seed}` });

/** Question `index`, built on the server from the duel's seed: the same for both trainers. */
export const duelQuestion = (d: QuizDuel, index: number): Question => questionAt(specOf(d), index);

/**
 * Loading allowance. Each trainer's clock starts when their browser reports
 * the question's images / cry loaded ("loaded" action), clamped to at most
 * this long after the question appeared. Without a report the clock starts at
 * `startsAt` as before. A trainer stalling the report can gain at most this
 * much extra viewing time, while a slow connection is never penalised.
 */
export const QUIZ_DUEL_LOAD_CAP_MS = 4_000;

/** When a trainer's clock started on question `q`. */
const seatStart = (q: QuizDuelQuestion, seat: number) => q.loaded?.[seat] ?? q.startsAt;
/** When a trainer's answers close. */
const seatCloses = (q: QuizDuelQuestion, seat: number) => seatStart(q, seat) + QUIZ_DUEL_QUESTION_MS;
/** When the question closes for everyone. */
const closesAt = (q: QuizDuelQuestion) => Math.max(...q.picks.map((_, seat) => seatCloses(q, seat)));

function scorePick(d: QuizDuel, index: number, seat: number): QuizDuelPick | null {
  const q = d.questions[index];
  const pick = q.picks[seat];
  if (!pick) return null;
  const correct = pick.choice === duelQuestion(d, index).answer;
  const ms = Math.max(0, pick.at - seatStart(q, seat));
  return { choice: pick.choice, correct, ms, points: correct ? quizDuelPoints(ms) : 0 };
}

/** The most points wins; level on points, the quicker right answers. */
function winnerOf(d: QuizDuel): number | null {
  const [a, b] = d.scores;
  if (a !== b) return a > b ? 0 : 1;
  const time = (seat: number) =>
    d.questions.reduce((sum, _, i) => {
      const pick = scorePick(d, i, seat);
      return sum + (pick?.correct ? pick.ms : 0);
    }, 0);
  const [ta, tb] = [time(0), time(1)];
  return ta === tb ? null : ta < tb ? 0 : 1;
}

function reveal(d: QuizDuel, q: QuizDuelQuestion, at: number) {
  const index = d.questions.indexOf(q);
  const points = d.players.map((_, seat) => scorePick(d, index, seat)?.points ?? 0);
  q.result = { at, points, nextAt: at + QUIZ_DUEL_REVEAL_MS };
  d.scores = d.scores.map((s, seat) => s + points[seat]);

  const idle = d.players.map(
    (_, seat) => d.questions.length >= QUIZ_DUEL_IDLE_QUESTIONS && d.questions.slice(-QUIZ_DUEL_IDLE_QUESTIONS).every((x) => !x.picks[seat])
  );
  if (idle[0] !== idle[1]) finish(d, "idle", idle[0] ? 1 : 0, at);
  else if (idle[0]) finish(d, "idle", winnerOf(d), at);
  else if (d.questions.length >= QUIZ_DUEL_QUESTIONS) finish(d, "played", winnerOf(d), at);
}

const newQuestion = (d: QuizDuel, startsAt: number): QuizDuelQuestion => ({
  startsAt,
  picks: d.players.map(() => null),
  skip: d.players.map(() => false),
});

const blankDuel = (base: PvpBase, module: ModuleId, difficulty: Difficulty): QuizDuel => ({
  ...base,
  kind: "quiz",
  module,
  difficulty,
  scores: [0, 0],
  questions: [],
});

export const quizRules: PvpRules<QuizDuel> = {
  begin(d, at) {
    d.questions = [newQuestion(d, at)];
  },
  play(d, now) {
    const q = d.questions[d.questions.length - 1];
    if (!q.result) {
      const all = q.picks.every(Boolean);
      if (!all && now <= closesAt(q) + GRACE_MS) return false;
      reveal(d, q, all ? Math.max(...q.picks.map((p) => p!.at)) : closesAt(q) + GRACE_MS);
      return true;
    }
    if (now < q.result.nextAt) return false;
    d.questions.push(newQuestion(d, q.result.nextAt + PVP_LEAD_MS));
    return true;
  },
  blank: (base, like) => blankDuel(base, like.module, like.difficulty),
};

export function createQuizDuel(
  module: ModuleId,
  difficulty: Difficulty,
  name: string,
  code: string,
  now: number,
  seed?: string
): { duel: QuizDuel; playerId: string } {
  const seat = newSeat(name, now);
  return { duel: blankDuel(pvpBase("quiz", code, [seat], now, seed), module, difficulty), playerId: seat.id };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function answerQuiz(duel: QuizDuel, playerId: string, index: number, choice: string, now: number): PvpOutcome<QuizDuel> {
  return seated(quizRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    const q = d.questions[d.questions.length - 1];
    if (index !== d.questions.length - 1 || q.result) return fail(409, "That question is over.");
    if (now < q.startsAt) return fail(409, "The question hasn't started yet.");
    if (q.picks[seat]) return fail(409, "You've already answered.");
    if (now > seatCloses(q, seat) + GRACE_MS) return fail(409, "Time's up for that question.");
    if (!duelQuestion(d, index).options.includes(choice)) return fail(400, "Pick one of the options.");
    q.picks[seat] = { choice, at: now };
    return { ok: true, duel: d };
  });
}

/** The trainer's browser has the question's assets ready: start their clock (once, bounded). */
export function loadedQuiz(duel: QuizDuel, playerId: string, index: number, now: number): PvpOutcome<QuizDuel> {
  return seated(quizRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    const q = d.questions[d.questions.length - 1];
    if (index !== d.questions.length - 1 || q.result || now < q.startsAt) return { ok: true, duel: d };
    if (q.loaded?.[seat] != null || q.picks[seat]) return { ok: true, duel: d };
    q.loaded ??= d.players.map(() => null);
    q.loaded[seat] = Math.min(now, q.startsAt + QUIZ_DUEL_LOAD_CAP_MS);
    return { ok: true, duel: d };
  });
}

/** Next question, please: once both trainers press it, the reveal ends early. */
export function skipQuizReveal(duel: QuizDuel, playerId: string, index: number, now: number): PvpOutcome<QuizDuel> {
  return seated(quizRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    // The next question already began (the reveal ran out): nothing to skip.
    if (index < d.questions.length - 1) return { ok: true, duel: d };
    const q = d.questions[index];
    if (!q?.result) return fail(409, "That question isn't over yet.");
    q.skip[seat] = true;
    if (q.skip.every(Boolean)) q.result.nextAt = Math.min(q.result.nextAt, now);
    return { ok: true, duel: d };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** What both trainers see of a question: no answer, no explanation, no reveal art. */
function questionView(q: Question, index: number): QuizDuelQuestionView {
  const p = toPublic(q, index, FORMAT_RULES.classic);
  return { module: p.module, prompt: p.prompt, detail: p.detail, options: p.options, images: p.images, media: p.media, cards: p.cards };
}

/** What one trainer (or a visitor: null) may see of the duel right now. */
export function quizView(duel: QuizDuel, playerId: string | null, now: number, rev: number): QuizDuelView {
  const seat = seatOf(duel, playerId);
  const scores = [0, 0];
  const lastRevealed = duel.questions.findLastIndex((q) => q.result);
  const revealed = duel.questions.flatMap((x, index): QuizDuelResult[] => {
    if (!x.result) return [];
    const q = duelQuestion(duel, index);
    x.result.points.forEach((p, k) => (scores[k] += p));
    // The latest reveal is on screen: it gets its media back, and the artwork.
    const view = questionView(q, index);
    return [
      {
        index,
        question: index === lastRevealed ? view : { ...view, media: undefined },
        answer: q.answer,
        explanation: q.explanation,
        revealUrl: index === lastRevealed && q.revealMedia ? mediaUrl(q.revealMedia) : undefined,
        learnHref: learnHref(q),
        sourceUrl: q.source,
        picks: x.picks.map((_, k) => scorePick(duel, index, k)),
        scores: [...scores],
      },
    ];
  });

  const last = duel.questions[duel.questions.length - 1];
  const live = duel.status === "playing" && last && !last.result ? last : undefined;
  const index = duel.questions.length - 1;
  return {
    kind: "quiz",
    ...baseView(duel, playerId, now, rev),
    module: duel.module,
    difficulty: duel.difficulty,
    total: QUIZ_DUEL_QUESTIONS,
    scores: duel.scores,
    question: live && {
      index,
      startsAt: live.startsAt,
      endsAt: seat >= 0 ? seatCloses(live, seat) : closesAt(live),
      loaded: seat >= 0 ? live.loaded?.[seat] != null : undefined,
      question: now >= live.startsAt ? questionView(duelQuestion(duel, index), index) : undefined,
      answered: live.picks.map(Boolean),
      yours: seat >= 0 ? live.picks[seat]?.choice : undefined,
    },
    revealed,
    next: duel.status === "playing" && last?.result ? { at: last.result.nextAt, pressed: last.skip } : undefined,
  };
}
