import { describe, expect, it } from "vitest";
import { translator, type Tree } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import share from "@/messages/share";
import sharePage from "@/messages/share-page";
import duel from "@/messages/duel";
import tier from "@/messages/tier";
import {
  battleShareText,
  buildPokedleShare,
  cognitiveShareText,
  connectionsShareText,
  describeShare,
  guessrShareText,
  pikadokuShareText,
  quizShareText,
  replayShareText,
  type ShareResult,
} from "@/lib/share";
import { seriesTag } from "@/components/duel/DuelSeries";
import { hoursMinutes } from "@/components/NextDailyCountdown";
import { TAUNTS } from "@/lib/trainer/taunts";
import { MODULES } from "@/engines/types";
import { RANKED_TIERS } from "@/lib/ranked";

/** The shared pieces' text in other languages: the same emoji and numbers, the words in the page's language. */

const OTHERS = ["ja", "es", "fr", "de", "it"] as const;
const load = async (l: Locale, ns: string) => (await import(`@/messages/${l}/${ns}.json`)).default as Tree;

const results: ShareResult[] = [
  { game: "pokedle", daily: 123, format: "classic", max: 8, solved: true, hard: true, streak: 5, assist: "notebook", hints: ["genus"], rows: ["gybbyby", "ggggggg"], top: 18, players: 4213 },
  { game: "pokedle", format: "squirdle", max: 9, solved: false, rows: ["mpxdu"] },
  { game: "guessr", daily: 6, region: "world", rounds: [4812, 2310, 5000, 0, 1205] },
  { game: "guessr", region: "unova", streak: 3 },
  { game: "quiz", module: "shiny", format: "classic", difficulty: "hard", correct: 8, total: 10, pokeiq: 124, score: 12340, seconds: 42, grid: "1101111011" },
  { game: "quiz", module: "mixed", format: "classic", daily: 12, correct: 9, total: 10, pokeiq: 131, score: 9000, grid: "1111111110", streak: 4 },
  { game: "quiz", module: "mixed", format: "adaptive", correct: 15, total: 20, pokeiq: 132, score: 9000, grid: "1".repeat(20) },
  { game: "cognitive", score: 118, percentile: 88, fluid: 125, memory: 104, speed: 120, spatial: 109, knowledge: 112 },
  { game: "connections", daily: 7, solved: true, rows: ["0123", "0000", "1111", "2222", "3333"], seconds: 75, hinted: true, streak: 2 },
  { game: "connections", solved: false, rows: ["01234", "01243", "00000", "12340", "11111", "13240"] },
  { game: "pikadoku", daily: 4, difficulty: "expert", grid: "pbgyxpbgy", score: 120, streak: 3 },
  { game: "battle", format: "gen9randombattle", outcome: "win", cpu: "hard", turns: 23 },
  { game: "battle", format: "gen9ou", outcome: "tie", ranked: true, turns: 1 },
] as ShareResult[];

describe("shared pieces in other languages", () => {
  it("keeps every key the code asks for by id (modules, taunts, tiers)", () => {
    expect(Object.keys(share.en.quiz.modules).sort()).toEqual([...MODULES].sort());
    expect(Object.keys(duel.en.taunts.names).sort()).toEqual(TAUNTS.map((t) => t.id).sort());
    expect(Object.keys(tier.en.tiers).sort()).toEqual(RANKED_TIERS.map((t) => t.id).sort());
  });

  it("builds share text with the same emoji and no English words", async () => {
    for (const l of OTHERS) {
      const t = translator(share, l, await load(l, "share"));
      const texts = [
        buildPokedleShare({ number: 3, rows: [["match", "partial"], ["match", "match"]], solved: true, hard: false, hints: [], streak: 2, url: "u", community: { percentile: 80, players: 4213 }, t }),
        guessrShareText(results[2] as never, "?", "u", { t }),
        guessrShareText(results[3] as never, "Teselia", "u", { t }),
        quizShareText(results[4] as never, "u", t),
        quizShareText(results[5] as never, "u", t),
        cognitiveShareText(results[7] as never, "u", t),
        connectionsShareText(results[8] as never, "u", t),
        pikadokuShareText(results[10] as never, "u", t),
        battleShareText(results[11] as never, "u", "[Gen 9] Random Battle", t),
        replayShareText("Red > Blue", "[Gen 9] OU", "u", t),
      ];
      for (const text of texts) {
        expect(text.startsWith("PokéIQ "), text).toBe(true);
        expect(text, `${l}: ${text}`).not.toMatch(/\b(in a row|trainers|Practice|Daily|Weekly|Not solved|mistake|Rarity|Victory|turns?|Watch|Reasoning|Memory)\b/);
      }
    }
    const es = translator(share, "es", await load("es", "share"));
    expect(guessrShareText(results[2] as never, "?", "https://x/es/s/y", { t: es }).split("\n")).toEqual([
      "PokéIQ PokéGuessr diario #6 · Mundo 13.327/25.000",
      "🟩🟨🟩🟥🟧",
      "4812 · 2310 · 5000 · 0 · 1205",
      "https://x/es/s/y",
    ]);
    const de = translator(share, "de", await load("de", "share"));
    expect(connectionsShareText(results[8] as never, undefined, de).split("\n")[0]).toBe("PokéIQ PokéConnections #7 1 Fehler 🔥2 ⏱1:15 💡Tipp");
    const fr = translator(share, "fr", await load("fr", "share"));
    expect(cognitiveShareText(results[7] as never, undefined, fr).split("\n")[0]).toBe("PokéIQ Test cognitif 118 (88e centile)");
    expect(cognitiveShareText({ ...(results[7] as Extract<ShareResult, { game: "cognitive" }>), percentile: 1 }, undefined, fr).split("\n")[0]).toBe("PokéIQ Test cognitif 118 (1er centile)");
    const ja = translator(share, "ja", await load("ja", "share"));
    expect(quizShareText(results[4] as never, undefined, ja).split("\n")[0]).toBe("PokéIQ 本物の色違いは？ · クラシック · むずかしい 8/10 ⏱0:42");
  });

  it("describes a shared result's page in the language, with its region names", async () => {
    for (const l of OTHERS) {
      const t = translator(share, l, await load(l, "share"));
      const tp = translator(sharePage, l, await load(l, "share-page"));
      for (const r of results) {
        const view = describeShare(r, { t, tp, region: (id) => (id === "unova" ? "Einall" : undefined) });
        const text = JSON.stringify(view);
        expect(text, `${l} ${r.game}`).not.toMatch(/\b(Solved|Found all|Filled|Play today|Take the|Hard mode|day streak|in a row|out of|percentile of|Victory|Won in|Lost in|Drew in|Can you)\b/);
        expect(text, "no counts in translated copy").not.toMatch(/1[.,\s]?025|Ten |Sixteen|Twenty-five/);
      }
    }
    const tp = translator(sharePage, "es", await load("es", "share-page"));
    const t = translator(share, "es", await load("es", "share"));
    const view = describeShare(results[3], { t, tp, region: (id) => ({ unova: "Teselia" })[id] });
    expect(view.chips).toEqual(["Teselia", "Racha"]);
    expect(view.title).toBe("PokéGuessr Teselia · Racha: 3 seguidos");
    expect(describeShare(results[8], { t, tp }).detail).toBe("Encontró los cuatro grupos con 1 fallo en 1:15");
  });

  it("names the series, its leader and the countdown in the language", async () => {
    const de = translator(duel, "de", await load("de", "duel"));
    expect(seriesTag({ game: 2, wins: [1, 0], draws: 0, winner: null } as never, de)).toBe("Spiel 2 · 1–0");
    expect(seriesTag({ game: 3, wins: [1, 1], draws: 0, winner: null } as never)).toBe("Decider · 1–1");
    const fr = translator(duel, "fr", await load("fr", "duel"));
    expect(fr("series.youTake", { name: "Toi", w: 2, l: 1 })).toBe("Tu remportes la série 2–1 !");
    expect(fr("series.draws", { n: 2 })).toBe(" · 2 égalités");
    expect(translator(duel, "en", undefined)("series.draws", { n: 1 })).toBe(" · 1 draw");
    expect(hoursMinutes(432, "en")).toBe("7h 12m");
    expect(hoursMinutes(12, "en")).toBe("12m");
    expect(hoursMinutes(432, "ja")).toBe("7時間12分");
    expect(hoursMinutes(432, "es")).toBe("7 h 12 min");
  });
});
