import { describe, expect, it } from "vitest";
import { signToken, verifyToken, encryptJson, decryptJson } from "@/lib/server/crypto";
import { gradeAnswer, questionAt, readSession, startSession } from "@/lib/server/session";
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
    expect(t).not.toContain("25");
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
    }
    expect(last!.done).toBe(true);
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
    expect(res.rows[1].cells.gen.status).toBe("match");
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
  });
});
