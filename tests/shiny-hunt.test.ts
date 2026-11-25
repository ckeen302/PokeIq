import { describe, expect, it } from "vitest";
import { GAMES, chainRolls, getMethod, shinyChance, totalRolls, NO_BONUS, type OddsInput } from "@/lib/shiny-hunt/odds";
import { chanceByNow, clock, encountersFor, oddsMultiple, oneIn, perHour } from "@/lib/shiny-hunt/math";
import {
  EMPTY_STATE,
  IDLE_MS,
  STORAGE_KEY,
  addCount,
  addPhase,
  archive,
  createHunt,
  elapsed,
  isIdle,
  loadState,
  markFound,
  pause,
  phaseCount,
  removeHunt,
  reopen,
  resume,
  sanitizeState,
  saveState,
  setCount,
  setOdds,
  trophies,
  unarchive,
  undo,
  upsert,
} from "@/lib/shiny-hunt/store";
import { decodeHunt, encodeHunt } from "@/lib/shiny-hunt/share";

const odds = (game: Parameters<typeof shinyChance>[0], method: Parameters<typeof shinyChance>[1], input: Partial<OddsInput> = {}) => oneIn(shinyChance(game, method, { ...NO_BONUS, ...input }));

describe("shiny odds (the published figures)", () => {
  it("base rates: 1/8192 through Gen 5, 1/4096 from X and Y", () => {
    for (const g of ["gsc", "rse", "frlg", "dppt", "hgss", "bw", "b2w2"] as const) expect(odds(g, "wild")).toBe(8192);
    for (const g of ["xy", "oras", "sm", "usum", "swsh", "bdsp", "pla", "sv", "za"] as const) expect(odds(g, "wild")).toBe(4096);
  });
  it("Shiny Charm: 3 rolls (2 in Legends: Arceus and Z-A get 4)", () => {
    expect(odds("b2w2", "wild", { charm: true })).toBe(2731);
    expect(odds("sv", "wild", { charm: true })).toBe(1366);
    expect(odds("za", "wild", { charm: true })).toBe(1024);
    // No charm for wild encounters in Brilliant Diamond/Shining Pearl.
    expect(odds("bdsp", "wild", { charm: true })).toBe(4096);
  });
  it("Masuda method", () => {
    expect(odds("dppt", "masuda")).toBe(1639);
    expect(odds("bw", "masuda")).toBe(1366);
    expect(odds("b2w2", "masuda", { charm: true })).toBe(1024);
    expect(odds("sv", "masuda")).toBe(683);
    expect(odds("swsh", "masuda", { charm: true })).toBe(512);
    expect(odds("bdsp", "masuda", { charm: true })).toBe(512);
  });
  it("chains and combos", () => {
    const fishing = getMethod("xy", "chainFishing")!;
    expect(chainRolls(fishing, 0)).toBe(0);
    expect(chainRolls(fishing, 7)).toBe(14);
    expect(chainRolls(fishing, 50)).toBe(40);
    expect(odds("xy", "chainFishing", { chain: 20 })).toBe(100);
    expect(odds("oras", "chainFishing", { chain: 20, charm: true })).toBe(95.7);
    expect(odds("usum", "sos", { chain: 10 })).toBe(4096);
    expect(odds("usum", "sos", { chain: 15 })).toBe(820);
    expect(odds("usum", "sos", { chain: 31 })).toBe(316);
    expect(odds("sm", "sos", { chain: 40, charm: true })).toBe(274);
    expect(odds("lgpe", "catchCombo", { chain: 11 })).toBe(1024);
    expect(odds("lgpe", "catchCombo", { chain: 31 })).toBe(342);
    expect(odds("lgpe", "catchCombo", { chain: 31, lure: true, charm: true })).toBe(274);
  });
  it("Legends: Arceus research and outbreaks", () => {
    expect(odds("pla", "wild", { choices: { research: "lv10" }, charm: true })).toBe(820);
    expect(odds("pla", "wild", { choices: { research: "perfect" }, charm: true })).toBe(586);
    expect(odds("pla", "outbreak")).toBe(158);
    expect(odds("pla", "outbreak", { choices: { research: "perfect" }, charm: true })).toBe(128);
    expect(odds("pla", "massiveOutbreak", { choices: { research: "lv10" } })).toBe(293);
    expect(odds("pla", "massiveOutbreak", { choices: { research: "perfect" }, charm: true })).toBe(216);
  });
  it("Scarlet/Violet outbreaks and Sparkling Power", () => {
    expect(odds("sv", "outbreak", { choices: { cleared: "30" } })).toBe(2048);
    expect(odds("sv", "outbreak", { choices: { cleared: "60" }, charm: true })).toBe(820);
    expect(odds("sv", "wild", { choices: { sparkling: "3" } })).toBe(1024);
    expect(odds("sv", "outbreak", { choices: { cleared: "60", sparkling: "3" }, charm: true })).toBe(512);
  });
  it("flat chances", () => {
    expect(odds("gsc", "breeding")).toBe(64);
    expect(odds("swsh", "dynamax")).toBe(300);
    expect(odds("swsh", "dynamax", { charm: true })).toBe(100);
  });
  it("unknown options fall back to the defaults", () => {
    const m = getMethod("sv", "wild")!;
    expect(totalRolls(m, { ...NO_BONUS, choices: { sparkling: "9" } })).toBe(1);
    expect(totalRolls(m, { ...NO_BONUS, lure: true })).toBe(1);
  });
  it("every game has methods, and every method's odds are a real chance", () => {
    for (const g of GAMES) {
      expect(g.methods.length).toBeGreaterThan(0);
      for (const m of g.methods) {
        const p = shinyChance(g.id, m.id, { charm: true, lure: true, chain: 9999, choices: {} });
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(0.05);
      }
    }
  });
});

describe("probability math", () => {
  const p = 1 / 4096;
  it("chance by now", () => {
    expect(chanceByNow(p, 0)).toBe(0);
    expect(chanceByNow(p, 4096)).toBeCloseTo(1 - Math.exp(-1), 3);
    expect(chanceByNow(p, 1)).toBeCloseTo(p, 12);
    expect(chanceByNow(1, 5)).toBe(1);
    expect(chanceByNow(p, 1e7)).toBeCloseTo(1, 9);
  });
  it("odds multiple", () => {
    expect(oddsMultiple(p, 8192)).toBe(2);
    expect(oddsMultiple(p, 0)).toBe(0);
  });
  it("encounters for a chance", () => {
    expect(encountersFor(p, 0.5)).toBe(2839);
    expect(encountersFor(p, 0.9)).toBe(9431);
    expect(chanceByNow(p, encountersFor(p, 0.5))).toBeGreaterThanOrEqual(0.5);
    expect(chanceByNow(p, encountersFor(p, 0.5) - 1)).toBeLessThan(0.5);
  });
  it("1 in N", () => {
    expect(oneIn(1 / 4096)).toBe(4096);
    expect(oneIn(43 / 4096)).toBe(95.3);
    expect(oneIn(0)).toBe(Infinity);
  });
  it("per hour and the clock", () => {
    expect(perHour(100, 30_000)).toBeNull();
    expect(perHour(300, 3_600_000)).toBe(300);
    expect(perHour(50, 1_800_000)).toBe(100);
    expect(clock(0)).toBe("0:00");
    expect(clock(65_000)).toBe("1:05");
    expect(clock(3_725_000)).toBe("1:02:05");
  });
});

describe("hunts", () => {
  const t0 = 1_700_000_000_000;
  it("counts, never below zero, and undoes", () => {
    let h = createHunt(6, "sv", t0);
    h = addCount(h, 1, t0);
    h = addCount(h, 3, t0 + 1000);
    expect(h.count).toBe(4);
    h = addCount(h, -10, t0 + 2000);
    expect(h.count).toBe(0);
    h = undo(h);
    expect(h.count).toBe(4);
    h = undo(h);
    expect(h.count).toBe(1);
    h = setCount(h, 500);
    expect(h.count).toBe(500);
    h = undo(h);
    expect(h.count).toBe(1);
  });
  it("the timer starts with the first tap, pauses, resumes and stops when idle", () => {
    let h = createHunt(25, "sv", t0);
    expect(h.runningSince).toBeNull();
    h = addCount(h, 1, t0);
    expect(h.runningSince).toBe(t0);
    expect(elapsed(h, t0 + 60_000)).toBe(60_000);
    h = pause(h, t0 + 60_000);
    expect(elapsed(h, t0 + 999_999)).toBe(60_000);
    h = resume(h, t0 + 100_000);
    h = addCount(h, 1, t0 + 130_000);
    expect(elapsed(h, t0 + 130_000)).toBe(90_000);
    // Left alone: the clock stops IDLE_MS after the last tap.
    const later = t0 + 130_000 + IDLE_MS * 5;
    expect(isIdle(h, later)).toBe(true);
    expect(elapsed(h, later)).toBe(90_000 + IDLE_MS);
    // The next tap starts a new stretch from then.
    h = addCount(h, 1, later);
    expect(elapsed(h, later + 5_000)).toBe(90_000 + IDLE_MS + 5_000);
    expect(h.timedCount).toBe(3);
  });
  it("changing method resets its bonuses and picks its step", () => {
    let h = createHunt(129, "xy", t0);
    h = setOdds(h, { method: "chainFishing", chain: 12 });
    expect(h.chain).toBe(12);
    h = setOdds(h, { method: "horde" });
    expect(h.chain).toBe(0);
    expect(h.step).toBe(5);
    h = setOdds(h, { game: "sv" });
    expect(h.method).toBe("horde" === h.method ? "wild" : h.method);
    expect(h.method).toBe("wild");
    expect(h.step).toBe(1);
  });
  it("phases, found, archive and the trophy case", () => {
    let h = createHunt(130, "sv", t0);
    h = setCount(h, 1200);
    h = addPhase(h, 129, t0 + 5);
    h = setCount(h, 1500);
    expect(phaseCount(h)).toBe(300);
    h = markFound(h, t0 + 10);
    expect(h.status).toBe("found");
    expect(h.found?.count).toBe(1500);
    let s = upsert(EMPTY_STATE, h);
    expect(trophies(s)).toHaveLength(1);
    h = archive(h);
    expect(unarchive(h).status).toBe("found");
    expect(reopen(h).status).toBe("active");
    s = removeHunt({ ...s, current: h.id }, h.id);
    expect(s.hunts).toHaveLength(0);
    expect(s.current).toBeNull();
  });
});

describe("storage", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("round-trips", () => {
    const st = memory();
    const h = addCount(createHunt(150, "pla", 1), 7, 2);
    const state = { ...EMPTY_STATE, current: h.id, hunts: [h], prefs: { sound: true, haptics: false } };
    expect(saveState(state, st)).toBe(true);
    expect(loadState(st)).toEqual(state);
  });
  it("survives blocked or broken storage", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadState(throwing)).toEqual(EMPTY_STATE);
    expect(saveState(EMPTY_STATE, throwing)).toBe(false);
    const st = memory();
    st.m.set(STORAGE_KEY, "{not json");
    expect(loadState(st)).toEqual(EMPTY_STATE);
    expect(loadState(null)).toEqual(EMPTY_STATE);
  });
  it("repairs or drops bad hunts", () => {
    const s = sanitizeState({
      current: "gone",
      hunts: [
        { id: "a", species: 6, game: "nope", method: "masuda", count: -5, step: 1000, choices: { sparkling: "3", junk: "x" }, phases: [{ species: 99999, at: 3 }, "x"], status: "found" },
        { id: "b", species: 0 },
        { id: "a", species: 7 },
        null,
      ],
      prefs: { sound: "yes" },
    });
    expect(s.hunts).toHaveLength(1);
    const h = s.hunts[0];
    expect(h.game).toBe("sv");
    expect(h.method).toBe("masuda");
    expect(h.count).toBe(0);
    expect(h.step).toBe(99);
    expect(h.choices).toEqual({});
    expect(h.phases).toEqual([{ species: null, at: 3, date: expect.any(Number) }]);
    // "found" with no record of it is still being hunted.
    expect(h.status).toBe("active");
    expect(s.current).toBeNull();
    expect(s.prefs).toEqual({ sound: false, haptics: true });
  });
});

describe("share links", () => {
  it("round-trip a hunt in progress and a found one", () => {
    let h = createHunt(658, "sv", 1);
    h = setOdds(h, { method: "outbreak", charm: true, choices: { cleared: "60", sparkling: "3" } });
    h = setCount(h, 4321);
    h = addPhase(h, 1);
    const a = decodeHunt(encodeHunt(h))!;
    expect(a).toMatchObject({ species: 658, game: "sv", method: "outbreak", charm: true, count: 4321, phases: 1, found: null, choices: { cleared: "60", sparkling: "3" } });
    const f = markFound(h, new Date(2026, 10, 25, 15).getTime());
    expect(decodeHunt(encodeHunt(f))!.found).toBe(20261125);
  });
  it("rejects anything malformed", () => {
    for (const bad of [null, "", "x", "2.6.g.wild.0.0.-.1.0.0.0", "1.0.g.wild.0.0.-.1.0.0.0", "1.6.z.wild.0.0.-.1.0.0.0", "1.6.g.nope.0.0.-.1.0.0.0", "1.6.g.wild.0.0.9.1.0.0.0", "1.6.g.wild.0.0.-.1.0.0.12"]) {
      expect(decodeHunt(bad)).toBeNull();
    }
    expect(decodeHunt("1.6.f.wild.1.0.0.10.5.0.0")).toMatchObject({ species: 6, game: "sv", charm: true, count: 10 });
  });
});
