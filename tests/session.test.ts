import { describe, expect, it } from "vitest";
import { signToken, verifyToken, encryptJson, decryptJson } from "@/lib/server/crypto";
import { answerClaimKey, gradeAnswer, nextQuestion, questionAt, readSession, startSession } from "@/lib/server/session";
import { recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { practiceMessage } from "@/lib/server/leaderboard";
import { evaluate, answerFor } from "@/lib/server/pokedle";
import { performanceRating, ratingToIQ } from "@/lib/rating";
import { dailyNumber, isValidDailyDate } from "@/lib/daily";
import type { SessionSpec } from "@/lib/session-types";

const spec: SessionSpec = { module: "whos-that", format: "classic", difficulty: "medium", seed: "test-seed" };

describe("signed tokens", () => {
  it("round-trips and rejects tampering", () => {
    const token = signToken("result", { score: 100 });
    expect(verifyToken("result", token)).toEqual({ score: 100 });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ score: 99999 })).toString("base64url");
    expect(verifyToken("result", `${forged}.${sig}`)).toBeNull();
    expect(verifyToken("result", `${body}.AAAA${sig.slice(4)}`)).toBeNull();
  });

  it("binds tokens to their purpose", () => {
    expect(verifyToken("result", signToken("share", { a: 1 }))).toBeNull();
  });

  it("encrypts media tokens opaquely", () => {
    const t = encryptJson({ k: "silhouette", id: 25 });
    // Neither the plaintext nor the base64 of it shows through (the token is random-IV ciphertext).
    expect(Buffer.from(t, "base64url").toString("latin1")).not.toContain("silhouette");
    expect(t).not.toContain(Buffer.from('{"k":"silhouette"').toString("base64url").slice(0, 12));
    expect(decryptJson(t)).toEqual({ k: "silhouette", id: 25 });
    expect(decryptJson(t.slice(0, -2) + "xx")).toBeNull();
  });
});

describe("sessions", () => {
  it("never sends the answer with the question", () => {
    const { question } = startSession(spec);
    expect(JSON.stringify(question)).not.toContain('"answer"');
    expect(question.media?.url).toMatch(/^\/api\/media\//);
  });

  it("re-derives identical questions from the seed", () => {
    expect(questionAt(spec, 3)).toEqual(questionAt({ ...spec }, 3));
  });

  it("grades a perfect classic run server-side", () => {
    let state = readSession(startSession(spec).token)!;
    let last;
    for (let i = 0; i < 10; i++) {
      const outcome = gradeAnswer(state, questionAt(spec, i).answer);
      if (!outcome.ok) throw new Error(outcome.error);
      expect(outcome.response.correct).toBe(true);
      expect(outcome.claimKey).toBe(`ans:${state.sid}:${i}`);
      last = outcome.response;
      state = readSession(outcome.response.token)!;
      if (outcome.response.awaitNext) {
        const served = nextQuestion(state);
        if (!served.ok) throw new Error(served.error);
        expect(served.response.question.index).toBe(i + 1);
        state = readSession(served.response.token)!;
      }
    }
    expect(last!.done).toBe(true);
    expect(last!.awaitNext).toBe(false);
    expect(last!.result!.correct).toBe(10);
    expect(last!.result!.grid).toBe("1111111111");
    expect(last!.result!.pokeiq).toBeGreaterThan(115);
    expect(verifyToken("result", last!.resultToken)).not.toBeNull();
    // Finished runs can't keep scoring.
    const extra = gradeAnswer(state, "anything");
    expect(extra.ok).toBe(false);
  });

  it("survival ends after three wrong answers", () => {
    const s: SessionSpec = { ...spec, format: "survival" };
    let state = readSession(startSession(s).token)!;
    let response;
    for (let i = 0; i < 3; i++) {
      const outcome = gradeAnswer(state, "definitely wrong");
      if (!outcome.ok) throw new Error(outcome.error);
      response = outcome.response;
      state = readSession(response.token)!;
      if (response.awaitNext) {
        const served = nextQuestion(state);
        if (!served.ok) throw new Error(served.error);
        state = readSession(served.response.token)!;
      }
    }
    expect(response!.lives).toBe(0);
    expect(response!.done).toBe(true);
  });

  it("rejects tampered session tokens", () => {
    const { token } = startSession(spec);
    const [body, sig] = token.split(".");
    const state = JSON.parse(Buffer.from(body, "base64url").toString());
    state.score = 1_000_000;
    const forged = `${Buffer.from(JSON.stringify(state)).toString("base64url")}.${sig}`;
    expect(readSession(forged)).toBeNull();
  });
});

describe("pokedle", () => {
  it("answers are stable per puzzle and differ across days", () => {
    expect(answerFor({ id: "daily:2026-10-17" }).id).toBe(answerFor({ id: "daily:2026-10-17" }).id);
    const ids = new Set(Array.from({ length: 10 }, (_, i) => answerFor({ id: `daily:2026-10-${10 + i}` }).id));
    expect(ids.size).toBeGreaterThan(7);
  });

  it("solves when the answer is guessed and reveals it", () => {
    const puzzle = { id: "practice:abc" };
    const answer = answerFor(puzzle);
    const wrong = answer.id === 1 ? 4 : 1;
    const res = evaluate(puzzle, [wrong, answer.id]);
    expect(res.solved).toBe(true);
    expect(res.rows[1].cells.gen!.status).toBe("match");
    expect(res.answer?.id).toBe(answer.id);
  });

  it("does not reveal the answer mid-game", () => {
    const puzzle = { id: "practice:xyz" };
    const answer = answerFor(puzzle);
    const res = evaluate(puzzle, [answer.id === 1 ? 4 : 1]);
    expect(res.over).toBe(false);
    expect(res.answer).toBeUndefined();
  });
});

describe("rating + daily calendar", () => {
  it("rates more correct answers higher", () => {
    const items = (k: number) => Array.from({ length: 10 }, (_, i) => ({ correct: i < k, rating: 1200, options: 4 }));
    const ratings = [0, 3, 6, 10].map((k) => performanceRating(items(k)));
    expect([...ratings].sort((a, b) => a - b)).toEqual(ratings);
    expect(ratingToIQ(performanceRating([]))).toBe(100);
  });

  it("validates daily dates within a day of now", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(isValidDailyDate("2026-10-20", now)).toBe(true);
    expect(isValidDailyDate("2026-10-21", now)).toBe(true);
    expect(isValidDailyDate("2026-10-23", now)).toBe(false);
    expect(isValidDailyDate("2026-10-16", now)).toBe(false); // before launch
    // Impossible dates are rejected rather than rolled over.
    const oct1 = Date.parse("2026-10-01T12:00:00Z");
    expect(isValidDailyDate("2026-09-31", oct1)).toBe(false);
    expect(isValidDailyDate("2026-10-19", Date.parse("2026-10-19T12:00:00Z"))).toBe(true);
    expect(isValidDailyDate("2026-02-30", now)).toBe(false);
    expect(dailyNumber("2026-10-17")).toBe(1);
  });
});

describe("blitz", () => {
  it("closes the run on the time-up ping without logging a wrong answer", () => {
    const s: SessionSpec = { ...spec, format: "blitz", seed: "blitz-seed" };
    const state = readSession(startSession(s).token)!;
    const expired = { ...state, startedAt: Date.now() - 60_200 };
    const outcome = gradeAnswer(expired, null);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.response.done).toBe(true);
    expect(outcome.response.result!.total).toBe(0);
    expect(outcome.response.counted).toBe(false);
    expect(outcome.response.tags).toEqual([]);
    expect(outcome.record).toBe(false);
  });

  it("returns the final result for a request that arrives long after the clock ran out", () => {
    const s: SessionSpec = { ...spec, format: "blitz", seed: "blitz-late" };
    let state = readSession(startSession(s).token)!;
    const first = gradeAnswer(state, questionAt(s, 0).answer);
    if (!first.ok) throw new Error(first.error);
    state = readSession(first.response.token)!;
    // Tab was backgrounded: the next request lands 20s after the run ended.
    const late = { ...state, startedAt: Date.now() - 80_000 };
    for (const choice of [null, questionAt(s, 1).answer]) {
      const outcome = gradeAnswer(late, choice);
      if (!outcome.ok) throw new Error(outcome.error);
      expect(outcome.response.done).toBe(true);
      expect(outcome.response.correct).toBe(false);
      expect(outcome.response.result!.correct).toBe(1);
      expect(outcome.response.resultToken).toBeTruthy();
      expect(outcome.record).toBe(false);
    }
  });
});

describe("paused questions (timed formats)", () => {
  it("withholds the next question until it is requested, then starts its clock", () => {
    const state = readSession(startSession({ ...spec, seed: "pause-seed" }).token)!;
    const graded = gradeAnswer(state, "wrong");
    if (!graded.ok) throw new Error(graded.error);
    expect(graded.response.awaitNext).toBe(true);
    expect(graded.response.next).toBeUndefined();

    const paused = readSession(graded.response.token)!;
    // Answering a question that was never served is refused.
    const early = gradeAnswer(paused, "anything");
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.status).toBe(409);

    // Reading time doesn't count: the clock starts when /next is called.
    const served = nextQuestion({ ...paused, servedAt: Date.now() - 60_000 });
    if (!served.ok) throw new Error(served.error);
    expect(served.claimKey).toBe(`next:${paused.sid}:1`);
    expect(JSON.stringify(served.response.question)).not.toContain('"answer"');
    const live = readSession(served.response.token)!;
    expect(Date.now() - live.servedAt).toBeLessThan(1000);
    const answered = gradeAnswer(live, questionAt({ ...spec, seed: "pause-seed" }, 1).answer);
    if (!answered.ok) throw new Error(answered.error);
    expect(answered.response.correct).toBe(true);
    expect(answered.response.timedOut).toBe(false);

    // A live (unpaused) token can't be "re-served" to restart the timer.
    expect(nextQuestion(live).ok).toBe(false);
  });

  it("blitz keeps serving the next question inline", () => {
    const s: SessionSpec = { ...spec, format: "blitz", seed: "blitz-inline" };
    const state = readSession(startSession(s).token)!;
    const outcome = gradeAnswer(state, "wrong");
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.response.awaitNext).toBe(false);
    expect(outcome.response.next?.index).toBe(1);
  });

  it("replays the stored response for an identical retry only", () => {
    const state = readSession(startSession({ ...spec, seed: "retry-seed" }).token)!;
    const key = answerClaimKey(state);
    const fp = requestFingerprint("token", "Pikachu");
    rememberResponse(key, fp, { ok: 1 });
    expect(recallResponse(key, fp)).toEqual({ ok: 1 });
    expect(recallResponse(key, requestFingerprint("token", "Raichu"))).toBeNull();
    expect(recallResponse(key, requestFingerprint("token", null))).toBeNull();
  });
});

describe("leaderboard eligibility", () => {
  it("rejects practice runs and accepts ranked ones", () => {
    const daily: SessionSpec = { ...spec, module: "mixed", daily: "2026-11-01" };
    const test: SessionSpec = { ...spec, module: "mixed", format: "adaptive" };
    expect(practiceMessage({ spec: daily })).toBeNull();
    expect(practiceMessage({ spec: test })).toBeNull();
    expect(practiceMessage({ spec: { ...test, practice: "challenge" } })).toMatch(/challenge/i);
    expect(practiceMessage({ spec: daily, practice: "repeat-daily" })).toMatch(/first Daily/i);
    expect(practiceMessage({ spec: { ...test, practice: "filtered" } })).toMatch(/generation/i);
  });

  it("keeps quiz-mode runs off the leaderboard: their bests go on the profile", () => {
    for (const format of ["classic", "survival", "blitz"] as const) {
      expect(practiceMessage({ spec: { ...spec, format } })).toMatch(/no leaderboard.*profile/i);
    }
    expect(practiceMessage({ spec: { ...spec, module: "whose-team", difficulty: "hard" } })).toMatch(/no leaderboard/i);
  });

  it("carries the practice flag from the signed spec into the result", () => {
    const s: SessionSpec = { ...spec, format: "blitz", seed: "practice-seed", practice: "challenge" };
    const state = readSession(startSession(s).token)!;
    const outcome = gradeAnswer({ ...state, startedAt: Date.now() - 70_000 }, null);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.response.result!.practice).toBe("challenge");
  });
});
