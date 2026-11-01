import { describe, expect, it } from "vitest";
import { answerQuiz, createQuizDuel, duelQuestion, quizView, skipQuizReveal, type QuizDuel } from "@/lib/server/quiz-duel";
import { joinDuel, leaveDuel, readyDuel, rematchOf, takeRematchSeat, touchDuel } from "@/lib/server/duels";
import type { PvpFailure, PvpOutcome } from "@/lib/server/duel-core";
import { DIFFICULTIES, type Difficulty, type ModuleId } from "@/engines/types";
import { PLAY_MODULES } from "@/lib/modes";
import {
  PVP_AWAY_MS,
  PVP_LEAD_MS,
  QUIZ_DUEL_IDLE_QUESTIONS,
  QUIZ_DUEL_QUESTIONS,
  QUIZ_DUEL_QUESTION_MS,
  QUIZ_DUEL_REVEAL_MS,
  quizDuelPoints,
  type QuizDuelView,
} from "@/lib/pvp-types";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

const must = (out: PvpOutcome<QuizDuel>): QuizDuel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};
const failure = (out: PvpOutcome<QuizDuel>) => (out.ok ? null : (out as PvpFailure));

/** Red opens a quiz duel and Blue joins. */
function lobby(module: ModuleId = "whos-that", difficulty: Difficulty = "medium", seed = "quiz-seed") {
  const { duel, playerId: red } = createQuizDuel(module, difficulty, "Red", "abcdefgh", T0, seed);
  const joined = joinDuel(duel, "Blue", T0 + SECOND);
  if (!joined.ok) throw new Error(joined.error);
  return { duel: joined.duel, red, blue: joined.playerId };
}

/** Both ready: question 1 appears after the lead-in. */
function started(module?: ModuleId, difficulty?: Difficulty, seed?: string) {
  const { duel, red, blue } = lobby(module, difficulty, seed);
  const t = T0 + 2 * SECOND;
  const d = must(readyDuel(must(readyDuel(duel, red, true, t)), blue, true, t));
  return { duel: d, red, blue, ids: [red, blue], start: t + PVP_LEAD_MS };
}

const current = (d: QuizDuel) => d.questions.length - 1;
const answerOf = (d: QuizDuel, i = current(d)) => duelQuestion(d, i).answer;
const wrongOf = (d: QuizDuel, i = current(d)) => duelQuestion(d, i).options.find((o) => o !== answerOf(d, i))!;

/** Both trainers poll at `t` (so neither times out). */
const both = (duel: QuizDuel, t: number) => duel.players.reduce((d, p) => touchDuel(d, p.id, t), duel);

/** Both keep polling, every 5 s, until `t`. */
function pollUntil(d: QuizDuel, t: number): QuizDuel {
  for (let at = Math.max(...d.players.map((p) => p.seenAt)) + 5 * SECOND; at < t; at += 5 * SECOND) d = both(d, at);
  return both(d, t);
}

type Pick = "right" | "wrong" | null;

/** Plays the current question: each seat's pick `after` ms in (null: no answer), then on to the next one. */
function playQuestion(d: QuizDuel, picks: Pick[], after: number[] = [2 * SECOND, 3 * SECOND]) {
  const index = current(d);
  const start = d.questions[index].startsAt;
  picks.forEach((pick, seat) => {
    if (!pick) return;
    const at = start + after[seat];
    d = must(answerQuiz(pollUntil(d, at), d.players[seat].id, index, pick === "right" ? answerOf(d, index) : wrongOf(d, index), at));
  });
  for (let at = start; !d.questions[index].result; at += 5 * SECOND) d = pollUntil(d, at);
  if (d.status === "playing") d = pollUntil(d, d.questions[index].result!.nextAt);
  return d;
}

/** A view without its media URLs (they're re-encrypted on every request). */
const noMedia = (v: QuizDuelView) => JSON.parse(JSON.stringify(v).replace(/\/api\/media\/[\w-]+/g, "/api/media/x"));

describe("quiz duel: questions", () => {
  it("gives both trainers the same ten questions from one seed, for every mode and difficulty", () => {
    for (const mode of PLAY_MODULES) {
      for (const difficulty of DIFFICULTIES) {
        const { duel } = started(mode, difficulty, `seed-${mode}-${difficulty}`);
        const prompts = [...Array(QUIZ_DUEL_QUESTIONS)].map((_, i) => duelQuestion(duel, i));
        for (const q of prompts) {
          // Typed-name questions (Zoom Reveal) have no options.
          if (q.input !== "name") expect(q.options).toContain(q.answer);
          if (mode !== "mixed") expect(q.module).toBe(mode);
        }
        // Another duel on the same seed gets the same questions.
        const again = started(mode, difficulty, `seed-${mode}-${difficulty}`).duel;
        expect([...Array(QUIZ_DUEL_QUESTIONS)].map((_, i) => duelQuestion(again, i).itemKey)).toEqual(prompts.map((q) => q.itemKey));
      }
    }
    const a = started("whos-that", "medium", "one-seed").duel;
    const b = started("whos-that", "medium", "two-seed").duel;
    expect([0, 1, 2].map((i) => duelQuestion(a, i).answer)).not.toEqual([0, 1, 2].map((i) => duelQuestion(b, i).answer));
  });

  it("shows both trainers the same question once it starts, never before", () => {
    const { duel, red, blue, start } = started();
    expect(quizView(duel, red, start - SECOND, 0).question).toMatchObject({ index: 0, startsAt: start, question: undefined });
    const [a, b] = [quizView(duel, red, start, 0), quizView(duel, blue, start, 0)];
    expect(noMedia(a).question).toEqual(noMedia(b).question);
    expect(a.question!.question).toMatchObject({ module: "whos-that", options: duelQuestion(duel, 0).options });
    // Media only through an encrypted token.
    expect(a.question!.question!.media?.url).toMatch(/^\/api\/media\/[\w-]+$/);
    expect(a.question!.endsAt).toBe(start + QUIZ_DUEL_QUESTION_MS);
  });
});

describe("quiz duel: scoring and reveals", () => {
  it("scores 100 for a right answer plus up to 50 for speed, nothing otherwise", () => {
    expect([0, 7_500, QUIZ_DUEL_QUESTION_MS, QUIZ_DUEL_QUESTION_MS + 500].map(quizDuelPoints)).toEqual([150, 125, 100, 100]);
    const { duel, red } = started();
    const d = playQuestion(duel, ["right", "wrong"], [3 * SECOND, SECOND]);
    const [result] = quizView(d, red, T0, 0).revealed;
    expect(result.picks[0]).toEqual({ choice: answerOf(d, 0), correct: true, ms: 3 * SECOND, points: quizDuelPoints(3 * SECOND) });
    expect(result.picks[1]).toEqual({ choice: wrongOf(d, 0), correct: false, ms: SECOND, points: 0 });
    expect(result.scores).toEqual([quizDuelPoints(3 * SECOND), 0]);
    expect(d.scores).toEqual(result.scores);
  });

  it("reveals once both have answered, with the right answer and both picks", () => {
    const { duel, red, blue, start } = started();
    let d = must(answerQuiz(duel, red, 0, answerOf(duel), start + 2 * SECOND));
    expect(d.questions[0].result).toBeUndefined();
    d = must(answerQuiz(d, blue, 0, wrongOf(d), start + 4 * SECOND));
    expect(d.questions[0].result).toMatchObject({ at: start + 4 * SECOND, nextAt: start + 4 * SECOND + QUIZ_DUEL_REVEAL_MS });
    const view = quizView(d, blue, start + 5 * SECOND, 0);
    expect(view.question).toBeUndefined();
    expect(view.revealed[0]).toMatchObject({ answer: answerOf(d, 0), picks: [{ choice: answerOf(d, 0) }, { choice: wrongOf(d, 0) }] });
    expect(view.revealed[0].revealUrl).toMatch(/^\/api\/media\//);
    expect(view.next).toEqual({ at: start + 4 * SECOND + QUIZ_DUEL_REVEAL_MS, pressed: [false, false] });
  });

  it("closes a question after 15 s; an answer in flight at the bell still counts", () => {
    const { duel, red, blue, start } = started();
    const bell = start + QUIZ_DUEL_QUESTION_MS;
    let d = must(answerQuiz(duel, red, 0, answerOf(duel), start + SECOND));
    d = pollUntil(d, bell);
    const late = must(answerQuiz(d, blue, 0, answerOf(d), bell + 500));
    expect(late.questions[0].result?.points).toEqual([quizDuelPoints(SECOND), quizDuelPoints(QUIZ_DUEL_QUESTION_MS + 500)]);
    d = pollUntil(d, bell + 2 * SECOND);
    expect(d.questions[0].result).toMatchObject({ at: bell + SECOND, points: [quizDuelPoints(SECOND), 0] });
    expect(quizView(d, red, bell + 2 * SECOND, 0).revealed[0].picks[1]).toBeNull();
    expect(failure(answerQuiz(d, blue, 0, answerOf(d, 0), bell + 2 * SECOND))?.error).toMatch(/over/);
  });

  it("shows the reveal for 8 s, or until both trainers press Next", () => {
    let d = playQuestion(started().duel, ["right", "right"]);
    expect(d.questions).toHaveLength(2);
    const prev = d.questions[0].result!;
    expect(d.questions[1].startsAt).toBe(prev.nextAt + PVP_LEAD_MS);

    const { duel: other, red, blue, start } = started();
    d = must(answerQuiz(must(answerQuiz(other, red, 0, answerOf(other), start + SECOND)), blue, 0, answerOf(other), start + SECOND));
    d = must(skipQuizReveal(d, red, 0, start + 2 * SECOND));
    expect(d.questions).toHaveLength(1);
    d = must(skipQuizReveal(d, blue, 0, start + 3 * SECOND));
    expect(d.questions).toHaveLength(2);
    expect(d.questions[1].startsAt).toBe(start + 3 * SECOND + PVP_LEAD_MS);
    expect(must(skipQuizReveal(d, red, 0, start + 4 * SECOND)).questions).toHaveLength(2);
  });

  it("plays ten questions: the most points wins, then the quicker right answers, else a draw", () => {
    const race = started();
    let d = race.duel;
    for (let i = 0; i < QUIZ_DUEL_QUESTIONS; i++) d = playQuestion(d, [i % 3 === 0 ? "wrong" : "right", i % 2 === 0 ? "wrong" : "right"]);
    expect(d.questions).toHaveLength(QUIZ_DUEL_QUESTIONS);
    expect(d.status).toBe("finished");
    // Red got 6 right, Blue 5.
    expect(d.end).toMatchObject({ reason: "played", winner: 0 });
    const final = quizView(d, race.blue, T0, 0);
    expect(final.revealed).toHaveLength(QUIZ_DUEL_QUESTIONS);
    expect(final.revealed.at(-1)!.scores).toEqual(d.scores);
    // Only the latest reveal carries media.
    expect(final.revealed.filter((r) => r.revealUrl || r.question.media)).toHaveLength(1);

    // The same answers, Blue a few milliseconds quicker each time: level on points (the bonus is rounded), Blue wins.
    const close = started(undefined, undefined, "close-seed");
    d = close.duel;
    for (let i = 0; i < QUIZ_DUEL_QUESTIONS; i++) d = playQuestion(d, ["right", "right"], [2 * SECOND + 10, 2 * SECOND]);
    expect(d.scores[0]).toBe(d.scores[1]);
    expect(d.end).toMatchObject({ reason: "played", winner: 1 });

    const level = started(undefined, undefined, "level-seed");
    d = level.duel;
    for (let i = 0; i < QUIZ_DUEL_QUESTIONS; i++) d = playQuestion(d, ["right", "right"], [2 * SECOND, 2 * SECOND]);
    expect(d.end).toMatchObject({ reason: "played", winner: null });
  });
});

describe("quiz duel: forfeits", () => {
  it("forfeits a trainer who stops responding, or leaves", () => {
    const { duel, red, start } = started();
    let d = duel;
    for (let at = start; at < start + PVP_AWAY_MS + 10 * SECOND; at += 5 * SECOND) d = touchDuel(d, red, at);
    expect(d.end).toMatchObject({ reason: "left", winner: 0 });
    expect(must(leaveDuel(duel, red, start + SECOND)).end).toMatchObject({ reason: "left", winner: 1 });
  });

  it("forfeits a trainer who doesn't answer three questions in a row", () => {
    const { duel } = started();
    let d = duel;
    for (let i = 0; i < QUIZ_DUEL_IDLE_QUESTIONS; i++) d = playQuestion(d, ["wrong", null]);
    expect(d.end).toMatchObject({ reason: "idle", winner: 0 });
  });
});

describe("quiz duel: security", () => {
  it("never shows the answer or the opponent's pick before the reveal", () => {
    const { duel, red, blue, start } = started("dex");
    const d = must(answerQuiz(duel, red, 0, wrongOf(duel), start + 2 * SECOND));
    const q = duelQuestion(d, 0);
    for (const viewer of [blue, null]) {
      const view = quizView(d, viewer, start + 3 * SECOND, 0);
      const json = JSON.stringify(view);
      expect(view.question!.answered).toEqual([true, false]);
      expect(view.question!.yours).toBeUndefined();
      expect(json).not.toMatch(/"(answer|explanation|revealUrl|revealMedia|choice|picks|seed|itemKey|rating|pokemonId)":/);
      if (q.explanation) expect(json).not.toContain(q.explanation);
      expect(json).not.toContain(d.seed);
    }
    expect(quizView(d, red, start + 3 * SECOND, 0).question!.yours).toBe(wrongOf(d));
  });

  it("rejects illegal answers", () => {
    const { duel, red, blue, start } = started();
    expect(failure(answerQuiz(duel, red, 0, answerOf(duel), start - SECOND))?.error).toMatch(/hasn't started/);
    expect(failure(answerQuiz(duel, red, 0, "Missingno", start + SECOND))?.status).toBe(400);
    const once = must(answerQuiz(duel, red, 0, wrongOf(duel), start + SECOND));
    expect(failure(answerQuiz(once, red, 0, answerOf(duel), start + 2 * SECOND))?.error).toMatch(/already answered/);
    expect(failure(answerQuiz(once, red, 1, answerOf(duel), start + 2 * SECOND))?.status).toBe(409);
    expect(failure(answerQuiz(once, "stranger", 0, answerOf(duel), start + 2 * SECOND))?.status).toBe(403);
    const over = must(leaveDuel(duel, blue, start + SECOND));
    expect(failure(answerQuiz(over, red, 0, answerOf(duel), start + 2 * SECOND))?.error).toMatch(/over/);
  });
});

describe("quiz duel: rematch", () => {
  it("keeps the mode (and its fixed difficulty), with new questions, once both press Rematch", () => {
    // An old invite carried Hard for every mode: its rematch plays Type Master's one fixed tuning.
    const old = started("types", "hard");
    const oldOver = must(leaveDuel(old.duel, old.blue, old.start + SECOND));
    expect(rematchOf(oldOver, "mnpqrstv", old.start + 5 * SECOND)).toMatchObject({ module: "types", difficulty: "medium" });

    // Whose Team keeps its choice.
    const { duel, red, blue, start } = started("whose-team", "hard");
    const over = must(leaveDuel(duel, blue, start + SECOND));
    const t = start + 5 * SECOND;
    const next = rematchOf(over, "mnpqrstu", t);
    expect(next).toMatchObject({ kind: "quiz", module: "whose-team", difficulty: "hard", status: "lobby", scores: [0, 0], questions: [] });
    expect(next.seed).not.toBe(over.seed);
    let d = must(takeRematchSeat(next, red, "Red", t));
    d = must(takeRematchSeat(d, blue, "Blue", t + SECOND));
    expect(d.status).toBe("playing");
    expect([0, 1, 2].map((i) => duelQuestion(d, i).itemKey)).not.toEqual([0, 1, 2].map((i) => duelQuestion(over, i).itemKey));
  });
});
