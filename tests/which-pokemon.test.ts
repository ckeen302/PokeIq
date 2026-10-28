import { describe, expect, it } from "vitest";
import { Rng } from "@/lib/rng";
import { AXES, type Profile } from "@/lib/which-pokemon/types";
import { QUESTION_BANK, RUN_LENGTH, drawQuestions, scoreResponses, tieBreaker } from "@/lib/which-pokemon/questions";
import { ALL_SPECIES, DEEP_CUTS, POOL, genOf, isPooled, speciesInfo } from "@/lib/which-pokemon/pool";
import { compatibility, comparePath, decodeScores, encodeScores, matchProfile, parseFragment, partnerTarget, resultPath, rivalTarget } from "@/lib/which-pokemon/match";
import { nextStep, runQuiz } from "@/lib/which-pokemon/run";
import { simulateBalance, simulateRun } from "@/lib/which-pokemon/simulate";
import { POKEDEX } from "@/lib/pokemon/pokedex";

describe("Which Pokémon Are You?: question bank", () => {
  it("has at least five items per axis, keyed both ways, with no duplicates", () => {
    const ids = new Set(QUESTION_BANK.map((q) => q.id));
    const texts = new Set(QUESTION_BANK.map((q) => q.text.toLowerCase()));
    expect(ids.size).toBe(QUESTION_BANK.length);
    expect(texts.size).toBe(QUESTION_BANK.length);
    for (const axis of AXES) {
      const items = QUESTION_BANK.filter((q) => q.axis === axis);
      expect(items.length, axis).toBeGreaterThanOrEqual(5);
      expect(items.some((q) => q.key === 1), `${axis} +`).toBe(true);
      expect(items.some((q) => q.key === -1), `${axis} −`).toBe(true);
    }
  });

  it("draws 18 distinct questions with two to three per axis, one of each keying, in a seeded order", () => {
    const run = drawQuestions("seed-a");
    expect(run).toHaveLength(RUN_LENGTH);
    expect(new Set(run.map((q) => q.id)).size).toBe(RUN_LENGTH);
    for (const axis of AXES) {
      const items = run.filter((q) => q.axis === axis);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeLessThanOrEqual(3);
      expect(items.some((q) => q.key === 1)).toBe(true);
      expect(items.some((q) => q.key === -1)).toBe(true);
    }
    expect(drawQuestions("seed-a").map((q) => q.id)).toEqual(run.map((q) => q.id));
    expect(drawQuestions("seed-b").map((q) => q.id)).not.toEqual(run.map((q) => q.id));
  });

  it("scores answers through their keying onto 0–100", () => {
    const neutral = scoreResponses(QUESTION_BANK.map((q) => ({ id: q.id, answer: 3 as const })));
    expect(neutral).toEqual([50, 50, 50, 50, 50, 50, 50]);
    const agreeAll = scoreResponses(QUESTION_BANK.filter((q) => q.axis === "extraversion").map((q) => ({ id: q.id, answer: 5 as const })));
    expect(agreeAll[0]).toBe(50); // half the items are reverse-keyed
    const extravert = scoreResponses(QUESTION_BANK.filter((q) => q.axis === "extraversion").map((q) => ({ id: q.id, answer: (q.key === 1 ? 5 : 1) as 1 | 5 })));
    expect(extravert[0]).toBe(100);
    expect(extravert[1]).toBe(50);
  });

  it("picks a tie-breaker on the axis where the two leaders differ most", () => {
    const a: Profile = [50, 50, 50, 50, 50, 90, 50];
    const b: Profile = [50, 50, 50, 50, 50, 10, 50];
    const q = tieBreaker(["k1"], a, b);
    expect(q?.axis).toBe("competitiveness");
    expect(q?.key).toBe(-1);
    const none = tieBreaker(QUESTION_BANK.map((qq) => qq.id), a, b);
    expect(none).toBeNull();
  });

  it("asks up to two tie-breakers only when the top two are close", () => {
    let maxAsked = 0;
    let breakers = 0;
    const rng = new Rng("ties");
    for (let i = 0; i < 300; i++) {
      const { responses, result } = simulateRun(rng);
      maxAsked = Math.max(maxAsked, responses.length);
      if (responses.length > RUN_LENGTH) breakers++;
      expect(responses.length).toBeLessThanOrEqual(RUN_LENGTH + 2);
      expect(result.top.pokemon).toBeDefined();
    }
    expect(maxAsked).toBeGreaterThan(RUN_LENGTH);
    expect(breakers).toBeGreaterThan(0);
    expect(breakers).toBeLessThan(300);
  });
});

describe("Which Pokémon Are You?: the pool", () => {
  it("is 150–200 real species with distinct slugs, profiles in range, a rationale and a write-up", () => {
    expect(POOL.length).toBeGreaterThanOrEqual(150);
    expect(POOL.length).toBeLessThanOrEqual(200);
    expect(new Set(POOL.map((p) => p.slug)).size).toBe(POOL.length);
    const bySlug = new Map(POKEDEX.map((p) => [p.slug, p]));
    for (const p of POOL) {
      const species = bySlug.get(p.slug);
      expect(species, p.slug).toBeDefined();
      expect(species!.id).toBe(p.id);
      expect(p.p).toHaveLength(7);
      for (const v of p.p) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(p.why.length, p.slug).toBeGreaterThan(40);
      expect(p.blurb.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, p.slug).toBeGreaterThanOrEqual(3);
      expect(p.blurb).toMatch(/\byou\b/i);
      expect(p.title).toMatch(/^The /);
      expect(Math.abs(p.bias ?? 0)).toBeLessThanOrEqual(10);
    }
  });

  it("covers every type and every generation", () => {
    const types = new Set<string>();
    const gens = new Set<number>();
    for (const p of POOL) {
      const s = speciesInfo(p.id)!;
      s.types.forEach((t) => types.add(t));
      gens.add(s.gen);
    }
    expect(types.size).toBe(18);
    expect([...gens].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("gives every one of the 1,025 species a light profile, and keeps the deep cuts outside the pool", () => {
    expect(ALL_SPECIES).toHaveLength(POKEDEX.length);
    const ids = new Set(ALL_SPECIES.map((r) => r[0]));
    for (const p of POKEDEX) expect(ids.has(p.id), p.slug).toBe(true);
    for (const row of ALL_SPECIES) {
      for (const v of row.slice(4) as number[]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    expect(DEEP_CUTS.length).toBe(POKEDEX.length - POOL.length);
    expect(DEEP_CUTS.every((s) => !isPooled(s.id))).toBe(true);
    expect(genOf(25)).toBe(1);
    expect(genOf(152)).toBe(2);
    expect(genOf(906)).toBe(9);
  });
});

describe("Which Pokémon Are You?: matching", () => {
  it("is deterministic and returns a full result", () => {
    const scores: Profile = [70, 20, 30, 70, 60, 65, 65];
    const a = matchProfile(scores);
    const b = matchProfile(scores);
    expect(a.top.pokemon.id).toBe(b.top.pokemon.id);
    expect(a.runnersUp.map((m) => m.pokemon.id)).toEqual(b.runnersUp.map((m) => m.pokemon.id));
    expect(a.deepCut.species.id).toBe(b.deepCut.species.id);
    expect(a.partner.pokemon.id).toBe(b.partner.pokemon.id);
    expect(a.rival.pokemon.id).toBe(b.rival.pokemon.id);
    const ids = [a.top, ...a.runnersUp, a.partner, a.rival].map((m) => m.pokemon.id);
    expect(new Set(ids).size).toBe(5);
    expect(isPooled(a.deepCut.species.id)).toBe(false);
    expect(a.top.similarity).toBeGreaterThanOrEqual(a.runnersUp[0].similarity);
    expect(a.runnersUp[0].similarity).toBeGreaterThanOrEqual(a.runnersUp[1].similarity);
  });

  it("matches a Pokémon's own profile to itself (allowing for its calibration bias)", () => {
    let self = 0;
    for (const p of POOL) if (matchProfile(p.p).top.pokemon.id === p.id) self++;
    expect(self / POOL.length).toBeGreaterThan(0.85);
  });

  it("pins the page's Pokémon as the top match when asked", () => {
    const gengar = POOL.find((p) => p.slug === "gengar")!;
    const r = matchProfile([50, 90, 70, 40, 70, 10, 20], gengar);
    expect(r.top.pokemon.id).toBe(gengar.id);
    expect(r.runnersUp.some((m) => m.pokemon.id === gengar.id)).toBe(false);
  });

  it("builds partner and rival targets as specified", () => {
    const s: Profile = [80, 70, 60, 50, 40, 30, 20];
    expect(partnerTarget(s)).toEqual([20, 70, 60, 50, 40, 70, 80]);
    expect(rivalTarget(s)).toEqual([80, 30, 60, 50, 40, 70, 20]);
  });

  it("scores compatibility symmetrically, 100 for twins", () => {
    const a: Profile = [80, 70, 60, 50, 40, 30, 20];
    const b: Profile = [20, 30, 40, 50, 60, 70, 80];
    expect(compatibility(a, a).percent).toBe(100);
    expect(compatibility(a, b).percent).toBe(compatibility(b, a).percent);
    expect(compatibility(a, b).percent).toBeLessThan(compatibility(a, [70, 65, 55, 50, 45, 40, 30]).percent);
  });
});

describe("Which Pokémon Are You?: links", () => {
  it("round-trips scores through the payload and the fragments", () => {
    const scores: Profile = [0, 12, 50, 88, 100, 37, 63];
    const payload = encodeScores(scores);
    expect(payload).toHaveLength(15);
    expect(decodeScores(payload)).toEqual(scores);
    expect(decodeScores(payload.toUpperCase())).toBeNull();
    expect(decodeScores("1zzzzzzzzzzzzzz")).toBeNull(); // 'zz' = 1295, out of range
    expect(decodeScores("")).toBeNull();
    expect(decodeScores(42)).toBeNull();
    const other: Profile = [55, 45, 65, 35, 75, 25, 85];
    expect(parseFragment(`#a=${payload}&b=${encodeScores(other)}`)).toEqual({ a: scores, b: other });
    expect(parseFragment(resultPath("gengar", scores).split("#")[1]).r).toEqual(scores);
    expect(comparePath(scores, other)).toBe(`/quiz/which-pokemon/compare#a=${payload}&b=${encodeScores(other)}`);
    expect(parseFragment("#r=garbage&a=1")).toEqual({});
  });
});

describe("Which Pokémon Are You?: balance and stability (20,000 simulated players)", () => {
  it("lets no pooled Pokémon win more than 2.5% or less than 0.1%, and keeps retakes in the same top three at least 70% of the time", () => {
    const report = simulateBalance(20_000, "which-pokemon");
    const shares = [...report.wins.entries()].map(([id, w]) => ({ id, share: w / report.runs }));
    const over = shares.filter((s) => s.share > 0.025).map((s) => POOL.find((p) => p.id === s.id)!.slug);
    const under = shares.filter((s) => s.share < 0.001).map((s) => POOL.find((p) => p.id === s.id)!.slug);
    expect(over, `too common: ${over.join(", ")}`).toEqual([]);
    expect(under, `unreachable: ${under.join(", ")}`).toEqual([]);
    expect(report.maxShare).toBeLessThanOrEqual(0.025);
    expect(report.minShare).toBeGreaterThanOrEqual(0.001);
    expect(report.stability).toBeGreaterThanOrEqual(0.7);
  });

  it("runs the same step function the page uses", () => {
    const { questions, responses, result } = runQuiz("step", () => 4);
    expect(responses.length).toBeGreaterThanOrEqual(RUN_LENGTH);
    expect(questions.length).toBe(responses.length);
    const replay = nextStep(questions, responses);
    expect(replay.done && replay.result.top.pokemon.id).toBe(result.top.pokemon.id);
  });
});
