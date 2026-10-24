import { describe, expect, it } from "vitest";
import { Dex } from "@pkmn/dex";
import { buildQuestion } from "@/engines";
import { Rng } from "@/lib/rng";
import type { SessionSpec } from "@/lib/session-types";
import { gradeAnswer, questionAt, readSession, startSession } from "@/lib/server/session";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
const gen = Dex.forGen(9);

function run(seed: string, n = 300, gens?: number[]) {
  const rng = new Rng(seed);
  const used = new Set<number>();
  return Array.from({ length: n }, () => buildQuestion("competitive", rng, { difficulty: "hard", used, gens }));
}

describe("competitive quiz", () => {
  it("is deterministic and well-formed", () => {
    const a = run("c1");
    expect(run("c1")).toEqual(a);
    for (const q of a) {
      expect(q.module).toBe("competitive");
      expect(q.options).toHaveLength(q.itemKey.includes(":move-category:") ? 3 : 4);
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.options).toContain(q.answer);
    }
    expect(new Set(a.map((q) => q.itemKey.split(":")[1])).size).toBe(5);
  });

  it("answers match the Showdown data", () => {
    for (const q of run("c2", 400)) {
      const [, kind, name] = q.itemKey.split(":");
      if (kind === "move-type") expect(gen.moves.get(name).type).toBe(q.answer);
      if (kind === "move-category") expect(gen.moves.get(name).category).toBe(q.answer);
      if (kind === "item-desc") expect(gen.items.get(name).shortDesc).toBe(q.answer);
      if (kind === "ability-desc") expect(gen.abilities.get(name).shortDesc).toBe(q.answer);
      if (kind === "holder") {
        const has = (sp: string) => gen.species.all().some((s) => s.baseSpecies === sp && Object.values(s.abilities).includes(name));
        expect(has(q.answer)).toBe(true);
        for (const o of q.options.filter((o) => o !== q.answer)) expect(has(o), `${o} must not have ${name}`).toBe(false);
      }
    }
  });

  it("respects the generation filter", () => {
    for (const q of run("c3", 60, [3])) {
      const [, kind, name] = q.itemKey.split(":");
      const entry = kind.startsWith("move") ? gen.moves.get(name) : kind.startsWith("item") ? gen.items.get(name) : gen.abilities.get(name);
      expect(entry.gen).toBe(3);
    }
  });

  it("is graded server-side and leaks nothing early", () => {
    const spec: SessionSpec = { module: "competitive", format: "classic", difficulty: "medium", seed: "comp-leak" };
    const start = startSession(spec);
    expect(JSON.stringify(start.question)).not.toMatch(/"answer"|"explanation"/);
    const q = questionAt(spec, 0);
    const graded = gradeAnswer(readSession(start.token)!, q.answer);
    expect(graded.ok).toBe(true);
    if (graded.ok) {
      expect(graded.response.correct).toBe(true);
      expect(graded.response.answer).toBe(q.answer);
    }
    const wrong = gradeAnswer(readSession(start.token)!, q.options.find((o) => o !== q.answer)!);
    expect(wrong.ok && wrong.response.correct).toBe(false);
  });
});
