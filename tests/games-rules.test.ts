import { describe, expect, it } from "vitest";
import { referenceAthlete, type Athlete } from "@/lib/games/athlete";
import { eventPoints, allAroundPoints } from "@/lib/games/allround";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { DEFAULT_NATIONS, eventRunPath, h2hQuestion, parseField, parseNations, playPath, recordsPath } from "@/lib/games/deeplink";
import { buildNations, medalTable, runGames, type EventOutcome, type Nation } from "@/lib/games/games";
import { countback, openingFor, runHighJump } from "@/lib/games/highjump";
import { runLift, successChance } from "@/lib/games/lift";
import { compareSeries } from "@/lib/games/longjump";
import { bracketOrder, runBracket } from "@/lib/games/wrestle";
import RECORDS from "@/data/games-records.json";
import type { RecordsFile } from "@/lib/games/records";

const mon = (k: string): Athlete => GAMES_BY_KEY.get(k)!;

describe("high jump: World Athletics rules", () => {
  it("countback: best height, then fewest failures at it, then fewest in all", () => {
    const a = { best: 2.3, failsAtBest: 0, totalFails: 3 };
    const b = { best: 2.3, failsAtBest: 1, totalFails: 1 };
    const c = { best: 2.3, failsAtBest: 0, totalFails: 1 };
    const d = { best: 2.33, failsAtBest: 2, totalFails: 6 };
    const sorted = [a, b, c, d].sort(countback);
    expect(sorted).toEqual([d, c, a, b]);
    expect(countback(a, { ...a })).toBe(0);
    expect(countback({ best: null, failsAtBest: 0, totalFails: 0 }, a)).toBeGreaterThan(0);
  });
  it("opens about 7% below its best on the 5 cm grid", () => {
    expect(openingFor(2.35)).toBeCloseTo(2.15, 9);
    expect(openingFor(0.1)).toBeCloseTo(0.05, 9);
  });
  it("each athlete comes in at its own height, three failures in a row and out, places by countback, a jump-off for a tie at the top", () => {
    // Two identical jumpers: whatever happens, there is one winner (a jump-off) unless they're identical all the way.
    const twin = (key: string) => ({ ...referenceAthlete(), key, name: key });
    let jumpOffs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = runHighJump([twin("a"), twin("b"), twin("c")], seed);
      const winners = r.order.filter((c) => c.place === 1);
      if (r.jumpOff.length) jumpOffs++;
      if (r.jumpOff.length && winners.length === 1) expect(winners[0].jumpOff).toBe(true);
      for (const c of r.cards) {
        let run = 0;
        for (const j of c.jumps) { run = j.cleared ? 0 : run + 1; expect(run).toBeLessThanOrEqual(3); }
        if (c.out) expect(c.jumps.slice(-3).every((j) => !j.cleared)).toBe(true);
        expect(c.jumps[0].height).toBeGreaterThanOrEqual(c.opening - 1e-9);
      }
    }
    expect(jumpOffs).toBeGreaterThan(0);
  });
  it("the bar goes up 5 cm, then 3 cm once three or fewer are left", () => {
    const r = runHighJump(["pikachu", "lucario", "garchomp", "blaziken", "machamp", "infernape"].map(mon), 5);
    const steps = r.heights.slice(1).map((h, i) => Math.round((h - r.heights[i]) * 100));
    expect(steps.every((s) => s >= 3)).toBe(true);
    expect(steps.some((s) => s === 3)).toBe(true);
  });
});

describe("weightlifting: IWF attempts", () => {
  it("three attempts, open at 90%, then about 96%, then 100%; a miss repeats the weight", () => {
    const r = runLift(["machamp", "snorlax", "conkeldurr", "hariyama"].map(mon), 8);
    for (const c of r.cards) {
      expect(c.attempts.length).toBe(3);
      expect(c.attempts[0].weight).toBe(Math.round(c.max * 0.9));
      for (let i = 1; i < 3; i++) {
        const prev = c.attempts[i - 1], now = c.attempts[i];
        if (!prev.success) expect(now.weight).toBe(prev.weight);
        else expect(now.weight).toBeGreaterThanOrEqual(prev.weight + 1);
      }
      expect(c.best).toBe(c.attempts.filter((x) => x.success).reduce<number | null>((m, x) => Math.max(m ?? 0, x.weight), null));
    }
  });
  it("the chance falls quickly above the day's best", () => {
    expect(successChance(100, 100)).toBeCloseTo(0.5, 9);
    expect(successChance(97, 100)).toBeGreaterThan(0.94);
    expect(successChance(103, 100)).toBeLessThan(0.06);
  });
  it("pound for pound is its own ranking", () => {
    const r = runLift(["kartana", "groudon", "snorlax"].map(mon), 1);
    expect(r.order[0].athlete.key).toBe("groudon");
    expect(r.p4p[0].athlete.key).toBe("kartana");
  });
  it("can't lift the junior bar: a bomb-out", () => {
    const r = runLift(["gastly", "pikachu"].map(mon), 1);
    expect(r.cards.find((c) => c.athlete.key === "gastly")!.best).toBeNull();
  });
});

describe("horizontal jumps and throws: best, then the next best", () => {
  it("series compare best first", () => {
    expect(compareSeries([8.1, null, 7.9], [8.1, 7.5, null])).toBeLessThan(0);
    expect(compareSeries([8.0], [8.1])).toBeGreaterThan(0);
    expect(compareSeries([null, null], [0.5])).toBeGreaterThan(0);
  });
});

describe("wrestling bracket", () => {
  it("seeds 1 v 8, 4 v 5, 2 v 7, 3 v 6", () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
  });
  it("top seeds get the byes", () => {
    const br = runBracket(["groudon", "snorlax", "machamp", "pikachu", "lucario"].map(mon), 1);
    const byes = br.rounds[0].bouts.filter((b) => b.b == null).map((b) => b.a.key);
    expect(byes).toContain("groudon");
    expect(byes).toHaveLength(3);
  });
});

describe("the medal table: golds, then silvers, then bronzes", () => {
  const n = (id: string, keys: string[]): Nation => ({ id, name: `Team ${id}`, type: id, color: "#fff", athletes: keys.map((k) => ({ ...referenceAthlete(), key: k, name: k })) });
  const out = (gold: string, silver: string, bronze: string): EventOutcome => ({ event: "100m", podium: { gold: [gold], silver: [silver], bronze: [bronze] }, marks: new Map(), standings: [], detail: null as never });
  it("ranks by gold first, then silver, then bronze; equal is a shared rank", () => {
    const A = n("a", ["a1"]), B = n("b", ["b1"]), C = n("c", ["c1"]), D = n("d", ["d1"]);
    const t = medalTable([A, B, C, D], [out("a1", "b1", "c1"), out("b1", "c1", "c1"), out("d1", "c1", "b1"), out("a1", "d1", "b1")]);
    expect(t.map((r) => r.nation.id)).toEqual(["a", "b", "d", "c"]);
    expect(t[0]).toMatchObject({ gold: 2, silver: 0, bronze: 0, rank: 1 });
    // One gold beats any number of silvers.
    expect(t[3].silver).toBeGreaterThan(t[0].silver);
    const tie = medalTable([A, B], [out("a1", "b1", "a1"), out("b1", "a1", "b1")]);
    expect(tie[0].rank).toBe(1);
    expect(tie[1].rank).toBe(1);
  });
  it("the Games run every event, then the all-around from each athlete's best", () => {
    const file = RECORDS as unknown as RecordsFile;
    const nations = buildNations(DEFAULT_NATIONS.slice(0, 3), GAMES_BY_KEY, file.nations);
    expect(nations).toHaveLength(3);
    const keys = nations.flatMap((x) => x.athletes.map((a) => a.key));
    expect(new Set(keys).size).toBe(keys.length);
    const g = runGames(nations, 4);
    expect(g.outcomes.map((o) => o.event)).toEqual(["100m", "long-jump", "shot-put", "weightlifting", "50m-freestyle", "wrestling", "200m", "high-jump", "javelin", "100m-freestyle", "400m", "all-around"]);
    expect(g.table.reduce((s, r) => s + r.gold, 0)).toBeGreaterThanOrEqual(12);
    expect(g.champion).toBeTruthy();
  }, 60_000);
  it("a built team claims its athletes before a type nation can", () => {
    const file = RECORDS as unknown as RecordsFile;
    const water = file.nations.water[0];
    const ns = buildNations([{ type: "water" }, { keys: [water, "pikachu", "snorlax"] }], GAMES_BY_KEY, file.nations);
    expect(ns[1].athletes.map((a) => a.key)).toContain(water);
    expect(ns[0].athletes.map((a) => a.key)).not.toContain(water);
  });
});

describe("all-around: World Athletics' decathlon tables", () => {
  it("score the decathlon's 1,000-point marks", () => {
    expect(eventPoints("100m", 10.395)).toBe(1000);
    expect(eventPoints("400m", 46.17)).toBe(1000);
    expect(eventPoints("long-jump", 7.76)).toBe(1000);
    expect(eventPoints("shot-put", 18.4)).toBe(1000);
    expect(eventPoints("javelin", 77.19)).toBe(1000);
    expect(eventPoints("high-jump", 2.2)).toBe(992);
    expect(eventPoints("100m", 18.5)).toBe(0);
  });
  it("ours score 1,000 at the elite mark", () => {
    for (const [id, m] of [["200m", 20], ["weightlifting", 190], ["50m-freestyle", 21.3], ["100m-freestyle", 47]] as const) {
      expect(Math.abs(eventPoints(id, m) - 1000), id).toBeLessThanOrEqual(1);
    }
    expect(allAroundPoints({}).total).toBe(0);
  });
});

describe("share links", () => {
  it("events, fields, seeds and rain", () => {
    expect(eventRunPath("weightlifting", { keys: ["snorlax", "machamp"], seed: 9 })).toBe("/lab/games/run?e=weightlifting&vs=snorlax,machamp&seed=9");
    expect(eventRunPath("50m-freestyle", { rain: true })).toBe("/lab/games/run?e=50m-freestyle&rain=1");
    expect(eventRunPath("javelin")).toBe("/lab/games/javelin");
    expect(recordsPath("long-jump")).toBe("/lab/games/records/long-jump");
    expect(parseField("Snorlax,MACHAMP,nope,snorlax", (k) => GAMES_BY_KEY.has(k))).toEqual(["snorlax", "machamp"]);
  });
  it("nations round-trip", () => {
    const specs = [{ type: "fire" }, { keys: ["pikachu", "raichu", "pichu"] }];
    const path = playPath(specs, 7);
    expect(path).toBe("/lab/games/play?n=fire,x-pikachu.raichu.pichu&seed=7");
    expect(parseNations("fire,x-pikachu.raichu.pichu,fire,nope", (k) => GAMES_BY_KEY.has(k))).toEqual(specs);
  });
  it("asks the head to head's question", () => {
    expect(h2hQuestion("weightlifting", "Snorlax", "Machamp")).toBe("Can Snorlax out-lift Machamp?");
  });
});
