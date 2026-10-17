import { describe, expect, it } from "vitest";
import { gradeAnswer, questionAt, readSession, startSession } from "@/lib/server/session";
import type { SessionSpec } from "@/lib/session-types";
import { Rng } from "@/lib/rng";
import { pCorrect } from "@/lib/rating";

const spec = (seed: string): SessionSpec => ({ module: "mixed", format: "adaptive", difficulty: "medium", seed });

/** Simulate a player of fixed true rating answering an adaptive test. */
function simulate(trueRating: number, seed: string) {
  const s = spec(seed);
  const rng = new Rng(`player-${seed}`);
  const start = startSession(s);
  let state = readSession(start.token)!;
  const served: number[] = [];
  let last;
  for (let i = 0; i < 20; i++) {
    const q = questionAt(s, i, state.log);
    served.push(q.rating);
    const right = rng.next() < pCorrect(trueRating, q.rating, q.options.length);
    const outcome = gradeAnswer(state, right ? q.answer : "__wrong__");
    if (!outcome.ok) throw new Error(outcome.error);
    last = outcome.response;
    if (!last.done) expect(last.next!.prompt).toBe(questionAt(s, i + 1, readSession(last.token)!.log).prompt);
    state = readSession(last.token)!;
  }
  return { served, result: last!.result! };
}

describe("adaptive PokéIQ test", { timeout: 60_000 }, () => {
  it("serves the same question it later grades", () => {
    const s = spec("served-vs-graded");
    const start = startSession(s);
    expect(start.question.prompt).toBe(questionAt(s, 0, []).prompt);
    expect(start.question.options).toEqual(questionAt(s, 0, []).options);
  });

  it("finishes after 20 questions with a trajectory and shrinking uncertainty", () => {
    const { result } = simulate(1300, "traj");
    expect(result.total).toBe(20);
    expect(result.trajectory).toHaveLength(20);
    expect(result.se!).toBeLessThan(result.trajectory![0][1]);
  });

  it("serves harder questions to stronger players", () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    let strongLate = 0;
    let weakLate = 0;
    for (let k = 0; k < 6; k++) {
      strongLate += mean(simulate(1700, `strong-${k}`).served.slice(10));
      weakLate += mean(simulate(800, `weak-${k}`).served.slice(10));
    }
    expect(strongLate / 6).toBeGreaterThan(weakLate / 6 + 100);
  });

  it("ranks a strong simulated player above a weak one", () => {
    let wins = 0;
    for (let k = 0; k < 8; k++) {
      if (simulate(1600, `cmp-${k}`).result.rating > simulate(950, `cmp-${k}`).result.rating) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(7);
  });
});
