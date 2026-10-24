import { describe, expect, it } from "vitest";
import answers from "@/data/shiny/answers.json";
import { buildQuestion } from "@/engines";
import { Rng } from "@/lib/rng";
import { gradeAnswer, questionAt, readSession, startSession } from "@/lib/server/session";
import type { SessionSpec } from "@/lib/session-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
process.env.SUPABASE_URL = "https://example.supabase.co";

const sets = answers.sets as Record<string, string[][]>;

describe("shiny answer map", () => {
  it("covers all 1,025 Pokémon with three sets of four distinct random names", () => {
    expect(Object.keys(sets)).toHaveLength(1025);
    const all: string[] = [];
    for (let id = 1; id <= 1025; id++) {
      expect(sets[id], `#${id}`).toHaveLength(3);
      for (const row of sets[id]) {
        expect(row).toHaveLength(4);
        all.push(...row);
      }
    }
    for (const name of all) expect(name).toMatch(/^[0-9a-f]{32}$/);
    // No name is ever shared between sets, so a repeated URL can't reveal the real one.
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("shiny quiz questions", () => {
  const run = (difficulty: "easy" | "medium" | "hard", n: number) => {
    const rng = new Rng(`shiny-${difficulty}`);
    const used = new Set<number>();
    return Array.from({ length: n }, () => buildQuestion("shiny", rng, { difficulty, used }));
  };

  it("serves four image options, one real, in shuffled positions", () => {
    const qs = run("medium", 400);
    const positions = [0, 0, 0, 0];
    for (const q of qs) {
      expect(q.optionImages).toBe(true);
      expect(q.options).toHaveLength(4);
      expect(q.options).toContain(q.answer);
      const id = Number(q.itemKey.split(":")[1]);
      expect(sets[id][1]).toContain(q.answer);
      expect(sets[id][1][0]).toBe(q.answer);
      positions[q.options.indexOf(q.answer)]++;
    }
    for (const n of positions) expect(n / qs.length).toBeGreaterThan(0.15);
  });

  it("uses a different image set per difficulty", () => {
    const [easy] = run("easy", 1);
    const [hard] = run("hard", 1);
    expect(easy.options.some((o) => hard.options.includes(o))).toBe(false);
  });

  it("never carries the answer, in the payload or the URLs", () => {
    const spec: SessionSpec = { module: "shiny", format: "classic", difficulty: "hard", seed: "shiny-leak" };
    const start = startSession(spec);
    const q = questionAt(spec, 0);
    const payload = JSON.stringify(start.question);
    expect(payload).not.toMatch(/"answer"|"explanation"|real shiny colouring/);
    expect(start.question.images).toHaveLength(4);
    for (const u of start.question.images!) expect(u).toMatch(/^https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/shiny\/[0-9a-f]{32}\.webp$/);
    expect(start.question.images).toEqual(q.options.map((o) => `https://example.supabase.co/storage/v1/object/public/shiny/${o}.webp`));
    // Nothing the browser gets names the Pokémon, its id or a tier.
    expect(JSON.stringify([start.question.options, start.question.images])).not.toMatch(/near|medium|far|decoy|fake|real/i);
  });

  it("is graded on the server", () => {
    const spec: SessionSpec = { module: "shiny", format: "classic", difficulty: "easy", seed: "shiny-grade" };
    const start = startSession(spec);
    const q = questionAt(spec, 0);
    const right = gradeAnswer(readSession(start.token)!, q.answer);
    expect(right.ok && right.response.correct).toBe(true);
    const wrong = gradeAnswer(readSession(start.token)!, q.options.find((o) => o !== q.answer)!);
    expect(wrong.ok && wrong.response.correct).toBe(false);
    if (wrong.ok) expect(wrong.response.answer).toBe(q.answer);
  });

  it("respects the generation filter", () => {
    const rng = new Rng("shiny-gen");
    for (let i = 0; i < 20; i++) {
      const q = buildQuestion("shiny", rng, { difficulty: "easy", gens: [1], used: new Set() });
      expect(Number(q.itemKey.split(":")[1])).toBeLessThanOrEqual(151);
    }
  });
});
