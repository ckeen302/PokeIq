import { beforeAll, describe, expect, it, vi } from "vitest";

// The quiz speaks a language only when it's live (LIVE_LOCALES is read when the i18n config loads).
vi.hoisted(() => {
  process.env.LIVE_LOCALES = "ja,es,fr,de,it";
  process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
});

import { Rng } from "@/lib/rng";
import { buildQuestion, DIFFICULTIES, loadQuizLang, localize, localizeQuestion, type ModuleId, type Question, type QuizLang } from "@/engines";
import { isServable } from "@/engines/validate";
import { gradeAnswer, questionAt, readSession, rightName, startSession } from "@/lib/server/session";
import { signToken } from "@/lib/server/crypto";
import { answerQuiz, createQuizDuel, duelQuestion, prepareDuelLang, quizView, type QuizDuel } from "@/lib/server/quiz-duel";
import { joinDuel, readyDuel } from "@/lib/server/duels";
import type { PvpOutcome } from "@/lib/server/duel-core";
import { PVP_LEAD_MS } from "@/lib/pvp-types";
import type { SessionSpec } from "@/lib/session-types";
import { getPokemon } from "@/lib/pokemon/pokedex";

const LOCALES = ["ja", "es", "fr", "de", "it"] as const;
const POKEDEX_MODULES: ModuleId[] = ["whos-that", "cry", "dex", "types", "higher-lower", "competitive", "shiny", "zoom-reveal", "whose-team"];
const langs: Record<string, QuizLang> = {};

beforeAll(async () => {
  for (const l of LOCALES) langs[l] = (await loadQuizLang(l))!;
});

/** Each module's English questions over many seeds, and how many have a wording in `l`. */
function coverage(module: ModuleId, l: string, seeds = 8, per = 10) {
  let worded = 0;
  let total = 0;
  for (const difficulty of DIFFICULTIES) {
    for (let s = 0; s < seeds; s++) {
      const rng = new Rng(`i18n:${module}:${difficulty}:${s}`);
      const used = new Set<number>();
      for (let i = 0; i < per; i++) {
        const q = buildQuestion(module, rng, { difficulty, used });
        const w = localize(q, langs[l]);
        total++;
        if (w && isServable(w)) {
          worded++;
          checkWording(q, w, l);
        }
      }
    }
  }
  return worded / total;
}

/** A wording is the same question: same item, media, answer position and rating; only the words change. */
function checkWording(q: Question, w: Question, l: string) {
  expect(w.itemKey).toBe(q.itemKey);
  expect(w.module).toBe(q.module);
  expect(w.media).toEqual(q.media);
  expect(w.revealMedia).toEqual(q.revealMedia);
  expect(w.rating).toBe(q.rating);
  expect(w.source).toBe(q.source);
  expect(w.options.length).toBe(q.options.length);
  if (q.input !== "name") expect(w.options.indexOf(w.answer)).toBe(q.options.indexOf(q.answer));
  if (q.optionImages) expect(w.options).toEqual(q.options);
  // The wording isn't the English text (prompts are always re-worded).
  expect(w.prompt).not.toBe(q.prompt);
  // No name token is left over.
  expect(`${w.prompt} ${w.detail ?? ""} ${w.explanation ?? ""} ${w.options.join(" ")}`).not.toMatch(/\[\[/);
  if (l === "ja") expect(w.prompt).toMatch(/[぀-ヿ一-鿿]/);
}

describe("questions in other languages", () => {
  it("words nearly every Pokédex question in every language", () => {
    const rates: Record<string, Record<string, number>> = {};
    for (const l of LOCALES) {
      for (const m of POKEDEX_MODULES) {
        const rate = coverage(m, l);
        (rates[l] ??= {})[m] = Math.round(rate * 100);
        // Dex Detective swaps Gen 9 entries (no Pokédex entries in the data) and the Ability/Move/Item quiz the few items without a description.
        expect(rate, `${l} ${m}`).toBeGreaterThanOrEqual(m === "dex" || m === "competitive" ? 0.85 : 0.97);
      }
    }
    console.log("worded %:", JSON.stringify(rates));
  });

  it("words most trivia questions (the rest are swapped)", () => {
    for (const l of LOCALES) {
      expect(coverage("games", l), `${l} games`).toBeGreaterThan(0.8);
      expect(coverage("anime", l), `${l} anime`).toBeGreaterThan(0.6);
    }
  });

  it("uses the language's official names", () => {
    const ja = langs.ja;
    const fr = langs.fr;
    expect(ja.pokemon(25)).toBe("ピカチュウ");
    expect(fr.pokemon(4)).toBe("Salamèche");
    expect(ja.type("fire")).toBe("ほのお");
    expect(fr.typing(["fire", "flying"])).toBe("Feu / Vol");
    expect(ja.game("Pokémon Red and Blue")).toBe("『ポケットモンスター 赤・緑』");
    expect(fr.game("Pokémon Gold, Silver and Crystal")).toBe("Pokémon Or, Argent et Cristal");
    expect(langs.de.proper("Brock")).toBe("Rocko");
    expect(ja.proper("Drake", "anime")).toBe("ユウジ");
    expect(ja.proper("Drake")).toBe("ゲンジ");
  });

  it("censors the language's own names in Pokédex entries", () => {
    for (const l of LOCALES) {
      let seen = 0;
      for (let s = 0; s < 60 && seen < 20; s++) {
        const rng = new Rng(`entries:${l}:${s}`);
        const q = buildQuestion("dex", rng, { difficulty: "hard", used: new Set() });
        if (!q.itemKey.startsWith("dex:entry:")) continue;
        const w = localize(q, langs[l]);
        if (!w) continue;
        seen++;
        const target = getPokemon(Number(q.itemKey.split(":")[2]))!;
        expect(w.detail).not.toContain(langs[l].pokemon(target)!);
        expect(w.detail).not.toContain(target.name);
      }
      expect(seen).toBeGreaterThan(5);
    }
  });
});

describe("runs in other languages", () => {
  const spec = (module: ModuleId, seed: string, locale?: SessionSpec["locale"], extra: Partial<SessionSpec> = {}): SessionSpec => ({
    module,
    format: "classic",
    difficulty: "medium",
    seed,
    ...extra,
    ...(locale && { locale }),
  });

  it("are the English run re-worded, with unwordable questions swapped for one of the same kind", () => {
    let swaps = 0;
    let total = 0;
    for (const mod of ["mixed", "dex", "games", "anime", "whose-team", "competitive"] as const) {
      for (let s = 0; s < 4; s++) {
        const seed = `run:${mod}:${s}`;
        const english = Array.from({ length: 10 }, (_, i) => questionAt(spec(mod, seed), i));
        for (const l of LOCALES) {
          const local = Array.from({ length: 10 }, (_, i) => questionAt(spec(mod, seed, l), i));
          local.forEach((q, i) => {
            total++;
            expect(isServable(q)).toBe(true);
            if (q.itemKey === english[i].itemKey) {
              expect(q.options.indexOf(q.answer)).toBe(english[i].options.indexOf(english[i].answer));
            } else {
              swaps++;
              expect(q.module).toBe(english[i].module);
              // A swapped-in question is never one the run already has.
              expect(english.map((e) => e.itemKey)).not.toContain(q.itemKey);
            }
          });
        }
      }
    }
    console.log(`swapped ${swaps} of ${total} questions (${((swaps / total) * 100).toFixed(1)}%)`);
    expect(swaps / total).toBeLessThan(0.3);
  });

  it("the Daily Challenge asks the same questions in every language (all but a few swaps)", () => {
    for (const date of ["2026-11-21", "2026-11-22", "2026-12-25", "2027-01-01"]) {
      const daily = (locale?: SessionSpec["locale"]) => spec("mixed", `daily:${date}`, locale, { daily: date });
      const english = Array.from({ length: 10 }, (_, i) => questionAt(daily(), i).itemKey);
      for (const l of LOCALES) {
        const local = Array.from({ length: 10 }, (_, i) => questionAt(daily(l), i).itemKey);
        const same = local.filter((k, i) => k === english[i]).length;
        expect(same, `${date} ${l}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("are deterministic: grading re-derives the same words", () => {
    for (const l of LOCALES) {
      const s = spec("games", `det:${l}`, l);
      const a = Array.from({ length: 10 }, (_, i) => JSON.stringify(questionAt(s, i)));
      // A fresh adaptive-free stream from the same seed (another module first, then back) gives the same questions.
      questionAt(spec("dex", `det:${l}`, l), 3);
      const b = Array.from({ length: 10 }, (_, i) => JSON.stringify(questionAt(s, i)));
      expect(b).toEqual(a);
    }
  });

  it("grade an answer given in the run's language", () => {
    const s = spec("whos-that", "grade-es", "es");
    const { token } = startSession(s);
    const state = readSession(token)!;
    expect(state.spec.locale).toBe("es");
    const q = questionAt(s, 0);
    const right = gradeAnswer({ ...state, startedAt: Date.now(), servedAt: Date.now() }, q.answer);
    expect(right.ok && right.response.correct).toBe(true);
    if (right.ok) expect(right.response.answer).toBe(q.answer);
  });

  it("Zoom Reveal takes the language's name, the English one and Japanese rōmaji", () => {
    for (const [l, typed] of [
      ["ja", (id: number) => langs.ja.pokemon(id)!],
      ["ja", (id: number) => getPokemon(id)!.name],
      ["fr", (id: number) => langs.fr.pokemon(id)!.toUpperCase()],
      ["de", (id: number) => getPokemon(id)!.name],
    ] as const) {
      const s = spec("zoom-reveal", `zoom-${l}`, l);
      const q = questionAt(s, 0);
      const state = readSession(startSession(s).token)!;
      const out = gradeAnswer({ ...state, startedAt: Date.now(), servedAt: Date.now() }, typed(q.media!.pokemonId));
      expect(out.ok && out.response.correct, `${l}`).toBe(true);
    }
    // Kana either way, rōmaji as typed (ピカチュウ → pikachuu) or official, and English.
    const pikachu = { media: { kind: "zoom-reveal", pokemonId: 25 }, answer: "ピカチュウ" } as Question;
    for (const typed of ["ピカチュウ", "ぴかちゅう", "pikachuu", "Pikachu"]) expect(rightName(pikachu, typed, "ja"), typed).toBe(true);
    expect(rightName(pikachu, "ライチュウ", "ja")).toBe(false);
    expect(rightName(pikachu, "Pikachu")).toBe(true);
    expect(rightName(pikachu, "pikachuu")).toBe(false);
  });

  it("Whose Team takes the trainer's name in the language or in English", () => {
    for (const l of ["ja", "de"] as const) {
      const s = spec("whose-team", `team-${l}`, l, { difficulty: "medium" });
      const q = questionAt(s, 0);
      expect(q.optionAliases?.length).toBe(q.options.length);
      const i = q.options.indexOf(q.answer);
      const english = q.optionAliases![i][0];
      const state = readSession(startSession(s).token)!;
      for (const typed of [q.answer, english]) {
        const out = gradeAnswer({ ...state, startedAt: Date.now(), servedAt: Date.now() }, typed);
        expect(out.ok && out.response.correct, `${l} ${typed}`).toBe(true);
      }
    }
  });

  it("only live languages are signed into a run", () => {
    const token = signToken("session", { v: 1, sid: "x", spec: { ...spec("dex", "x"), locale: "ko" }, startedAt: Date.now(), servedAt: Date.now(), log: [], score: 0, streak: 0, best: 0, lives: null });
    expect(readSession(token)).toBeNull();
  });

  it("English runs carry no language and no aliases", () => {
    const q = questionAt(spec("whose-team", "team-en"), 0);
    expect(q.optionAliases).toBeUndefined();
    expect(startSession(spec("dex", "x")).question).not.toHaveProperty("optionAliases");
  });
});

describe("duels across languages", () => {
  const T0 = 1_800_000_000_000;
  const must = (out: PvpOutcome<QuizDuel>): QuizDuel => {
    if (!out.ok) throw new Error(out.error);
    return out.duel;
  };

  it("each trainer reads their own language and both are scored on the same question", async () => {
    await prepareDuelLang("fr");
    const { duel, playerId: red } = createQuizDuel("whos-that", "medium", "Red", "abcdefgh", T0, "i18n-duel");
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    const blue = joined.playerId;
    let d = must(readyDuel(must(readyDuel(joined.duel, red, true, T0 + 2000)), blue, true, T0 + 2000));
    const start = T0 + 2000 + PVP_LEAD_MS;
    const english = duelQuestion(d, 0);
    const fr = localizeQuestion(english, langs.fr, { difficulty: "medium", used: new Set() }, null);
    // Red answers in French, Blue in English: both right.
    d = must(answerQuiz(d, red, 0, fr.answer, start + 1000, "fr"));
    d = must(answerQuiz(d, blue, 0, english.answer, start + 2000));
    const view = quizView(d, red, start + 3000, 1, "fr");
    const shown = view.revealed[0] ?? null;
    expect(shown?.answer).toBe(fr.answer);
    expect(shown?.picks.every((p) => p?.correct)).toBe(true);
    expect(shown?.picks[0]?.choice).toBe(fr.answer);
    expect(quizView(d, blue, start + 3000, 1).revealed[0]?.answer).toBe(english.answer);
  });
});
