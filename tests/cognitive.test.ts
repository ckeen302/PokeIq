import { describe, expect, it } from "vitest";
import { ANCHORS } from "@/lib/cognitive/anchors";
import { START_LEVEL, maxRaw, rawScore, stepLevel } from "@/lib/cognitive/adaptive";
import { MATRIX_OPTIONS, matrixItem, numberItem } from "@/lib/cognitive/fluid";
import { ARITH_OPTIONS, SPAN_LENGTH, arithItem, spanCorrect, spanItem } from "@/lib/cognitive/memory";
import { NORMS } from "@/lib/cognitive/norms";
import { MAX_RAW, PLAN, sectionItem } from "@/lib/cognitive/plan";
import { cognitiveRecord, profileBars, profileWords } from "@/lib/cognitive/result";
import { compositePercentile, compositeRaw, knowledgePercentile, ordinal, percentileOf, phi, probit, scaledOf, scoreTest, type Norms } from "@/lib/cognitive/scoring";
import { simulateNorms } from "@/lib/cognitive/simulate";
import { SPEED_ROW, sameGlyph, speedRaw, speedRow } from "@/lib/cognitive/speed";
import { SPATIAL_OPTIONS, pathItem, pileCount, pileItem, rotationItem, shortestPath } from "@/lib/cognitive/spatial";
import { COG_SECTIONS, LEVELS, cellKey, type Cell, type MatrixItem } from "@/lib/cognitive/types";
import { mergeProgress, normalizeProgress } from "@/lib/progress-merge";
import type { Progress } from "@/lib/progress";
import { cognitiveRowOf, logCognitiveResult, memoryCognitiveStore } from "@/lib/server/cognitive-results";
import { cognitiveShareText, decodeShare, describeShare, encodeShare, type CognitiveShareResult } from "@/lib/share";

const SEEDS = Array.from({ length: 40 }, (_, i) => `seed-${i}`);

function expectOneRight(options: readonly Cell[], answer: number, rule: string) {
  const keys = options.map(cellKey);
  expect(new Set(keys).size, `${rule}: distinct options`).toBe(options.length);
  expect(answer, rule).toBeGreaterThanOrEqual(0);
  expect(answer, rule).toBeLessThan(options.length);
}

describe("fluid reasoning items", () => {
  it("every matrix template at every level gives six distinct options with exactly one right cell", () => {
    const templates = new Set<string>();
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const item = matrixItem(`${seed}-${level}`, level);
        expect(item.cells).toHaveLength(9);
        expect(item.cells[8].k).toBe("blank");
        expect(item.options).toHaveLength(MATRIX_OPTIONS);
        expectOneRight(item.options, item.answer, item.rule);
        templates.add(item.rule.split(";")[0]);
        // The right option is never one of the eight shown cells' exact copy in the missing slot's row... but it must differ from every distractor.
        const right = cellKey(item.options[item.answer]);
        expect(item.options.filter((o) => cellKey(o) === right)).toHaveLength(1);
      }
    }
    expect(templates.size).toBeGreaterThanOrEqual(9);
  });

  it("number sequences have one right next term among six distinct options", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const item = numberItem(`${seed}-${level}`, level);
        expect(item.options).toHaveLength(MATRIX_OPTIONS);
        expect(new Set(item.options).size).toBe(MATRIX_OPTIONS);
        expect(item.terms.length).toBeGreaterThanOrEqual(4);
        expect(item.options[item.answer]).toBeGreaterThan(0);
      }
    }
    // A fixed seed is a fixed item.
    expect(numberItem("x", 1)).toEqual(numberItem("x", 1));
    expect(numberItem("x", 1).terms).not.toEqual(numberItem("y", 1).terms);
  });

  it("ships twelve hand-written anchors, well-formed and spread over the levels", () => {
    expect(ANCHORS).toHaveLength(12);
    expect(new Set(ANCHORS.map((a) => a.level)).size).toBe(5);
    for (const a of ANCHORS) {
      if (a.kind === "matrix") {
        expect(a.cells).toHaveLength(9);
        expectOneRight(a.options, a.answer, a.id);
      } else {
        expect(new Set(a.options).size).toBe(a.options.length);
        expect(a.answer).toBeGreaterThanOrEqual(0);
      }
    }
    // Anchor a1: Gyarados ×3 completes the count row.
    const a1 = ANCHORS[0] as MatrixItem;
    expect(cellKey(a1.options[a1.answer])).toBe("mon:130:0:1:3:0");
  });

  it("places each anchor at most once per run and fills the rest with generated items", () => {
    const used = new Set<string>();
    const ids: string[] = [];
    let level = START_LEVEL;
    for (let i = 0; i < PLAN.fluid.items; i++) {
      const item = sectionItem("fluid", "run-1", i, level, used);
      ids.push(item.id);
      level = stepLevel(level, i % 2 === 0);
    }
    const anchors = ids.filter((id) => id.startsWith("anchor:"));
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors.length).toBeGreaterThan(0);
    expect(ids.length - anchors.length).toBeGreaterThan(0);
    // Another seed, same path: different generated items.
    const other = sectionItem("fluid", "run-2", 1, 3);
    const same = sectionItem("fluid", "run-1", 1, 3);
    expect(other.id).not.toBe(same.id);
  });
});

describe("working memory items", () => {
  it("spans grow 3 → 9 and grade an exact (or reversed) tap order", () => {
    expect(SPAN_LENGTH.forward[1]).toBe(3);
    expect(SPAN_LENGTH.forward[5]).toBe(9);
    for (const level of LEVELS) {
      for (const reverse of [false, true]) {
        const item = spanItem(`s-${level}-${reverse}`, level, reverse);
        expect(item.sequence).toHaveLength(SPAN_LENGTH[reverse ? "reverse" : "forward"][level]);
        expect(new Set(item.grid).size).toBe(item.grid.length);
        expect(item.target.map((i) => item.grid[i])).toEqual(reverse ? [...item.sequence].reverse() : item.sequence);
        expect(spanCorrect(item, item.target)).toBe(true);
        expect(spanCorrect(item, [...item.target].reverse())).toBe(item.sequence.length === 1);
        expect(spanCorrect(item, item.target.slice(0, -1))).toBe(false);
      }
    }
  });

  it("HP sums have one right answer among five distinct options", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const item = arithItem(`${seed}-${level}`, level);
        expect(item.options).toHaveLength(ARITH_OPTIONS);
        expect(new Set(item.options).size).toBe(ARITH_OPTIONS);
        expect(item.options[item.answer]).toBeGreaterThan(0);
        expect(item.prompt).toMatch(/HP/);
      }
    }
  });
});

describe("processing speed rows", () => {
  it("rows have six glyphs with one to three matches, and the raw score penalises false taps", () => {
    for (let i = 0; i < 60; i++) {
      const row = speedRow("sp", i);
      expect(row.row).toHaveLength(SPEED_ROW);
      expect(row.matches.length).toBeGreaterThanOrEqual(1);
      expect(row.matches.length).toBeLessThanOrEqual(3);
      expect(row.row.filter((g) => sameGlyph(g, row.target))).toHaveLength(row.matches.length);
      expect(row.target.k).toBe(i % 2 === 0 ? "type" : "mon");
    }
    expect(speedRaw(40, 3)).toBe(37);
    expect(speedRaw(2, 5)).toBe(0);
  });
});

describe("spatial items", () => {
  it("rotation: exactly one option is unmirrored", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const item = rotationItem(`${seed}-${level}`, level);
        expect(item.options.filter((o) => !o.flip)).toHaveLength(1);
        expect(item.options[item.answer].flip).toBe(false);
        expect(new Set(item.options.map((o) => `${o.rot}:${o.flip}`)).size).toBe(item.options.length);
      }
    }
  });

  it("route maps are solvable and the answer is the BFS shortest path", () => {
    expect(shortestPath(3, [false, false, false, false, true, false, false, false, false], 0, 8)).toBe(4);
    expect(shortestPath(2, [false, true, true, false], 0, 3)).toBe(-1);
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const item = pathItem(`${seed}-${level}`, level);
        expect(item.walls).toHaveLength(item.size * item.size);
        expect(item.options).toHaveLength(SPATIAL_OPTIONS);
        expect(new Set(item.options).size).toBe(SPATIAL_OPTIONS);
        expect(item.options[item.answer]).toBe(shortestPath(item.size, item.walls, item.start, item.goal));
        expect(item.options.every((o) => o >= 1)).toBe(true);
      }
    }
  });

  it("piles: the answer counts every ball in every layer", () => {
    expect(pileCount([[3, 3], [2, 2], [1, 1]])).toBe(14);
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const item = pileItem(`${seed}-${level}`, level);
        expect(item.options[item.answer]).toBe(pileCount(item.layers));
        expect(new Set(item.options).size).toBe(SPATIAL_OPTIONS);
      }
    }
  });
});

describe("adaptive stepping", () => {
  it("steps one level per answer within 1–5 and scores the levels of right answers", () => {
    expect(stepLevel(2, true)).toBe(3);
    expect(stepLevel(2, false)).toBe(1);
    expect(stepLevel(1, false)).toBe(1);
    expect(stepLevel(5, true)).toBe(5);
    expect(rawScore([{ level: 2, correct: true }, { level: 3, correct: false }, { level: 2, correct: true }, { level: 3, correct: true }])).toBe(7);
    expect(maxRaw(12)).toBe(2 + 3 + 4 + 5 * 9);
    expect(MAX_RAW.fluid).toBe(54);
  });
});

describe("scoring", () => {
  const table = { cdf: [0.1, 0.3, 0.6, 0.9, 1] };

  it("takes the mid-rank percentile of a raw score", () => {
    expect(percentileOf(table, 0)).toBeCloseTo(5);
    expect(percentileOf(table, 1)).toBeCloseTo(20);
    expect(percentileOf(table, 2)).toBeCloseTo(45);
    expect(percentileOf(table, 4)).toBeCloseTo(95);
    expect(percentileOf(table, 99)).toBeCloseTo(95);
    expect(percentileOf({ cdf: [1] }, 0)).toBe(50);
  });

  it("maps percentiles to the mean-100 / SD-15 scale", () => {
    expect(probit(0.5)).toBeCloseTo(0, 6);
    expect(probit(0.975)).toBeCloseTo(1.95996, 4);
    expect(phi(1.95996)).toBeCloseTo(0.975, 4);
    expect(scaledOf(50)).toBe(100);
    expect(scaledOf(84.134)).toBe(115);
    expect(scaledOf(2.275)).toBe(70);
    expect(scaledOf(0.0001)).toBe(61); // floored at the 0.5th percentile
    expect(scaledOf(100)).toBe(139);
    expect(scaledOf(99.9)).toBe(139);
    expect(knowledgePercentile(100)).toBeCloseTo(50, 3);
    expect(knowledgePercentile(115)).toBeCloseTo(84.13, 1);
  });

  it("builds the composite from the mean section z and the sample's quantiles", () => {
    expect(compositeRaw({ fluid: 50, memory: 50, speed: 50, spatial: 50 })).toBeCloseTo(0, 6);
    expect(compositeRaw({ fluid: 84.134, memory: 84.134, speed: 15.866, spatial: 15.866 })).toBeCloseTo(0, 4);
    const quantiles = Array.from({ length: 201 }, (_, i) => -2 + (4 * i) / 200); // -2 … 2, linear
    expect(compositePercentile(quantiles, 0)).toBeCloseTo(50, 6);
    expect(compositePercentile(quantiles, 1)).toBeCloseTo(75, 6);
    expect(compositePercentile(quantiles, -5)).toBe(0.5);
    expect(compositePercentile(quantiles, 5)).toBe(99.5);
    const norms: Norms = { v: 1, seed: "t", n: 1, method: "", sections: { fluid: table, memory: table, speed: table, spatial: table }, composite: { quantiles } };
    const s = scoreTest({ fluid: 2, memory: 2, speed: 2, spatial: 2 }, norms);
    expect(s.sections.fluid).toEqual({ raw: 2, percentile: 45, scaled: 98 });
    // mean z = probit(0.45) ≈ −0.126, read off the linear −2…2 quantiles: 46.9th percentile.
    expect(s.composite.percentile).toBeCloseTo(46.86, 1);
    expect(s.composite.score).toBe(99);
    expect(ordinal(88)).toBe("88th");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(103)).toBe("103rd");
  });

  it("the shipped norms are monotonic, cover every raw score and put an average run near 100", () => {
    expect(NORMS.n).toBeGreaterThanOrEqual(10_000);
    expect(NORMS.method.length).toBeGreaterThan(50);
    for (const k of COG_SECTIONS) {
      const { cdf } = NORMS.sections[k];
      expect(cdf).toHaveLength(MAX_RAW[k] + 1);
      for (let i = 1; i < cdf.length; i++) expect(cdf[i]).toBeGreaterThanOrEqual(cdf[i - 1]);
      expect(cdf[cdf.length - 1]).toBe(1);
      expect(cdf[0]).toBeLessThan(0.2);
    }
    const q = NORMS.composite.quantiles;
    expect(q).toHaveLength(201);
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeGreaterThanOrEqual(q[i - 1]);
    const median = (k: (typeof COG_SECTIONS)[number]) => NORMS.sections[k].cdf.findIndex((c) => c >= 0.5);
    const avg = scoreTest({ fluid: median("fluid"), memory: median("memory"), speed: median("speed"), spatial: median("spatial") }, NORMS);
    expect(avg.composite.score).toBeGreaterThanOrEqual(95);
    expect(avg.composite.score).toBeLessThanOrEqual(105);
    const top = scoreTest({ fluid: 54, memory: 54, speed: 90, spatial: 54 }, NORMS);
    expect(top.composite.score).toBeGreaterThanOrEqual(135);
    const bottom = scoreTest({ fluid: 0, memory: 0, speed: 0, spatial: 0 }, NORMS);
    expect(bottom.composite.score).toBeLessThanOrEqual(65);
  });

  it("the simulation is deterministic for a seed and reproduces the shipped tables", () => {
    const a = simulateNorms("fixed", 300);
    const b = simulateNorms("fixed", 300);
    expect(a).toEqual(b);
    expect(simulateNorms("other", 300)).not.toEqual(a);
    for (const k of COG_SECTIONS) for (let i = 1; i < a.sections[k].cdf.length; i++) expect(a.sections[k].cdf[i]).toBeGreaterThanOrEqual(a.sections[k].cdf[i - 1]);
    const shipped = simulateNorms(NORMS.seed, NORMS.n);
    expect(shipped.sections).toEqual(NORMS.sections);
    expect(shipped.composite).toEqual(NORMS.composite);
  });
});

describe("the result and its profile", () => {
  const norms = NORMS;
  it("names strengths and weaknesses from sections clearly off the composite", () => {
    const scores = scoreTest({ fluid: 45, memory: 10, speed: 36, spatial: 17 }, norms);
    const r = cognitiveRecord(scores, 112, 1000);
    expect(r.knowledge).toBe(112);
    const bars = profileBars(r);
    expect(bars.map((b) => b.domain)).toEqual(["fluid", "memory", "speed", "spatial", "knowledge"]);
    const words = profileWords(r);
    expect(words.strengths.join()).toMatch(/pattern/);
    expect(words.weaknesses.join()).toMatch(/in mind/);
    expect(profileBars(cognitiveRecord(scores, null, 1))).toHaveLength(4);
  });
});

describe("progress sync", () => {
  const base = (): Progress => ({ v: 1, name: "", xp: 0, rating: null, runs: 0, answered: 0, correct: 0, bestStreak: 0, best: {}, modulesPlayed: [], daily: { last: null, streak: 0, best: 0, results: {} }, dle: { last: null, streak: 0, best: 0, results: {} }, badges: {}, skills: {} });
  const rec = (at: number, score: number) => ({ v: 1 as const, at, score, percentile: 70, sections: { fluid: { raw: 20, percentile: 60, scaled: 104 }, memory: { raw: 18, percentile: 55, scaled: 102 }, speed: { raw: 40, percentile: 58, scaled: 103 }, spatial: { raw: 22, percentile: 65, scaled: 106 } }, knowledge: 110 });

  it("keeps a well-formed cognitive record through normalize and drops a broken one", () => {
    const p = { ...base(), cognitive: rec(5, 108) };
    expect(normalizeProgress(JSON.parse(JSON.stringify(p)))?.cognitive).toEqual(rec(5, 108));
    expect(normalizeProgress({ ...base(), cognitive: { v: 1, at: 5, score: 108 } })?.cognitive).toBeUndefined();
    expect(normalizeProgress({ ...base(), cognitive: "nope" })?.cognitive).toBeUndefined();
    expect(normalizeProgress(base())).not.toBeNull();
  });

  it("merges to the most recent test, whichever side has it", () => {
    expect(mergeProgress({ ...base(), cognitive: rec(10, 101) }, { ...base(), cognitive: rec(20, 120) }).cognitive?.score).toBe(120);
    expect(mergeProgress({ ...base(), cognitive: rec(30, 99) }, { ...base(), cognitive: rec(20, 120) }).cognitive?.score).toBe(99);
    expect(mergeProgress(base(), { ...base(), cognitive: rec(20, 120) }).cognitive?.score).toBe(120);
    expect(mergeProgress({ ...base(), cognitive: rec(20, 120) }, base()).cognitive?.score).toBe(120);
    expect(mergeProgress(base(), base()).cognitive).toBeUndefined();
  });
});

describe("sharing a cognitive result", () => {
  const r: CognitiveShareResult = { game: "cognitive", score: 118, percentile: 88, fluid: 125, memory: 104, speed: 120, spatial: 109, knowledge: 112 };
  it("round-trips through the payload and refuses nonsense", () => {
    expect(encodeShare(r)).toBe("cog.s118.p88.f125.m104.e120.a109.k112");
    expect(decodeShare(encodeShare(r))).toEqual(r);
    const bare: CognitiveShareResult = { ...r };
    delete bare.knowledge;
    expect(decodeShare(encodeShare(bare))).toEqual(bare);
    expect(decodeShare("cog.s118.p88.f125.m104.e120")).toBeNull();
    expect(decodeShare("cog.s500.p88.f125.m104.e120.a109")).toBeNull();
  });
  it("describes it for the landing page and the share text", () => {
    const v = describeShare(r);
    expect(v.headline).toBe("Cognitive PokéIQ 118");
    expect(v.detail).toBe("88th percentile of trainers");
    expect(v.chips).toEqual(["Reasoning 125", "Memory 104", "Speed 120", "Spatial 109", "Knowledge 112"]);
    expect(v.playHref).toBe("/iq-test");
    expect(cognitiveShareText(r, "https://x/s/y")).toBe("PokéIQ Cognitive test 118 (88th percentile)\n🧩 Reasoning 125 · 🧠 Memory 104\n⚡ Speed 120 · 🧭 Spatial 109 · 📖 Knowledge 112\nhttps://x/s/y");
  });
});

describe("the anonymous result store", () => {
  it("accepts only whole raw scores in range and logs them without anything else", async () => {
    expect(cognitiveRowOf({ fluid: 20, memory: 18, speed: 40, spatial: 22, composite: 108 })).toEqual({ fluid: 20, memory: 18, speed: 40, spatial: 22, composite: 108, version: 1 });
    expect(cognitiveRowOf({ fluid: 20.5, memory: 18, speed: 40, spatial: 22, composite: 108 })).toBeNull();
    expect(cognitiveRowOf({ fluid: 99, memory: 18, speed: 40, spatial: 22, composite: 108 })).toBeNull();
    expect(cognitiveRowOf({ fluid: 20, memory: 18, speed: 40, spatial: 22, composite: 300 })).toBeNull();
    expect(cognitiveRowOf(null)).toBeNull();
    const store = memoryCognitiveStore();
    const before = await store.count();
    expect(await logCognitiveResult({ fluid: 1, memory: 2, speed: 3, spatial: 4, composite: 90, version: 1 }, store)).toBe(true);
    expect(await store.count()).toBe(before + 1);
    expect(await logCognitiveResult({ fluid: 1, memory: 2, speed: 3, spatial: 4, composite: 90, version: 1 }, null)).toBe(false);
  });
});
