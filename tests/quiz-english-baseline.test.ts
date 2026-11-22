import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Rng } from "@/lib/rng";
import { buildQuestion, DIFFICULTIES, MODULES, type ModuleId } from "@/engines";
import { questionAt } from "@/lib/server/session";
import type { SessionSpec } from "@/lib/session-types";

/**
 * English runs must stay byte-identical while the quiz learns other languages: every module, difficulty and many
 * seeds are hashed and compared with hashes recorded before the languages were added
 * (tests/fixtures/quiz-english-baseline.json). `QUIZ_BASELINE_WRITE=1` records them afresh (only ever on English code
 * known to be right).
 */

const FIXTURE = join(import.meta.dirname, "fixtures", "quiz-english-baseline.json");
const SEEDS = 24;
const PER_RUN = 12;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

function engineRuns(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mod of MODULES as readonly ModuleId[]) {
    for (const difficulty of DIFFICULTIES) {
      for (const gens of [undefined, [1], [4, 9]]) {
        for (let s = 0; s < SEEDS; s++) {
          if (gens && s >= 6) break;
          const rng = new Rng(`baseline:${mod}:${difficulty}:${s}`);
          const used = new Set<number>();
          const questions = [];
          for (let i = 0; i < PER_RUN; i++) questions.push(buildQuestion(mod, rng, { difficulty, gens, used }));
          out[`${mod}|${difficulty}|${gens?.join(",") ?? ""}|${s}`] = hash(questions);
        }
      }
    }
  }
  for (const scope of ["games", "anime"] as const) {
    for (let s = 0; s < 6; s++) {
      const rng = new Rng(`baseline:whose-team:${scope}:${s}`);
      const used = new Set<number>();
      const questions = [];
      for (let i = 0; i < PER_RUN; i++) questions.push(buildQuestion("whose-team", rng, { difficulty: "hard", used, scope }));
      out[`whose-team|hard|scope:${scope}|${s}`] = hash(questions);
    }
  }
  return out;
}

function sessionRuns(): Record<string, string> {
  const out: Record<string, string> = {};
  const specs: SessionSpec[] = [
    { module: "mixed", format: "classic", difficulty: "medium", seed: "daily:2026-11-21", daily: "2026-11-21" },
    { module: "mixed", format: "classic", difficulty: "medium", seed: "daily:2026-01-01", daily: "2026-01-01" },
    { module: "whos-that", format: "survival", difficulty: "hard", seed: "baseline-survival" },
    { module: "dex", format: "blitz", difficulty: "easy", seed: "baseline-blitz" },
    { module: "games", format: "classic", difficulty: "medium", seed: "baseline-games", gens: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { module: "anime", format: "classic", difficulty: "medium", seed: "baseline-anime" },
    { module: "zoom-reveal", format: "classic", difficulty: "medium", seed: "zoom-daily:2026-11-21", zoomDaily: "2026-11-21", practice: "zoom-daily" },
    { module: "competitive", format: "classic", difficulty: "medium", seed: "duel:abc" },
  ];
  for (const spec of specs) {
    const questions = [];
    for (let i = 0; i < 15; i++) questions.push(questionAt(spec, i));
    out[`session|${spec.module}|${spec.format}|${spec.seed}`] = hash(questions);
  }
  // Adaptive runs depend on the answers: replay a fixed answer pattern.
  for (const mod of ["whos-that", "types", "games"] as const) {
    const spec: SessionSpec = { module: mod, format: "adaptive", difficulty: "medium", seed: `baseline-adaptive-${mod}` };
    const log: [0 | 1, number, number, number][] = [];
    const questions = [];
    for (let i = 0; i < 10; i++) {
      const q = questionAt(spec, i, log);
      questions.push(q);
      log.push([i % 3 === 0 ? 0 : 1, 4000, q.rating, q.options.length]);
    }
    out[`session|${mod}|adaptive`] = hash(questions);
  }
  return out;
}

describe("English quiz output", () => {
  // Session questions carry media tokens sealed with the server secret: hash them under the one the fixture was recorded with.
  beforeAll(() => vi.stubEnv("POKEIQ_SECRET", "ci-only-secret-not-used-anywhere-else"));
  afterAll(() => vi.unstubAllEnvs());
  it("is byte-identical to the recorded baseline", () => {
    const now = { ...engineRuns(), ...sessionRuns() };
    if (process.env.QUIZ_BASELINE_WRITE === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 0).replace(/,"/g, ',\n"')}\n`);
      return;
    }
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(recorded).sort());
    const changed = Object.keys(recorded).filter((k) => recorded[k] !== now[k]);
    expect(changed).toEqual([]);
  });
});
