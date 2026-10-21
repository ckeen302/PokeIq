import { describe, expect, it } from "vitest";
import { buildQuestion, type Difficulty } from "@/engines";
import { Rng } from "@/lib/rng";
import { ROMAN, type TriviaItem } from "@/engines/trivia/bank";
import { GAMES_BANK, GAMES_TABLES, RELEASE_ORDER_SETS } from "@/engines/trivia/games";
import { ANIME_BANK, ANIME_SERIES, ANIME_TABLES } from "@/engines/trivia/anime";
import GYMS from "@/data/quiz/games/gyms.json";
import ELITE_FOUR from "@/data/quiz/games/elite-four.json";
import GAMES from "@/data/quiz/games/games.json";
import { gradeAnswer, questionAt, readSession, startSession } from "@/lib/server/session";
import { answerQuiz, createQuizDuel, duelQuestion, quizView } from "@/lib/server/quiz-duel";
import { joinDuel, readyDuel } from "@/lib/server/duels";
import { PVP_LEAD_MS } from "@/lib/pvp-types";
import { filterFor } from "@/lib/modes";
import type { SessionSpec } from "@/lib/session-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const BANKS = { games: GAMES_BANK, anime: ANIME_BANK } as const;
const TABLES: Record<string, readonly object[]> = { ...GAMES_TABLES, ...ANIME_TABLES };

/** The value a generated question's answer must equal, read straight from its table row. */
function tableValue(item: TriviaItem): string {
  const { table, index, field } = item.from!;
  const row = TABLES[table][index] as Record<string, unknown>;
  const [key, k] = field.split(".");
  const value = k === undefined ? row[key] : (row[key] as string[])[Number(k)];
  if (field === "gen") return `Generation ${ROMAN[value as number]}`;
  return String(value);
}

describe.each(Object.entries(BANKS))("%s bank integrity", (module, bank) => {
  it("has a sensible size", () => {
    expect(bank.length).toBeGreaterThanOrEqual(module === "games" ? 250 : 150);
  });

  it("has unique ids", () => {
    expect(new Set(bank.map((q) => q.id)).size).toBe(bank.length);
  });

  it.each(bank.map((q) => [q.id, q] as const))("%s is well-formed", (_, q) => {
    expect(["easy", "medium", "hard"]).toContain(q.difficulty);
    expect(q.source).toMatch(/^https:\/\/bulbapedia\.bulbagarden\.net\/wiki\/\S+$/);
    expect(q.prompt.length).toBeGreaterThan(10);
    expect(q.answer.trim()).toBe(q.answer);
    // At least three wrong answers, all distinct, none equal to the answer.
    expect(q.distractors.length).toBeGreaterThanOrEqual(3);
    const lower = q.distractors.map((d) => d.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(lower).not.toContain(q.answer.toLowerCase());
    expect(q.group).toBeGreaterThanOrEqual(1);
    expect(q.group).toBeLessThanOrEqual(filterFor(module as "games" | "anime").chips.length);
  });

  it("generated answers match their data tables", () => {
    const generated = bank.filter((q) => q.from);
    expect(generated.length).toBeGreaterThan(module === "games" ? 150 : 10);
    for (const q of generated) expect(q.answer, q.id).toBe(tableValue(q));
  });

  it("builds questions with exactly one correct answer among 4 distinct options", () => {
    for (const difficulty of ["easy", "medium", "hard"] as Difficulty[]) {
      const rng = new Rng(`integrity-${module}-${difficulty}`);
      const used = new Set<number>();
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const q = buildQuestion(module as "games", rng, { difficulty, used });
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.options.filter((o) => o === q.answer)).toHaveLength(1);
        expect(q.source).toMatch(/^https:\/\/bulbapedia/);
        // No repeats within a run.
        expect(seen.has(q.itemKey)).toBe(false);
        seen.add(q.itemKey);
      }
    }
  });

  it("honours the generation / series filter", () => {
    const used = new Set<number>();
    const rng = new Rng(`filter-${module}`);
    const ids = new Set(bank.filter((q) => q.group === 2).map((q) => `${module}:${q.id}`));
    for (let i = 0; i < 15; i++) {
      const q = buildQuestion(module as "games", rng, { difficulty: "medium", gens: [2], used });
      expect(ids.has(q.itemKey)).toBe(true);
    }
  });

  it("mixes difficulties within a session", () => {
    const used = new Set<number>();
    const rng = new Rng(`mix-${module}`);
    const ratings = new Set([...Array(30)].map(() => buildQuestion(module as "games", rng, { difficulty: "medium", used }).rating));
    expect(ratings.size).toBe(3);
  });
});

describe("games: distractors are never also right", () => {
  const byId = new Map(GAMES_BANK.map((q) => [q.id, q]));

  it("never offers another version's leader of the same Gym", () => {
    for (const q of GAMES_BANK.filter((x) => x.from?.table === "gyms" && x.from.field === "leader")) {
      const row = GYMS[q.from!.index];
      const sameGym = GYMS.filter((o) => o.family === row.family && o.place === row.place).map((o) => o.leader);
      for (const d of q.distractors) expect(sameGym, q.id).not.toContain(d);
    }
    const stow = byId.get("gym-pokemon-sword-stow-on-side-leader") ?? GAMES_BANK.find((q) => q.answer === "Bea");
    expect(stow?.distractors ?? []).not.toContain("Allister");
  });

  it("never offers a type the same trainer is known for elsewhere", () => {
    for (const q of GAMES_BANK.filter((x) => x.from?.field === "type" && (x.from.table === "gyms" || x.from.table === "elite-four"))) {
      const person = q.from!.table === "gyms" ? GYMS[q.from!.index].leader : ELITE_FOUR[q.from!.index].member;
      const known = [...GYMS.filter((g) => g.leader === person), ...ELITE_FOUR.filter((e) => e.member === person).map((e) => ({ type: e.type }))]
        .map((r) => (r as { type?: string }).type)
        .filter(Boolean);
      for (const d of q.distractors) expect(known, q.id).not.toContain(d);
    }
  });

  it("never offers a type that didn't exist yet", () => {
    for (const q of GAMES_BANK.filter((x) => x.from?.field === "type" && x.group === 1)) {
      for (const t of ["Dark", "Steel", "Fairy"]) expect(q.distractors, q.id).not.toContain(t);
    }
  });

  it("never offers a region the game also visits", () => {
    for (const q of GAMES_BANK.filter((x) => x.id.startsWith("region-of-"))) {
      const row = GAMES[q.from!.index] as { alsoRegions?: string[] };
      for (const d of q.distractors) expect(row.alsoRegions ?? [], q.id).not.toContain(d);
      if (q.answer === "Sinnoh") expect(q.distractors, q.id).not.toContain("Hisui");
    }
  });

  it("release-order answers are strictly the oldest generation in their set", () => {
    for (const set of RELEASE_ORDER_SETS) {
      const gens = set.map((t) => GAMES.find((g) => g.title === t)!.gen);
      const min = Math.min(...gens);
      expect(gens.filter((g) => g === min)).toHaveLength(1);
    }
  });

  it("keeps box-art fusions apart from their parts", () => {
    const sun = GAMES_BANK.find((q) => q.id === "box-pokemon-sun")!;
    expect(sun.distractors).not.toContain("Dusk Mane Necrozma");
    expect(sun.distractors).not.toContain("Dawn Wings Necrozma");
  });
});

describe("anime filter", () => {
  it("has one chip per series", () => {
    expect(filterFor("anime").chips).toHaveLength(ANIME_SERIES.length);
  });
});

describe("trivia sessions never leak the answer early", () => {
  for (const mode of ["games", "anime"] as const) {
    it(`${mode}: question payloads carry no answer, explanation or source until graded`, () => {
      const spec: SessionSpec = { module: mode, format: "classic", difficulty: "medium", seed: `leak-${mode}` };
      const start = startSession(spec);
      const payload = JSON.stringify(start.question);
      expect(payload).not.toMatch(/"answer"|"explanation"|"source"|bulbapedia/i);
      const q = questionAt(spec, 0);
      expect(start.question.options).toEqual(q.options);

      let state = readSession(start.token)!;
      const graded = gradeAnswer(state, q.answer);
      expect(graded.ok).toBe(true);
      if (!graded.ok) return;
      expect(graded.response.correct).toBe(true);
      expect(graded.response.answer).toBe(q.answer);
      expect(graded.response.sourceUrl).toMatch(/^https:\/\/bulbapedia/);
      state = readSession(graded.response.token)!;
      expect(state.log).toHaveLength(1);
    });

    it(`${mode}: a quiz duel shows the question but no answer before the reveal`, () => {
      const T0 = 1_800_000_000_000;
      const { duel, playerId: red } = createQuizDuel(mode, "medium", "Red", "abcdefgh", T0, `duel-${mode}`);
      const joined = joinDuel(duel, "Blue", T0 + 1000);
      if (!joined.ok) throw new Error(joined.error);
      let d = joined.duel;
      for (const id of [red, joined.playerId]) {
        const r = readyDuel(d, id, true, T0 + 2000);
        if (!r.ok) throw new Error(r.error);
        d = r.duel;
      }
      const start = T0 + 2000 + PVP_LEAD_MS;
      const view = quizView(d, red, start + 1000, 0);
      expect(view.question?.question?.prompt).toBe(duelQuestion(d, 0).prompt);
      expect(JSON.stringify(view)).not.toMatch(/bulbapedia|"answer"/i);
      const answered = answerQuiz(d, red, 0, duelQuestion(d, 0).answer, start + 2000);
      expect(answered.ok).toBe(true);
    });
  }
});
