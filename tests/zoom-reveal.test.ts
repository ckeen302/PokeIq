import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import crops from "@/data/zoom-reveal-crops.json";
import { buildQuestion } from "@/engines";
import { Rng } from "@/lib/rng";
import { POKEDEX, getPokemon } from "@/lib/pokemon/pokedex";
import { CROP_TIERS, pickCrops } from "@/lib/zoom-reveal-crop";
import { ZOOM_POINTS, ZOOM_SKIP, ZOOM_STEPS, innerRect, stepWindow, zoomPoints, zoomShareLine } from "@/lib/zoom-reveal";
import { gradeAnswer, questionAt, readSession, startSession } from "@/lib/server/session";
import { guessedSpecies, zoomStart } from "@/lib/server/zoom-reveal";
import { createQuizDuel, duelQuestion, quizView, zoomQuiz } from "@/lib/server/quiz-duel";
import { joinDuel, readyDuel } from "@/lib/server/duels";
import { PVP_LEAD_MS } from "@/lib/pvp-types";
import type { AnswerResponse, SessionSpec } from "@/lib/session-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const CROPS = (crops as { crops: Record<string, number[][]> }).crops;
const LOOSEST_KEPT = CROP_TIERS[CROP_TIERS.length - 2];

// ---------------------------------------------------------------------------
// Synthetic artwork: transparent canvas, a big flat body, one small detailed eye.
// ---------------------------------------------------------------------------

function canvas(size: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px.set(paint(x, y), (y * size + x) * 4);
  return px;
}

const SIZE = 160;
const EYE = { x: 100, y: 52, r: 12 };
const body = (x: number, y: number) => (x - 80) ** 2 + (y - 85) ** 2 < 62 ** 2;
const art = canvas(SIZE, (x, y) => {
  if (!body(x, y)) return [0, 0, 0, 0];
  const d = Math.hypot(x - EYE.x, y - EYE.y);
  if (d < EYE.r) {
    // White, iris, pupil and a highlight, with a dark outline: the kind of detail an eye has.
    if (d > EYE.r - 2) return [20, 20, 30, 255];
    if (d < 3) return [10, 10, 10, 255];
    if ((x + y) % 7 === 0) return [255, 255, 255, 255];
    return d < 7 ? [200, 40, 60, 255] : [245, 245, 245, 255];
  }
  return [120, 200, 140, 255]; // flat green body
});

describe("start crop selection", () => {
  it("lands on the detailed region, inside the Pokémon, never on flat body or background", () => {
    const found = pickCrops(art, SIZE);
    expect(found.length).toBeGreaterThan(0);
    const best = found[0];
    const cx = (best.x + best.s / 2) * SIZE;
    const cy = (best.y + best.s / 2) * SIZE;
    expect(Math.hypot(cx - EYE.x, cy - EYE.y)).toBeLessThan(EYE.r + best.s * SIZE * 0.5);
    for (const c of found) {
      expect(c.opaque).toBeGreaterThanOrEqual(CROP_TIERS[CROP_TIERS.length - 1].opaque);
      expect(c.colours).toBeGreaterThanOrEqual(2);
      expect(c.edges).toBeGreaterThan(0);
    }
  });

  it("finds nothing in a blank or a single-colour image", () => {
    expect(pickCrops(canvas(64, () => [0, 0, 0, 0]), 64)).toEqual([]);
    expect(pickCrops(canvas(64, () => [90, 90, 200, 255]), 64)).toEqual([]);
    // A flat shape on a transparent background has no inner detail either.
    expect(pickCrops(canvas(64, (x, y) => ((x - 32) ** 2 + (y - 32) ** 2 < 25 ** 2 ? [250, 200, 40, 255] : [0, 0, 0, 0])), 64)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(pickCrops(art, SIZE)).toEqual(pickCrops(art, SIZE));
  });

  it("has precomputed crops for all 1,025 Pokémon, none of them mostly blank or flat", () => {
    expect(Object.keys(CROPS)).toHaveLength(POKEDEX.length);
    for (const p of POKEDEX) {
      const list = CROPS[p.id];
      expect(list?.length, `#${p.id}`).toBeGreaterThan(0);
      for (const [x, y, s, opaque, colours, edges] of list) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + s).toBeLessThanOrEqual(1.0001);
        expect(y + s).toBeLessThanOrEqual(1.0001);
        // An extreme close-up: a small part of the artwork.
        expect(s).toBeLessThan(0.25);
        expect(opaque, `#${p.id} opaque`).toBeGreaterThanOrEqual(LOOSEST_KEPT.opaque);
        expect(colours, `#${p.id} colours`).toBeGreaterThanOrEqual(LOOSEST_KEPT.colours);
        expect(edges, `#${p.id} edges`).toBeGreaterThanOrEqual(LOOSEST_KEPT.edges);
      }
    }
  });
});

describe("zoom steps", () => {
  it("start on the crop, nest step after step, and end on the whole artwork", () => {
    for (const id of [1, 25, 150, 445, 1025]) {
      const start = zoomStart(id, 0);
      expect(stepWindow(start, 1)).toEqual(start);
      expect(stepWindow(start, ZOOM_STEPS)).toEqual({ x: 0, y: 0, s: 1 });
      for (let k = 2; k <= ZOOM_STEPS; k++) {
        const a = stepWindow(start, k - 1);
        const b = stepWindow(start, k);
        expect(b.x).toBeLessThanOrEqual(a.x + 1e-9);
        expect(b.y).toBeLessThanOrEqual(a.y + 1e-9);
        expect(b.x + b.s).toBeGreaterThanOrEqual(a.x + a.s - 1e-9);
        expect(b.y + b.s).toBeGreaterThanOrEqual(a.y + a.s - 1e-9);
        const from = innerRect(a, b);
        expect(from.s).toBeGreaterThan(0);
        expect(from.s).toBeLessThan(1);
      }
    }
  });
});

describe("scoring and share line", () => {
  it("pays more for fewer steps", () => {
    for (let s = 2; s <= ZOOM_STEPS; s++) expect(zoomPoints(s)).toBeLessThan(zoomPoints(s - 1));
    expect(ZOOM_POINTS).toHaveLength(ZOOM_STEPS);
  });

  it("writes Wordle-style lines", () => {
    expect(zoomShareLine(3, true)).toBe("🔍🔍✅ 3/6");
    expect(zoomShareLine(1, true)).toBe("✅ 1/6");
    expect(zoomShareLine(6, false)).toBe("🔍🔍🔍🔍🔍❌ X/6");
  });
});

describe("Zoom Reveal questions", () => {
  it("are seeded: the same seed gives the same Pokémon and crop", () => {
    const run = (seed: string) => {
      const rng = new Rng(seed);
      const used = new Set<number>();
      return Array.from({ length: 10 }, () => buildQuestion("zoom-reveal", rng, { difficulty: "medium", used }).media);
    };
    expect(run("same")).toEqual(run("same"));
    expect(run("same")).not.toEqual(run("other"));
  });

  it("the daily is the same for everyone on a date, and different the next day", () => {
    const daily = (date: string): SessionSpec => ({ module: "zoom-reveal", format: "classic", difficulty: "medium", seed: `zoom-daily:${date}`, zoomDaily: date, practice: "zoom-daily" });
    expect(questionAt(daily("2026-11-01"), 0).media).toEqual(questionAt({ ...daily("2026-11-01") }, 0).media);
    expect(questionAt(daily("2026-11-01"), 0).media).not.toEqual(questionAt(daily("2026-11-02"), 0).media);
    const start = startSession(daily("2026-11-01"));
    expect(start.rules).toEqual({ total: 1, lives: null, questionMs: null, runMs: null });
  });

  it("respect the generation filter", () => {
    const rng = new Rng("zoom-gen");
    for (let i = 0; i < 30; i++) {
      const q = buildQuestion("zoom-reveal", rng, { difficulty: "hard", gens: [4], used: new Set() });
      expect(getPokemon(q.media!.pokemonId)!.gen).toBe(4);
    }
  });

  it("accept the spellings and forms Name 'em All accepts", () => {
    expect(guessedSpecies("Mr. Mime")).toBe(122);
    expect(guessedSpecies("mr mime")).toBe(122);
    expect(guessedSpecies("Nidoran female")).toBe(29);
    expect(guessedSpecies("farfetched")).toBe(83);
    expect(guessedSpecies("Flabebe")).toBe(669);
    expect(guessedSpecies("Alolan Vulpix")).toBe(37);
    expect(guessedSpecies("Mega Charizard X")).toBe(6);
    expect(guessedSpecies("not a pokemon")).toBeUndefined();
  });
});

describe("grading by steps", () => {
  const spec: SessionSpec = { module: "zoom-reveal", format: "classic", difficulty: "medium", seed: "zoom-grade" };
  const wrongName = (answer: string) => (answer === "Pikachu" ? "Eevee" : "Pikachu");

  function play(misses: number, finish: "right" | "skip") {
    const start = startSession(spec);
    const q = questionAt(spec, 0);
    let token = start.token;
    const steps: AnswerResponse[] = [];
    for (let i = 0; i < misses; i++) {
      const out = gradeAnswer(readSession(token)!, i % 2 ? ZOOM_SKIP : wrongName(q.answer));
      if (!out.ok) throw new Error(out.error);
      steps.push(out.response);
      token = out.response.token;
    }
    const last = gradeAnswer(readSession(token)!, finish === "right" ? q.answer.toUpperCase() : ZOOM_SKIP);
    if (!last.ok) throw new Error(last.error);
    return { q, steps, last: last.response };
  }

  it("zooms out on each miss without giving anything away, then scores by the step it was named on", () => {
    const { q, steps, last } = play(2, "right");
    steps.forEach((r, i) => {
      expect(r.zoom?.step).toBe(i + 2);
      expect(r.zoom?.from).toBeDefined();
      expect(r.answer).toBe("");
      expect(r.done).toBe(false);
      expect(r.revealUrl).toBeUndefined();
      expect(r.explanation).toBeUndefined();
      expect(r.learnHref).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain(q.answer);
    });
    expect(last.correct).toBe(true);
    expect(last.step).toBe(3);
    expect(last.gained).toBe(ZOOM_POINTS[2]);
    expect(last.answer).toBe(q.answer);
    expect(last.revealUrl).toMatch(/^\/api\/media\//);
  });

  it("a right name on step 1 earns the most", () => {
    const { last } = play(0, "right");
    expect(last.step).toBe(1);
    expect(last.gained).toBe(ZOOM_POINTS[0]);
  });

  it("missing all six steps ends the question with nothing", () => {
    const { steps, last } = play(ZOOM_STEPS - 1, "skip");
    expect(steps.map((r) => r.zoom?.step)).toEqual([2, 3, 4, 5, 6]);
    expect(last.correct).toBe(false);
    expect(last.step).toBe(ZOOM_STEPS);
    expect(last.gained).toBe(0);
    expect(last.zoom).toBeUndefined();
    expect(last.answered).toBe(1);
  });

  it("grades each step once (a replayed token is the same claim)", () => {
    const start = startSession(spec);
    const a = gradeAnswer(readSession(start.token)!, ZOOM_SKIP);
    const b = gradeAnswer(readSession(start.token)!, ZOOM_SKIP);
    if (!a.ok || !b.ok) throw new Error("grading failed");
    expect(a.claimKey).toBe(b.claimKey);
    const c = gradeAnswer(readSession(a.response.token)!, ZOOM_SKIP);
    if (!c.ok) throw new Error(c.error);
    expect(c.claimKey).not.toBe(a.claimKey);
  });
});

describe("no answer leaks", () => {
  it("the question the browser gets names nothing: no name, slug, id or artwork address", () => {
    for (const seed of ["leak-1", "leak-2", "leak-3", "leak-4", "leak-5"]) {
      const spec: SessionSpec = { module: "zoom-reveal", format: "classic", difficulty: "hard", seed };
      const start = startSession(spec);
      const q = questionAt(spec, 0);
      const p = getPokemon(q.media!.pokemonId)!;
      const payload = JSON.stringify(start.question);
      expect(start.question.options).toEqual([]);
      expect(start.question.media).toBeUndefined();
      expect(start.question.zoom?.url).toMatch(/^\/api\/media\/[A-Za-z0-9_-]+$/);
      expect(payload).not.toMatch(/"answer"|"explanation"|official-artwork|githubusercontent|pokemonId|"crop"/);
      expect(payload.toLowerCase()).not.toContain(p.name.toLowerCase());
      expect(payload.toLowerCase()).not.toContain(`/${p.slug}`);
      expect(payload).not.toMatch(new RegExp(`[/:"]${p.id}(\\.|"|/)`));
    }
  });

  it("a duel shows each trainer their own step, never the answer, until the reveal", () => {
    const T0 = 1_800_000_000_000;
    const { duel, playerId: red } = createQuizDuel("zoom-reveal", "medium", "Red", "abcdefgh", T0, "duel-zoom");
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    let d = joined.duel;
    for (const id of [red, joined.playerId]) {
      const r = readyDuel(d, id, true, T0 + 2000);
      if (!r.ok) throw new Error(r.error);
      d = r.duel;
    }
    const start = T0 + 2000 + PVP_LEAD_MS;
    const q = duelQuestion(d, 0);
    const before = quizView(d, red, start + 500, 0);
    expect(before.question?.question?.zoom?.step).toBe(1);
    expect(JSON.stringify(before)).not.toContain(q.answer);

    const missed = zoomQuiz(d, red, 0, q.answer === "Pikachu" ? "Eevee" : "Pikachu", start + 1000);
    if (!missed.ok) throw new Error(missed.error);
    d = missed.duel;
    const after = quizView(d, red, start + 1100, 0);
    expect(after.question?.question?.zoom?.step).toBe(2);
    expect(after.question?.steps).toEqual([2, 1]);
    expect(after.question?.yours).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain(q.answer);
    // Blue still sees step 1.
    expect(quizView(d, joined.playerId, start + 1100, 0).question?.question?.zoom?.step).toBe(1);

    const named = zoomQuiz(d, red, 0, q.answer, start + 2000);
    if (!named.ok) throw new Error(named.error);
    const given = zoomQuiz(named.duel, joined.playerId, 0, "", start + 2100);
    if (!given.ok) throw new Error(given.error);
    // Blue skipped once: still playing, on step 2.
    expect(quizView(given.duel, joined.playerId, start + 2200, 0).question?.question?.zoom?.step).toBe(2);
  });

  it("the crop table only ever loads on the server", () => {
    const root = path.resolve(import.meta.dirname, "../src");
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(file, "utf8").includes("zoom-reveal-crops")) importers.push(path.relative(root, file));
      }
    };
    walk(root);
    expect(importers).toEqual([path.join("lib", "server", "zoom-reveal.ts")]);
    expect(readFileSync(path.join(root, "lib/server/zoom-reveal.ts"), "utf8")).toContain('import "server-only"');
  });
});
