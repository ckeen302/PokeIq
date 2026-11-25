import { describe, expect, it } from "vitest";
import {
  ballEffect,
  ballsIn,
  checksIn,
  DEFAULT_SITUATION,
  gameOf,
  lowLevelBonus,
  maxHpOf,
  modifiedRate,
  series,
  shakeValue,
  simulate,
  statusBonus,
  throwOnce,
  type BallId,
  type GameId,
  type Target,
} from "@/lib/catch-rate/formula";
import { DEFAULT_INPUTS, decodeInputs, encodeInputs } from "@/lib/catch-rate/link";
import { rank, targetOf } from "@/lib/catch-rate/rank";
import { SPECIES, speciesById } from "@/lib/catch-rate/species";

const S = DEFAULT_SITUATION;
const target = (o: Partial<Target> = {}): Target => ({ rate: 45, baseHp: 80, baseSpeed: 80, weight: 500, types: ["normal"], ultraBeast: false, level: 30, hp: 100, maxHp: 100, status: "none", ...o });
const mul = (ball: BallId, game: GameId, t: Partial<Target> = {}, s = {}) => ballEffect(ball, gameOf(game), target(t), { ...S, ...s }).mul;

describe("catch rate: the modified catch rate a", () => {
  it("Gen III–IV floors each step: (3·Max − 2·HP) · rate · ball / (3·Max) · status", () => {
    // Full HP, rate 45, Poké Ball: 100·45/300 = 15.
    expect(modifiedRate(target(), 3, { mul: 1, add: 0 })).toBe(15);
    // 1 HP of 100: (300 − 2)·45 / 300 = 44.7 → 44; asleep ×2 → 88.
    expect(modifiedRate(target({ hp: 1, status: "sleep" }), 4, { mul: 1, add: 0 })).toBe(88);
    // Rate 3 (Mewtwo), full HP, Poké Ball: a = 1.
    expect(modifiedRate(target({ rate: 3 }), 3, { mul: 1, add: 0 })).toBe(1);
  });

  it("Gen V on: the same product, floored once, with sleep ×2.5", () => {
    expect(modifiedRate(target({ status: "sleep" }), 6, { mul: 2, add: 0 })).toBe(75); // 45·2/3·2.5
    expect(modifiedRate(target({ hp: 50 }), 7, { mul: 1.5, add: 0 })).toBe(45); // 200·45·1.5/300
  });

  it("status bonuses per generation", () => {
    expect(statusBonus("sleep", 3)).toBe(2);
    expect(statusBonus("freeze", 4)).toBe(2);
    expect(statusBonus("sleep", 5)).toBe(2.5);
    expect(statusBonus("freeze", 9)).toBe(2.5);
    for (const s of ["paralysis", "poison", "burn"] as const) {
      expect(statusBonus(s, 3)).toBe(1.5);
      expect(statusBonus(s, 9)).toBe(1.5);
    }
    expect(statusBonus("none", 9)).toBe(1);
  });

  it("the low-level bonus: Sword & Shield under 20, Scarlet & Violet under 13", () => {
    expect(lowLevelBonus(5, 8)).toBe(2.5);
    expect(lowLevelBonus(19, 8)).toBeCloseTo(1.1);
    expect(lowLevelBonus(20, 8)).toBe(1);
    expect(lowLevelBonus(5, 9)).toBeCloseTo(2.6);
    expect(lowLevelBonus(12, 9)).toBeCloseTo(1.2);
    expect(lowLevelBonus(13, 9)).toBe(1);
    expect(lowLevelBonus(5, 7)).toBe(1);
  });
});

describe("catch rate: shake checks", () => {
  it("Gen III–IV: b = 1048560 / √(√(16711680 / a)) with whole-number roots", () => {
    // a = 1: 16711680 → √ 4087 → √ 63 → b = 16643.
    expect(shakeValue(1, 3)).toBe(16643);
    // a = 255 or more never needs a check.
    expect(shakeValue(255, 4)).toBe(65536);
    // Four checks of b/65536 come out close to a/255 (the formula's design).
    for (const a of [1, 10, 45, 100, 200, 254]) {
      const p = Math.pow(shakeValue(a, 3) / 65536, 4);
      expect(Math.abs(p - a / 255)).toBeLessThan(0.025);
    }
  });

  it("Gen V: three checks of 65536 / (255/a)^(1/4); Gen VI on: four of 65536 / (255/a)^(3/16), both ≈ (a/255)^(3/4)", () => {
    expect(checksIn(5)).toBe(3);
    expect(checksIn(6)).toBe(4);
    expect(checksIn(3)).toBe(4);
    for (const a of [1, 30, 128, 254]) {
      const want = Math.pow(a / 255, 3 / 4);
      expect(Math.pow(shakeValue(a, 5) / 65536, 3)).toBeCloseTo(want, 3);
      expect(Math.pow(shakeValue(a, 7) / 65536, 4)).toBeCloseTo(want, 3);
    }
    expect(shakeValue(0, 9)).toBe(0);
  });

  it("a Mewtwo at full HP in a Poké Ball: about 0.4% in Gen III, about 1.6% from Gen V", () => {
    const mewtwo = targetOf(speciesById(150)!, { level: 70, hp: 1000, status: "none" });
    expect(throwOnce("poke", gameOf("rse"), mewtwo, S).chance).toBeCloseTo(Math.pow(16643 / 65536, 4), 6);
    expect(throwOnce("poke", gameOf("rse"), mewtwo, S).chance).toBeCloseTo(0.00416, 4);
    expect(throwOnce("poke", gameOf("sv"), mewtwo, S).chance).toBeCloseTo(0.0157, 3);
  });

  it("a catch rate of 255 with an Ultra Ball: about 74% at full HP (a = 170), sure at low HP (a ≥ 255)", () => {
    expect(throwOnce("ultra", gameOf("sv"), target({ rate: 255 }), S).a).toBe(170);
    expect(throwOnce("ultra", gameOf("sv"), target({ rate: 255, hp: 1 }), S).chance).toBe(1);
    expect(throwOnce("ultra", gameOf("rse"), target({ rate: 255, hp: 1 }), S).chance).toBe(1);
  });

  it("the Master Ball always catches, even an Ultra Beast", () => {
    expect(throwOnce("master", gameOf("sm"), target({ rate: 3, ultraBeast: true }), S).chance).toBe(1);
  });
});

describe("catch rate: ball modifiers", () => {
  it("Great ×1.5, Ultra ×2", () => {
    expect(mul("great", "rse")).toBe(1.5);
    expect(mul("ultra", "sv")).toBe(2);
  });

  it("Quick Ball: first turn only, ×4 in Gen IV and ×5 from Gen V", () => {
    expect(mul("quick", "dppt")).toBe(4);
    expect(mul("quick", "bw")).toBe(5);
    expect(mul("quick", "sv", {}, { turn: 2 })).toBe(1);
  });

  it("Dusk Ball: at night or in a cave, ×3.5 through Gen VI, ×3 from Gen VII", () => {
    expect(mul("dusk", "xy", {}, { dark: true })).toBe(3.5);
    expect(mul("dusk", "sm", {}, { dark: true })).toBe(3);
    expect(mul("dusk", "sv")).toBe(1);
  });

  it("Timer Ball: grows with the turns passed, never above ×4", () => {
    expect(mul("timer", "rse", {}, { turn: 1 })).toBe(1);
    expect(mul("timer", "dppt", {}, { turn: 11 })).toBe(2);
    expect(mul("timer", "dppt", {}, { turn: 30 })).toBe(3.9);
    expect(mul("timer", "bw", {}, { turn: 2 })).toBeCloseTo(1 + 1229 / 4096);
    expect(mul("timer", "sv", {}, { turn: 11 })).toBe(4);
    expect(mul("timer", "sv", {}, { turn: 30 })).toBe(4);
  });

  it("Net Ball: Water or Bug, ×3 through Gen VI, ×3.5 from Gen VII", () => {
    expect(mul("net", "xy", { types: ["water"] })).toBe(3);
    expect(mul("net", "sv", { types: ["bug", "flying"] })).toBe(3.5);
    expect(mul("net", "sv", { types: ["fire"] })).toBe(1);
  });

  it("Nest Ball: (40 − level)/10 in Gen III–IV, (41 − level)/10 from Gen V, at least ×1", () => {
    expect(mul("nest", "rse", { level: 1 })).toBe(3.9);
    expect(mul("nest", "sv", { level: 1 })).toBe(4);
    expect(mul("nest", "sv", { level: 21 })).toBe(2);
    expect(mul("nest", "sv", { level: 50 })).toBe(1);
  });

  it("Repeat Ball: ×3 through Gen VI, ×3.5 from Gen VII, only for a species already caught", () => {
    expect(mul("repeat", "xy", {}, { caught: true })).toBe(3);
    expect(mul("repeat", "swsh", {}, { caught: true })).toBe(3.5);
    expect(mul("repeat", "swsh")).toBe(1);
  });

  it("Level Ball: ×2 above, ×4 at double, ×8 at four times the wild level", () => {
    expect(mul("level", "sv", { level: 20 }, { yourLevel: 20 })).toBe(1);
    expect(mul("level", "sv", { level: 20 }, { yourLevel: 21 })).toBe(2);
    expect(mul("level", "sv", { level: 20 }, { yourLevel: 40 })).toBe(4);
    expect(mul("level", "hgss", { level: 20 }, { yourLevel: 80 })).toBe(8);
  });

  it("Love ×8 for a match, Fast ×4 from base Speed 100, Dream ×4 when asleep, Dive ×3.5 in water", () => {
    expect(mul("love", "sv", {}, { loveMatch: true })).toBe(8);
    expect(mul("fast", "sv", { baseSpeed: 100 })).toBe(4);
    expect(mul("fast", "sv", { baseSpeed: 99 })).toBe(1);
    expect(mul("dream", "sv", { status: "sleep" })).toBe(4);
    expect(mul("dream", "sv", { status: "paralysis" })).toBe(1);
    expect(mul("dive", "rse", {}, { water: true })).toBe(3.5);
  });

  it("Heavy Ball adds to the catch rate by weight (HeartGold & SoulSilver and Gen VII on differ)", () => {
    const add = (game: GameId, kg: number) => ballEffect("heavy", gameOf(game), target({ weight: kg * 10 }), S).add;
    expect(add("sv", 50)).toBe(-20);
    expect(add("sv", 150)).toBe(0);
    expect(add("sv", 250)).toBe(20);
    expect(add("sv", 300)).toBe(30);
    expect(add("hgss", 150)).toBe(-20);
    expect(add("hgss", 204.8)).toBe(20);
    expect(add("hgss", 307.2)).toBe(30);
    expect(add("hgss", 409.6)).toBe(40);
    // Never below a catch rate of 1: rate 3, −20.
    expect(modifiedRate(target({ rate: 3, weight: 10 }), 9, { mul: 1, add: -20 })).toBe(0); // 100·1/300 → 0.33 → 0
    expect(modifiedRate(target({ rate: 3, weight: 10, hp: 1 }), 9, { mul: 1, add: -20 })).toBe(0);
  });

  it("Ultra Beasts: Beast Ball ×5, every other ball ×410/4096 (Gen VII on); Beast Ball ×410/4096 on others", () => {
    expect(mul("beast", "sm", { ultraBeast: true })).toBe(5);
    expect(mul("ultra", "sm", { ultraBeast: true })).toBeCloseTo((2 * 410) / 4096);
    expect(mul("beast", "sm")).toBeCloseTo(410 / 4096);
    expect(mul("ultra", "sm")).toBe(2);
  });

  it("which balls each game has", () => {
    expect(ballsIn(gameOf("rse"))).not.toContain("quick");
    expect(ballsIn(gameOf("dppt"))).toContain("dusk");
    expect(ballsIn(gameOf("dppt"))).not.toContain("level");
    expect(ballsIn(gameOf("hgss"))).toContain("heavy");
    expect(ballsIn(gameOf("xy"))).not.toContain("fast");
    expect(ballsIn(gameOf("sm"))).toContain("beast");
    expect(ballsIn(gameOf("sm"))).not.toContain("dream");
    expect(ballsIn(gameOf("sv"))).toContain("dream");
  });
});

describe("catch rate: series of throws", () => {
  it("expected throws and the chance within n throws, for a steady ball", () => {
    const g = gameOf("sv");
    const t = target();
    const s = series("great", g, t, S);
    const p = s.first.chance;
    expect(s.expected).toBeCloseTo(1 / p, 6);
    expect(s.within(1)).toBeCloseTo(p, 9);
    expect(s.within(20)).toBeCloseTo(1 - Math.pow(1 - p, 20), 9);
    const n = s.throwsFor(0.9);
    expect(s.within(n)).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(s.within(n - 1)).toBeLessThan(0.9);
  });

  it("a Quick Ball is only strong on the first throw", () => {
    const g = gameOf("sv");
    const t = target();
    const quick = series("quick", g, t, S);
    const poke = throwOnce("poke", g, t, S).chance;
    expect(quick.within(2)).toBeCloseTo(1 - (1 - quick.first.chance) * (1 - poke), 9);
    expect(quick.first.chance).toBeGreaterThan(poke);
  });

  it("a Timer Ball gets better turn by turn", () => {
    const s = series("timer", gameOf("sv"), target(), S);
    const far = series("timer", gameOf("sv"), target(), { ...S, turn: 11 });
    expect(far.first.chance).toBeGreaterThan(s.first.chance);
    expect(far.expected).toBeCloseTo(1 / far.first.chance, 6);
  });

  it("an impossible catch never happens", () => {
    const s = series("heavy", gameOf("sv"), target({ rate: 3, weight: 10 }), S);
    expect(s.first.chance).toBe(0);
    expect(s.expected).toBe(Infinity);
    expect(s.throwsFor(0.9)).toBe(Infinity);
  });

  it("the shaking preview: shakes come from the checks, three at most", () => {
    const seq = (xs: number[]) => {
      let i = 0;
      return () => xs[i++] ?? 0.99;
    };
    expect(simulate({ check: 0.5, checks: 4, chance: 0.0625 }, seq([0.1, 0.1, 0.9]))).toEqual({ shakes: 2, caught: false });
    expect(simulate({ check: 0.5, checks: 4, chance: 0.0625 }, seq([0.1, 0.1, 0.1, 0.9]))).toEqual({ shakes: 3, caught: false });
    expect(simulate({ check: 0.5, checks: 4, chance: 0.0625 }, seq([0.1, 0.1, 0.1, 0.1]))).toEqual({ shakes: 3, caught: true });
    expect(simulate({ check: 0.5, checks: 3, chance: 0.125 }, seq([0.1, 0.1, 0.1]))).toEqual({ shakes: 3, caught: true });
    expect(simulate({ check: 0.5, checks: 4, chance: 0.0625 }, seq([0.9]))).toEqual({ shakes: 0, caught: false });
  });
});

describe("catch rate: data, ranking and links", () => {
  it("has every species with a catch rate from 1 to 255", () => {
    expect(SPECIES.length).toBe(1025);
    for (const s of SPECIES) {
      expect(s.rate).toBeGreaterThanOrEqual(1);
      expect(s.rate).toBeLessThanOrEqual(255);
    }
    expect(speciesById(25)?.rate).toBe(190);
    expect(speciesById(150)?.rate).toBe(3);
    expect(speciesById(793)?.ultraBeast).toBe(true);
    expect(speciesById(800)?.ultraBeast).toBe(false);
  });

  it("max HP: the games' formula, 1 for Shedinja", () => {
    expect(maxHpOf(1, 50)).toBe(1);
    expect(maxHpOf(35, 30)).toBe(Math.floor((85 * 30) / 100) + 40);
  });

  it("ranks every ball, best first, with a budget pick", () => {
    const r = rank({ ...DEFAULT_INPUTS, id: 130, game: "sv", level: 40, hp: 100, status: "sleep" });
    expect(r.balls[0]).toBe(r.best);
    for (let i = 1; i < r.balls.length; i++) expect(r.balls[i - 1].chance).toBeGreaterThanOrEqual(r.balls[i].chance);
    expect(r.master?.chance).toBe(1);
    // Gyarados is a Water type: the Net Ball (×3.5) beats the Quick Ball? No: ×5 on turn 1. Quick first, Net next.
    expect(r.balls[0].ball).toBe("quick");
    expect(r.balls[1].ball).toBe("net");
    // A sleeping Caterpie at 1 HP: every ball is a sure catch, so the Poké Ball is best and the budget pick.
    const easy = rank({ ...DEFAULT_INPUTS, id: 10, game: "sv", level: 3, hp: 1, status: "sleep" });
    expect(easy.best.ball).toBe("poke");
    expect(easy.best.chance).toBe(1);
    expect(easy.budget?.ball).toBe("poke");
  });

  it("a link keeps every input and ignores nonsense", () => {
    const i = { ...DEFAULT_INPUTS, id: 150, game: "hgss" as const, level: 70, hp: 42, status: "paralysis" as const, turn: 4, dark: true, water: true, caught: true, yourLevel: 64, loveMatch: true };
    expect(decodeInputs(new URLSearchParams(encodeInputs(i)))).toEqual(i);
    expect(decodeInputs(new URLSearchParams(encodeInputs(DEFAULT_INPUTS)))).toEqual(DEFAULT_INPUTS);
    expect(decodeInputs({ p: "99999", g: "zz", l: "0", hp: "-3", s: "sad", t: "abc" })).toEqual(DEFAULT_INPUTS);
  });
});

describe("catch rate: every language's messages format", () => {
  it("formats the messages with arguments in every language", async () => {
    const { translator } = await import("@/i18n/catalog");
    const ns = (await import("@/messages/catch-rate")).default;
    const page = (await import("@/messages/catch-rate-page")).default;
    for (const locale of ["en", "ja", "es", "fr", "de", "it"] as const) {
      const own = locale === "en" ? undefined : (await import(`@/messages/${locale}/catch-rate.json`)).default;
      const ownPage = locale === "en" ? undefined : (await import(`@/messages/${locale}/catch-rate-page.json`)).default;
      const t = translator(ns, locale, own);
      const tp = translator(page, locale, ownPage);
      expect(t("results.throwsN", { n: 1 })).toContain("1");
      expect(t("results.throwsN", { n: 6 })).toContain("6");
      expect(t("throw.shakes", { n: 0 })).not.toContain("0 ");
      expect(t("throw.shakes", { n: 2 })).toMatch(/2|two/);
      expect(t("throw.tally", { caught: 2, thrown: 5 })).toMatch(/2.*5|5.*2/);
      expect(t("results.rowLabel", { ball: "B", pct: "10%", within: "40%", n: 5 })).toContain("40%");
      expect(t("why.heavy", { kg: "235", delta: "+20" })).toContain("+20");
      expect(tp("metaSharedTitle", { name: "Gyarados", pct: "42%", ball: "Net Ball" })).toContain("Gyarados");
      if (locale !== "en") expect(t("throw.go")).not.toBe("Throw");
    }
  });
});
