import { describe, expect, it } from "vitest";
import { translator, type Tree } from "@/i18n/catalog";
import { LOCALES } from "@/i18n/config";
import battleLab from "@/messages/battle-lab";
import { completeSet, type TeamSet } from "@/lib/battle/sets";
import { defaultSetup, emptySide, labMon, setupIssue, setupProblem } from "@/lib/battle/lab/setup";
import { LabSetupError, prepareLab, runLabBattle } from "@/lib/battle/lab/simulate";
import { addRecord, emptyTotals, summaryLine, type BattleRecord, type LabTotals } from "@/lib/battle/lab/stats";
import { sideLabels, STRATEGY_INFO, LAB_STRATEGIES, STATUS_NAMES, LAB_STATUSES, WEATHER_NAMES, LAB_WEATHERS, LAB_GEN_GAMES, LAB_GENS, type LabGen, type LabMon, type LabSetup } from "@/lib/battle/lab/types";
import { labMessage, labNumbers, labSummary, parseLabMessage, setupIssueText, type LabNames } from "@/lib/battle/lab/words";
import { turnBins } from "@/components/battle/lab/lab-charts";

const set = (species: string, extra: Partial<TeamSet> = {}) => completeSet({ species, ...extra });
const en = translator(battleLab, "en", undefined);
const same = (s: string) => s;
const NAMES: LabNames = { species: same, move: same, item: same, ability: same, nature: same };

function matchup(gen: LabGen, a: LabMon[], b: LabMon[], doubles = false): LabSetup {
  return { ...defaultSetup(), gen, doubles, sides: [{ ...emptySide(), team: a }, { ...emptySide(), team: b }] };
}

function record(outcome: 0 | 1 | 2, turns: number): BattleRecord {
  return {
    outcome,
    capped: false,
    broken: false,
    turns,
    winnerHp: null,
    kos: [[], []],
    otherKos: [0, 0],
    critKo: [false, false],
    missed: [false, false],
    moves: [{}, {}],
    refused: 0,
    fallbacks: 0,
  };
}

function totals(list: [0 | 1 | 2, number][]): LabTotals {
  const t = emptyTotals();
  for (const [o, n] of list) addRecord(t, record(o, n));
  return t;
}

const messages = async (locale: string) => (await import(`@/messages/${locale}/battle-lab.json`)).default as Tree;

describe("battle lab words: English exactly as before", () => {
  it("the summary line", () => {
    const cases: LabTotals[] = [
      totals([]),
      totals([[0, 1]]),
      totals([[0, 4], [0, 5], [1, 6], [2, 5], [0, 5]]),
      totals([[0, 3], [1, 4]]),
      totals([[1, 3], [1, 4], [0, 2], [2, 9]]),
      totals(Array.from({ length: 1234 }, (_, i) => [((i % 3) as 0 | 1 | 2), 1 + (i % 7)] as [0 | 1 | 2, number])),
    ];
    for (const t of cases) expect(labSummary(t, ["Piplup", "Turtwig"])).toBe(summaryLine(t, ["Piplup", "Turtwig"]));
  });

  it("why a setup can't run", () => {
    const snorlax = labMon(set("Snorlax", { moves: ["Tackle"] }));
    const setups = [
      matchup(9, [], [snorlax]),
      matchup(9, [snorlax], []),
      matchup(9, [snorlax], [snorlax], true),
      matchup(9, [snorlax], [labMon(set("Pikachu", { name: "Sparky", moves: [] }))]),
      matchup(9, [labMon(set("Pikachu", { moves: [] }))], [snorlax]),
    ];
    for (const s of setups) expect(setupIssueText(setupIssue(s)!, NAMES)).toBe(setupProblem(s));
  });

  it("the English messages hold the library's own names", () => {
    for (const s of LAB_STRATEGIES) expect(battleLab.en.strategy[s]).toEqual(STRATEGY_INFO[s]);
    for (const s of LAB_STATUSES) expect(en(`status.${s || "healthy"}`)).toBe(STATUS_NAMES[s]);
    for (const w of LAB_WEATHERS) expect(en(`weather.${w || "none"}`)).toBe(WEATHER_NAMES[w]);
    for (const g of LAB_GENS) expect(en(`games.${g}`)).toBe(LAB_GEN_GAMES[g]);
  });

  it("side labels and turn bins", () => {
    const setup = defaultSetup();
    expect(sideLabels(setup)).toEqual(["Piplup", "Turtwig"]);
    expect(sideLabels(setup, { sides: [en("side.a"), en("side.b")], species: same })).toEqual(["Piplup", "Turtwig"]);
    expect(sideLabels(matchup(4, [], []))).toEqual(["Side A", "Side B"]);
    const t = totals([[0, 1], [1, 3], [2, 2]]);
    expect(turnBins(t).map((b) => b.title)).toEqual(["Turn 1", "Turn 2", "Turn 3"]);
    const long = totals([[0, 90]]);
    expect(turnBins(long)[0].title).toBe("Turns 1–3");
  });

  it("numbers", () => {
    const num = labNumbers("en");
    expect(num.count(12345)).toBe("12,345");
    expect(num.pct(0.6321)).toBe("63.2%");
    expect(num.fixed(1.234, 2)).toBe("1.23");
  });
});

describe("battle lab: the simulator's messages", () => {
  const snorlax = labMon(set("Snorlax", { moves: ["Tackle"] }));
  const thrown = (setup: LabSetup) => {
    try {
      prepareLab(setup);
    } catch (err) {
      if (err instanceof LabSetupError) return err.message;
      throw err;
    }
    throw new Error("no error");
  };
  const samples = [
    thrown(matchup(4, [], [snorlax])),
    thrown(matchup(4, [snorlax], [snorlax], true)),
    thrown(matchup(4, [labMon(set("Pikachu", { moves: ["Nuzzle"] }))], [snorlax])),
    thrown(matchup(4, [labMon(set("Pikachu", { moves: ["Tackle"], item: "Booster Energy" }))], [snorlax])),
    thrown(matchup(9, [labMon(set("Aegislash-Blade", { moves: ["Tackle"] }))], [snorlax])),
    thrown(matchup(4, [snorlax], [labMon(set("Sprigatito", { moves: ["Tackle"] }))])),
    prepareLab(matchup(1, [labMon(set("Pikachu", { moves: ["Thunderbolt"], item: "Leftovers" }))], [snorlax])).notes[0],
    runLabBattle(prepareLab(matchup(9, [{ ...labMon(set("Charizard", { moves: ["Flamethrower"] })), status: "brn" }], [snorlax])), "x", 0, { log: true }).misses![0],
    "Side B's Snorlax can't start asleep.",
    "Side A's Mr. Mime: there's no ability called \"Nope\" in Gen 5.",
    "Side A's Mr. Mime: there's no nature called \"Nope\".",
    "The weather didn't take.",
    "The terrain didn't take.",
    "The simulator stopped: boom",
    "The simulator stopped responding. Try again.",
    "The run failed.",
    "Couldn't replay that battle.",
  ];

  it("every one is recognised, and the English message reads the same", () => {
    for (const text of samples) {
      const parsed = parseLabMessage(text);
      expect(parsed, text).not.toBeNull();
      const values: Record<string, string> = { ...parsed!.parts };
      if ("mon" in values) values.who = en("msg.who", { side: values.side, name: values.mon });
      expect(en(`msg.${parsed!.key}`, values)).toBe(text);
    }
    expect(parseLabMessage("Worker failed to load")).toBeNull();
    expect(labMessage("Worker failed to load", NAMES)).toBe("Worker failed to load");
  });

  it("another language translates them, names and all", async () => {
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const t = translator(battleLab, locale, await messages(locale));
      for (const text of samples) {
        const out = labMessage(text, { ...NAMES, species: (s) => (s === "Charizard" ? "<charizard>" : s) }, t);
        expect(out, `${locale}: ${text}`).not.toBe(text);
        expect(out).not.toMatch(/Side [AB]|[{}]/);
        if (text.includes("Charizard")) expect(out).toContain("<charizard>");
      }
    }
  });

  it("summaries and setup problems in another language", async () => {
    const t = translator(battleLab, "fr", await messages("fr"));
    const line = labSummary(totals([[0, 4], [0, 5], [1, 6], [2, 5], [0, 5]]), ["Tiplouf", "Tortipouss"], labNumbers("fr"), t);
    expect(line.replace(/\s/g, " ")).toBe("Tiplouf gagne 60,0 % (± 32,6 %) sur 5 combats, 20,0 % de nuls ; médiane de 5 tours.");
    const ja = translator(battleLab, "ja", await messages("ja"));
    expect(setupIssueText({ key: "needsMon", side: 1 }, NAMES, ja)).toBe("陣営Bにポケモンが必要です。");
  });
});
