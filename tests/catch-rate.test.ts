import { describe, expect, it } from "vitest";
import {
  badgePenalty,
  ballEffect,
  ballsIn,
  blockedIn,
  checksIn,
  critChance,
  DEFAULT_SITUATION,
  effectiveRate,
  gameOf,
  lowLevelBonus,
  maxHpOf,
  modifiedRate,
  powerBonus,
  rateIn,
  series,
  shakeValue,
  simulate,
  statusBonus,
  throwOnce,
  UB_PENALTY,
  type BallId,
  type GameId,
  type Situation,
  type Target,
} from "@/lib/catch-rate/formula";
import { DEFAULT_INPUTS, decodeInputs, encodeInputs } from "@/lib/catch-rate/link";
import { rank, targetOf } from "@/lib/catch-rate/rank";
import { SPECIES, speciesById } from "@/lib/catch-rate/species";

/*
 * Sources, cited case by case below:
 *  EMERALD  https://github.com/pret/pokeemerald/blob/master/src/battle_script_commands.c (Cmd_handleballthrow, sBallCatchBonuses)
 *  RUBY     https://github.com/pret/pokeruby/blob/master/src/battle_script_commands.c (atkEF_handleballthrow)
 *  FRLG     https://github.com/pret/pokefirered/blob/master/src/battle_script_commands.c (Cmd_handleballthrow)
 *  PLAT     https://github.com/pret/pokeplatinum/blob/main/src/battle/battle_script.c (BattleScript_CalcCatchShakes)
 *  HGSS     https://github.com/pret/pokeheartgold/blob/master/src/battle/battle_command.c (BattleSystem_CalculateBallShakes)
 *           and https://github.com/pret/pokeheartgold/blob/master/asm/overlay_12_battle_command.s (sMoonBallPokemon)
 *  DFC5…9   https://www.dragonflycave.com/mechanics/gen-v-capturing/, …/gen-vi-vii-capturing/, …/gen-viii-capturing/,
 *           …/gen-ix-capturing/ and the calculators' code, https://www.dragonflycave.com/gen5capture-worker.js,
 *           …/gen6capture-worker.js, …/gen8capture-worker.js, …/gen9capture-worker.js
 *  BP       https://bulbapedia.bulbagarden.net/wiki/Catch_rate and …/wiki/Poké_Ball and each ball's page (read through
 *           https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=Catch_rate&prop=wikitext&format=json)
 *  BPLIST   https://bulbapedia.bulbagarden.net/wiki/List_of_Pokémon_by_catch_rate ("Changes to catch rate")
 *  SEREBII  https://www.serebii.net/games/capture.shtml and the Scarlet & Violet Pokédex (https://www.serebii.net/pokedex-sv/)
 */

const S = DEFAULT_SITUATION;
const target = (o: Partial<Target> = {}): Target => ({ id: 25, rate: 45, baseHp: 80, baseSpeed: 80, weight: 500, types: ["normal"], ultraBeast: false, level: 30, hp: 100, maxHp: 100, status: "none", ...o });
const mul = (ball: BallId, game: GameId, t: Partial<Target> = {}, s: Partial<Situation> = {}) => ballEffect(ball, gameOf(game), target(t), { ...S, ...s }).mul;
const a = (game: GameId, ball: BallId, t: Partial<Target> = {}, s: Partial<Situation> = {}) => throwOnce(ball, gameOf(game), target(t), { ...S, ...s }).a;
const chance = (game: GameId, ball: BallId, t: Partial<Target> = {}, s: Partial<Situation> = {}) => throwOnce(ball, gameOf(game), target(t), { ...S, ...s }).chance;

describe("catch rate, Gen III–IV: the decompiled code", () => {
  it("a = ⌊⌊rate × ball⌋ × (3·Max − 2·HP) / (3·Max)⌋: the ball multiplies the rate first, then the HP part (EMERALD, PLAT)", () => {
    // odds = (catchRate * ballMultiplier / 10) * (maxHP * 3 - hp * 2) / (3 * maxHP): Great Ball 15, rate 45, 1 HP of
    // 100: ⌊45 × 15 / 10⌋ = 67, then ⌊67 × 298 / 300⌋ = 66 (multiplying the HP part first would give 67).
    expect(a("rse", "great", { hp: 1 })).toBe(66);
    // Full HP, Poké Ball: ⌊45 × 100 / 300⌋ = 15.
    expect(a("rse", "poke")).toBe(15);
    // Mewtwo (rate 3) at full HP: ⌊3 × 100 / 300⌋ = 1.
    expect(a("dppt", "poke", { rate: 3 })).toBe(1);
  });

  it("status: sleep and freeze ×2, the others odds × 15 / 10 rounded down (EMERALD, PLAT, HGSS)", () => {
    expect(a("rse", "great", { hp: 1, status: "paralysis" })).toBe(99); // ⌊66 × 15 / 10⌋
    expect(a("hgss", "great", { hp: 1, status: "sleep" })).toBe(132); // 66 × 2
    expect(statusBonus("sleep", 3)).toBe(2);
    expect(statusBonus("freeze", 4)).toBe(2);
    for (const s of ["paralysis", "poison", "burn"] as const) expect(statusBonus(s, 4)).toBe(1.5);
  });

  it("b = 1048560 / √(√(16711680 / a)) with whole-number roots; a ≥ 255 is caught outright (EMERALD: odds > 254)", () => {
    // a = 1: 16711680 → √ 4087 → √ 63 → ⌊1048560 / 63⌋ = 16643.
    expect(shakeValue(1, 3)).toBe(16643);
    // BP: "all a values greater than 200 yield the same b value, 65535, which results in a 99.994% chance".
    expect(shakeValue(200, 4)).toBe(61680); // 16711680 / 200 = 83558 → 289 → 17 → 61680
    expect(shakeValue(201, 3)).toBe(65535);
    expect(shakeValue(254, 4)).toBe(65535);
    expect(chance("rse", "poke", { rate: 255, hp: 1, maxHp: 1000 })).toBeCloseTo(Math.pow(65535 / 65536, 4), 12);
    expect(Math.pow(65535 / 65536, 4)).toBeCloseTo(0.99994, 5);
    expect(shakeValue(255, 4)).toBe(65536);
    // Four checks (BALL_3_SHAKES_SUCCESS is the fourth outcome): about a / 255 (BP, "Probability of capture").
    expect(checksIn(3)).toBe(4);
    expect(checksIn(4)).toBe(4);
    for (const x of [1, 10, 45, 100, 200]) expect(Math.abs(Math.pow(shakeValue(x, 3) / 65536, 4) - x / 255)).toBeLessThan(0.025);
  });

  it("a Mewtwo at full HP in a Poké Ball: a = 1, b = 16643, (16643 / 65536)⁴ ≈ 0.42%", () => {
    const mewtwo = targetOf(speciesById(150)!, { level: 70, hp: 1000, status: "none" }, "rse");
    expect(throwOnce("poke", gameOf("rse"), mewtwo, S).chance).toBeCloseTo(Math.pow(16643 / 65536, 4), 12);
    expect(throwOnce("poke", gameOf("rse"), mewtwo, S).chance).toBeCloseTo(0.00416, 4);
  });

  it("a paralysed legendary at 1 HP, Dusk Ball (PLAT): ⌊3 × 35 / 10⌋ = 10, ⌊10 × 898 / 900⌋ = 9, ⌊9 × 1.5⌋ = 13", () => {
    expect(a("dppt", "dusk", { rate: 3, maxHp: 300, hp: 1, status: "paralysis" }, { dark: true })).toBe(13);
    // b: 16711680 / 13 = 1285513 → √ 1133 → √ 33 → ⌊1048560 / 33⌋ = 31774.
    expect(chance("dppt", "dusk", { rate: 3, maxHp: 300, hp: 1, status: "paralysis" }, { dark: true })).toBeCloseTo(Math.pow(31774 / 65536, 4), 12);
  });

  it("Gen III–IV ball multipliers, in tenths (EMERALD sBallCatchBonuses, RUBY, FRLG, PLAT)", () => {
    expect(mul("poke", "rse")).toBe(1);
    expect(mul("great", "rse")).toBe(1.5);
    expect(mul("ultra", "rse")).toBe(2);
    // Net Ball 30 on Water or Bug; Dive Ball 35 (underwater in Gen III, water terrain in Gen IV); Repeat Ball 30.
    expect(mul("net", "rse", { types: ["bug"] })).toBe(3);
    expect(mul("dive", "rse", {}, { water: true })).toBe(3.5);
    expect(mul("dive", "dppt", {}, { water: true })).toBe(3.5);
    expect(mul("repeat", "dppt", {}, { caught: true })).toBe(3);
    // Nest Ball: 40 − level under level 40, never under 10.
    expect(mul("nest", "rse", { level: 1 })).toBe(3.9);
    expect(mul("nest", "rse", { level: 25 })).toBe(1.5);
    expect(mul("nest", "dppt", { level: 31 })).toBe(1);
    // Timer Ball: battleTurnCounter + 10 (0 on the first turn: it counts up at the end of each turn), at most 40.
    expect(mul("timer", "rse", {}, { turn: 1 })).toBe(1);
    expect(mul("timer", "rse", {}, { turn: 11 })).toBe(2);
    expect(mul("timer", "dppt", {}, { turn: 31 })).toBe(4);
    expect(mul("timer", "dppt", {}, { turn: 40 })).toBe(4);
    // Gen IV: Dusk Ball 35 at night or in a cave, Quick Ball 40 while totalTurns < 1.
    expect(mul("dusk", "dppt", {}, { dark: true })).toBe(3.5);
    expect(mul("quick", "hgss")).toBe(4);
    expect(mul("quick", "hgss", {}, { turn: 2 })).toBe(1);
  });

  it("HeartGold & SoulSilver's Apricorn balls multiply the catch rate itself, kept from 1 to 255 (HGSS)", () => {
    // Fast Ball on a rate-255 Pokémon: 255 × 4 is capped at 255, so it does no more than a Poké Ball (BP says the same).
    expect(effectiveRate(255, { ball: "fast", mul: 4, add: 0 }, gameOf("hgss"))).toBe(255);
    expect(chance("hgss", "fast", { rate: 255, baseSpeed: 100 })).toBe(chance("hgss", "poke", { rate: 255 }));
    expect(effectiveRate(45, { ball: "fast", mul: 4, add: 0 }, gameOf("hgss"))).toBe(180);
    // Heavy Ball: +40 from 4096 hg, +30 from 3072, +20 from 2048, and −20 for everything lighter (the check is on the
    // catch rate, not the weight: "catchRate < 1024" is always true). A negative rate becomes 1.
    const add = (kg: number) => ballEffect("heavy", gameOf("hgss"), target({ weight: kg * 10 }), S).add;
    expect([add(409.6), add(307.2), add(204.8), add(204.7), add(150)]).toEqual([40, 30, 20, -20, -20]);
    expect(effectiveRate(3, { ball: "heavy", mul: 1, add: -20 }, gameOf("hgss"))).toBe(1);
  });

  it("HeartGold & SoulSilver's Level Ball: ×2 above, ×4 when your level ÷ 2 is above theirs, ×8 when ÷ 4 is (HGSS)", () => {
    // if (attackerLevel <= defenderLevel) …; else if (attackerLevel / 2 <= defenderLevel) ×2; else if (/ 4 <=) ×4; else ×8
    expect(mul("level", "hgss", { level: 20 }, { yourLevel: 20 })).toBe(1);
    expect(mul("level", "hgss", { level: 20 }, { yourLevel: 41 })).toBe(2);
    expect(mul("level", "hgss", { level: 20 }, { yourLevel: 42 })).toBe(4);
    expect(mul("level", "hgss", { level: 20 }, { yourLevel: 80 })).toBe(4);
    expect(mul("level", "hgss", { level: 20 }, { yourLevel: 84 })).toBe(8);
  });

  it("HeartGold & SoulSilver's Moon Ball: the Nidoran, Clefairy, Jigglypuff and Skitty families (HGSS sMoonBallPokemon)", () => {
    for (const id of [29, 30, 31, 32, 33, 34, 35, 36, 39, 40, 173, 174, 300, 301]) expect(mul("moon", "hgss", { id })).toBe(4);
    expect(mul("moon", "hgss", { id: 517 })).toBe(1);
    // Lure Ball: ×3 when fishing.
    expect(mul("lure", "hgss", {}, { fishing: true })).toBe(3);
  });

  it("the modified catch rate never falls below 1 in Gen III–IV (BP; DFC's Gen III/IV calculator)", () => {
    expect(modifiedRate(target({ rate: 1 }), gameOf("hgss"), S, { ball: "poke", mul: 1, add: 0 })).toBe(1);
  });
});

describe("catch rate, Gen V on: the 4096ths formula (DFC5–9; BP)", () => {
  it("Scarlet & Violet, rate 45, 1 HP of 100, asleep, Ultra Ball: round(298 × 45 × 2) = 26820, ⌊26820 / 300⌋₄₀₉₆ = 366182/4096, × 2.5 = 915455/4096", () => {
    expect(a("sv", "ultra", { hp: 1, status: "sleep" }) * 4096).toBe(915455);
    // b = ⌊round(65536 / round(fround((round(255 / a))^(3/16))))⌋ = 63943, four checks.
    const th = throwOnce("ultra", gameOf("sv"), target({ hp: 1, status: "sleep" }), S);
    expect(th.b).toBe(63943);
    expect(th.chance).toBeCloseTo(Math.pow(63943 / 65536, 4), 12);
  });

  it("Gen V: three checks of b = 65536 / (255 / a)^(1/4); from Gen VI four of 65536 / (255 / a)^(3/16): both ≈ (a / 255)^(3/4)", () => {
    expect(checksIn(5)).toBe(3);
    expect(checksIn(6)).toBe(4);
    for (const x of [1, 30, 128, 254]) {
      const want = Math.pow(x / 255, 3 / 4);
      expect(Math.pow(shakeValue(x, 5) / 65536, 3)).toBeCloseTo(want, 3);
      expect(Math.pow(shakeValue(x, 7) / 65536, 4)).toBeCloseTo(want, 3);
    }
    expect(shakeValue(0, 9)).toBe(0);
  });

  it("status ×2.5 for sleep and freeze from Gen V, ×1.5 for the others (DFC5, BP)", () => {
    expect(statusBonus("sleep", 5)).toBe(2.5);
    expect(statusBonus("freeze", 9)).toBe(2.5);
    for (const s of ["paralysis", "poison", "burn"] as const) expect(statusBonus(s, 9)).toBe(1.5);
    expect(statusBonus("none", 9)).toBe(1);
  });

  it("a catch rate of 255 in an Ultra Ball: a = 170 at full HP, a sure catch at 1 HP", () => {
    expect(a("sv", "ultra", { rate: 255 })).toBe(170);
    expect(chance("sv", "ultra", { rate: 255, hp: 1 })).toBe(1);
    expect(chance("rse", "ultra", { rate: 255, hp: 1 })).toBe(1);
  });

  it("Black & White's dark grass: ×1229/4096 up to 30 caught … ×1 above 600; a rate-255 Pokémon with 100 caught is ×0.5 (DFC5, BP)", () => {
    expect(a("bw", "poke", { rate: 255 }, { darkGrass: true, dex: 100 })).toBe(42.5); // 85 × 2048/4096
    expect(a("bw", "poke", { rate: 255 }, { darkGrass: true, dex: 10 }) * 4096).toBe(Math.floor((100 * 1229 * 255) / 300));
    expect(a("bw", "poke", { rate: 255 }, { darkGrass: true, dex: 601 })).toBe(85);
    // Only Black & White: from Gen VI nobody has found what turns it on (DFC6–9).
    expect(a("xy", "poke", { rate: 255 }, { darkGrass: true, dex: 10 })).toBe(85);
  });

  it("capture powers: Entralink ×1.1/1.2/1.3, O-Power ×1.5/2/2.5, Scarlet & Violet's sandwich ×1.1/1.25/2, doubled off guard (DFC5, DFC6, DFC9, BP)", () => {
    expect([1, 2, 3].map((p) => powerBonus(p, 5))).toEqual([1.1, 1.2, 1.3]);
    expect([1, 2, 3].map((p) => powerBonus(p, 6))).toEqual([1.5, 2, 2.5]);
    expect([1, 2, 3].map((p) => powerBonus(p, 9))).toEqual([1.1, 1.25, 2]);
    expect(powerBonus(3, 7)).toBe(1);
    expect(a("xy", "great", { hp: 50 }, { power: 3 })).toBe(112.5); // 200 × 45 × 1.5 / 300 = 45, × 2.5
    expect(a("sv", "poke", { level: 40 }, { power: 3, offGuard: true })).toBe(60); // 15 × 2 × 2
  });

  it("Sword & Shield: ×(30 − level) / 10 under level 21; Scarlet & Violet: ×(36 − 2 × level) / 10 under level 13 (DFC8, DFC9)", () => {
    expect(lowLevelBonus(1, 8)).toBeCloseTo(2.9);
    expect(lowLevelBonus(10, 8)).toBe(2);
    expect(lowLevelBonus(15, 8)).toBe(1.5);
    expect(lowLevelBonus(20, 8)).toBe(1);
    expect(lowLevelBonus(1, 9)).toBeCloseTo(3.4);
    expect(lowLevelBonus(12, 9)).toBeCloseTo(1.2);
    expect(lowLevelBonus(13, 9)).toBe(1);
    expect(lowLevelBonus(5, 7)).toBe(1);
  });

  it("Sword & Shield: ×410/4096 without the eighth badge on a Pokémon above your level; no throw at all above the badges' level cap (DFC8, BP)", () => {
    const swsh = gameOf("swsh");
    expect(badgePenalty(swsh, { level: 30 }, { badges: 3, yourLevel: 25 })).toBe(410 / 4096);
    expect(badgePenalty(swsh, { level: 30 }, { badges: 3, yourLevel: 30 })).toBe(1);
    expect(badgePenalty(swsh, { level: 30 }, { badges: 8, yourLevel: 5 })).toBe(1);
    expect(a("swsh", "ultra", { level: 30, hp: 10 }, { badges: 3, yourLevel: 25 }) * 4096).toBe(34440);
    // Maximum catchable level: 20 with no badges, +5 a badge, 55 with seven, 100 with eight.
    expect(blockedIn(swsh, { level: 21 }, { badges: 0 })).toBe(true);
    expect(blockedIn(swsh, { level: 20 }, { badges: 0 })).toBe(false);
    expect(blockedIn(swsh, { level: 56 }, { badges: 7 })).toBe(true);
    expect(blockedIn(swsh, { level: 100 }, { badges: 8 })).toBe(false);
    expect(throwOnce("master", swsh, target({ level: 40 }), { ...S, badges: 2 }).chance).toBe(0);
  });

  it("Scarlet & Violet's badge penalty: ×0.8 for each badge short of obedience, in single precision, rounded to 1/4096 (DFC9, BP, SEREBII)", () => {
    const sv = gameOf("sv");
    // DFC9: a level 46 Pokémon needs five badges; with two, 0.8³ = 0.512.
    expect(badgePenalty(sv, { level: 46 }, { badges: 2, yourLevel: 50 })).toBe(2097 / 4096);
    // The lowest: a level 61+ Pokémon with no badges, 0.8⁸ ≈ 0.168.
    expect(badgePenalty(sv, { level: 61 }, { badges: 0, yourLevel: 50 })).toBe(687 / 4096);
    expect(badgePenalty(sv, { level: 25 }, { badges: 0, yourLevel: 50 })).toBe(1);
    expect(badgePenalty(sv, { level: 26 }, { badges: 0, yourLevel: 50 })).toBe(3277 / 4096);
    expect(badgePenalty(sv, { level: 100 }, { badges: 8, yourLevel: 50 })).toBe(1);
  });

  it("critical captures: ⌊a × P (× 2 with the Catching Charm) / 6⌋ out of 256, P by species caught (DFC5–9, BP)", () => {
    expect(critChance(100, 6, { dex: 30, charm: false })).toBe(0);
    expect(critChance(100, 6, { dex: 601, charm: false })).toBe(41 / 256); // ⌊250 / 6⌋
    expect(critChance(100, 8, { dex: 500, charm: true })).toBe(66 / 256); // ⌊100 × 2 × 2 / 6⌋
    expect(critChance(100, 7, { dex: 500, charm: true })).toBe(33 / 256); // no Catching Charm before Gen VIII
    expect(critChance(100, 4, { dex: 900, charm: true })).toBe(0); // no critical captures before Gen V
    // A critical capture needs one check: in Gen V the cube root of a normal capture's chance, from Gen VI the fourth
    // root (BP: a 50% normal capture is "just over 79%" as a critical one in Gen V, "around 84%" in Gen VI).
    expect(Math.cbrt(0.5)).toBeCloseTo(0.794, 3);
    expect(Math.pow(0.5, 1 / 4)).toBeCloseTo(0.841, 3);
    const th = throwOnce("great", gameOf("xy"), target({ hp: 50 }), { ...S, power: 3, dex: 500 });
    expect(th.crit).toBe(37 / 256); // ⌊112.5 × 2 / 6⌋
    expect(th.chance).toBeCloseTo(th.crit * th.check + (1 - th.crit) * Math.pow(th.check, 4), 12);
    const th5 = throwOnce("poke", gameOf("bw"), target({ rate: 255, level: 10 }), { ...S, darkGrass: true, dex: 100 });
    expect(th5.crit).toBe(3 / 256); // ⌊42.5 × 0.5 / 6⌋
    expect(th5.chance).toBeCloseTo(th5.crit * th5.check + (1 - th5.crit) * Math.pow(th5.check, 3), 12);
  });

  it("the Master Ball always catches, even an Ultra Beast", () => {
    expect(throwOnce("master", gameOf("sm"), target({ rate: 3, ultraBeast: true }), S).chance).toBe(1);
  });
});

describe("catch rate, Gen V on: ball multipliers (DFC5–9, BP's ball pages, SEREBII)", () => {
  it("Quick Ball ×5 on the first turn from Gen V; Dusk Ball ×3.5 through Gen VI, ×3 from Gen VII", () => {
    expect(mul("quick", "bw")).toBe(5);
    expect(mul("quick", "sv", {}, { turn: 2 })).toBe(1);
    expect(mul("dusk", "oras", {}, { dark: true })).toBe(3.5);
    expect(mul("dusk", "sm", {}, { dark: true })).toBe(3);
    expect(mul("dusk", "sv")).toBe(1);
  });

  it("Timer Ball: 1 + turns passed × 1229/4096, at most ×4 (BP's table: 5325/4096, 6554/4096 … ×4 from 10 turns passed)", () => {
    expect(mul("timer", "bw", {}, { turn: 2 }) * 4096).toBe(5325);
    expect(mul("timer", "sv", {}, { turn: 3 }) * 4096).toBe(6554);
    expect(mul("timer", "sv", {}, { turn: 10 }) * 4096).toBe(15157);
    expect(mul("timer", "sv", {}, { turn: 11 })).toBe(4);
    expect(mul("timer", "sv", {}, { turn: 30 })).toBe(4);
  });

  it("Nest Ball: ⌊(41 − level) × 4096 / 10⌋ / 4096; Gen V at least ×1, from Gen VI only under level 30", () => {
    expect(mul("nest", "sv", { level: 1 })).toBe(4);
    expect(mul("nest", "sv", { level: 21 })).toBe(2);
    expect(mul("nest", "bw", { level: 30 }) * 4096).toBe(Math.floor((11 * 4096) / 10)); // ×1.1 in Gen V
    expect(mul("nest", "xy", { level: 30 })).toBe(1); // ×1 from Gen VI
    expect(mul("nest", "sv", { level: 29 }) * 4096).toBe(Math.floor((12 * 4096) / 10));
    expect(mul("nest", "sv", { level: 50 })).toBe(1);
  });

  it("Net and Repeat Balls ×3 through Gen VI, ×3.5 from Gen VII", () => {
    expect(mul("net", "xy", { types: ["water"] })).toBe(3);
    expect(mul("net", "sv", { types: ["bug", "flying"] })).toBe(3.5);
    expect(mul("net", "sv", { types: ["fire"] })).toBe(1);
    expect(mul("repeat", "oras", {}, { caught: true })).toBe(3);
    expect(mul("repeat", "swsh", {}, { caught: true })).toBe(3.5);
    expect(mul("repeat", "swsh")).toBe(1);
  });

  it("Dive Ball ×3.5: surfing, fishing or underwater through Gen VIII, in or on water in Scarlet & Violet", () => {
    expect(mul("dive", "swsh", {}, { fishing: true })).toBe(3.5);
    expect(mul("dive", "sv", {}, { fishing: true })).toBe(1);
    expect(mul("dive", "sv", {}, { water: true })).toBe(3.5);
    expect(mul("dive", "rse", {}, { fishing: true })).toBe(1);
  });

  it("Level Ball from Gen VII: ×8 when your level ÷ 4 (rounded down) is at least theirs, ×4 at ÷ 2, ×2 when higher", () => {
    expect(mul("level", "sv", { level: 20 }, { yourLevel: 20 })).toBe(1);
    expect(mul("level", "sv", { level: 20 }, { yourLevel: 21 })).toBe(2);
    expect(mul("level", "sv", { level: 20 }, { yourLevel: 40 })).toBe(4);
    expect(mul("level", "sm", { level: 20 }, { yourLevel: 80 })).toBe(8);
  });

  it("Love ×8, Fast ×4 from base Speed 100, Moon ×4 on Moon Stone evolvers, Lure ×5 (Gen VII) / ×4, Dream ×4 asleep or Komala", () => {
    expect(mul("love", "sv", {}, { loveMatch: true })).toBe(8);
    expect(mul("fast", "sv", { baseSpeed: 100 })).toBe(4);
    expect(mul("fast", "sv", { baseSpeed: 99 })).toBe(1);
    for (const id of [30, 33, 35, 39, 300, 517]) expect(mul("moon", "sv", { id })).toBe(4);
    expect(mul("moon", "sv", { id: 29 })).toBe(1); // Nidoran♀ itself doesn't use a Moon Stone (it did count in HG/SS)
    expect(mul("lure", "usum", {}, { fishing: true })).toBe(5);
    expect(mul("lure", "swsh", {}, { fishing: true })).toBe(4);
    expect(mul("lure", "sv", {}, { water: true })).toBe(4);
    expect(mul("dream", "sv", { status: "sleep" })).toBe(4);
    expect(mul("dream", "swsh", { id: 775 })).toBe(4);
    expect(mul("dream", "sv", { status: "paralysis" })).toBe(1);
  });

  it("Heavy Ball from Gen VII: −20 under 100 kg, ±0 to 199.9 kg, +20 from 200 kg, +30 from 300 kg", () => {
    const add = (game: GameId, kg: number) => ballEffect("heavy", gameOf(game), target({ weight: kg * 10 }), S).add;
    expect([add("sv", 99.9), add("sv", 100), add("sv", 199.9), add("sv", 200), add("sv", 300)]).toEqual([-20, 0, 0, 20, 30]);
  });

  it("Heavy Ball on Beldum (rate 3, 95.2 kg): impossible in Sun & Moon (rate 0), possible from Ultra Sun & Ultra Moon (rate 1)", () => {
    // DFC6: "In Sun and Moon, if this results in a negative value, it is bumped up to 0; in Ultra Sun and Ultra Moon …
    // bumped up to 1"; BP's Heavy Ball page says the same.
    const beldum = { id: 374, rate: 3, weight: 952, hp: 1 };
    expect(chance("sm", "heavy", beldum)).toBe(0);
    expect(chance("usum", "heavy", beldum)).toBeGreaterThan(0);
    expect(chance("sv", "heavy", beldum)).toBeGreaterThan(0);
  });

  it("Ultra Beasts: every ball but the Beast and Master Balls is set to ×410/4096 (not multiplied by it); the Beast Ball is ×5, ×410/4096 on others", () => {
    expect(mul("beast", "sm", { ultraBeast: true })).toBe(5);
    expect(mul("ultra", "sm", { ultraBeast: true })).toBe(UB_PENALTY);
    expect(mul("quick", "sv", { ultraBeast: true })).toBe(UB_PENALTY);
    expect(mul("beast", "sm")).toBe(UB_PENALTY);
    expect(mul("ultra", "sm")).toBe(2);
    // The Heavy Ball still changes the catch rate: +30 on Celesteela (999.9 kg), with the ×410/4096 ball bonus.
    const fx = ballEffect("heavy", gameOf("usum"), target({ ultraBeast: true, weight: 9999 }), S);
    expect([fx.add, fx.mul]).toEqual([30, UB_PENALTY]);
  });

  it("which balls each game has", () => {
    expect(ballsIn(gameOf("rse"))).not.toContain("quick");
    expect(ballsIn(gameOf("dppt"))).toContain("dusk");
    expect(ballsIn(gameOf("dppt"))).not.toContain("level");
    expect(ballsIn(gameOf("hgss"))).toEqual(expect.arrayContaining(["heavy", "moon", "lure"]));
    expect(ballsIn(gameOf("xy"))).not.toContain("fast");
    expect(ballsIn(gameOf("usum"))).toContain("beast");
    expect(ballsIn(gameOf("sm"))).not.toContain("dream");
    expect(ballsIn(gameOf("sv"))).toContain("dream");
  });
});

describe("catch rate: catch rates by game (BPLIST, DFC6, SEREBII)", () => {
  it("the table holds Scarlet & Violet's rates, not PokéAPI's Legends: Arceus ones", () => {
    expect(speciesById(899)?.rate).toBe(45); // Wyrdeer
    expect(speciesById(900)?.rate).toBe(15); // Kleavor
    expect(speciesById(901)?.rate).toBe(20); // Ursaluna
    expect(speciesById(903)?.rate).toBe(20); // Sneasler
    expect(speciesById(384)?.rate).toBe(3); // Rayquaza
    expect(speciesById(550)?.rate).toBe(190); // Basculin, from 2.0.1
  });

  it("older games' rates", () => {
    const r = (id: number, game: GameId) => rateIn(id, speciesById(id)!.rate, game);
    expect([r(382, "rse"), r(382, "xy"), r(382, "oras")]).toEqual([5, 5, 3]); // Kyogre
    expect([r(384, "rse"), r(384, "oras"), r(384, "swsh"), r(384, "sv")]).toEqual([3, 45, 45, 3]); // Rayquaza
    expect([r(483, "dppt"), r(483, "bw"), r(483, "oras")]).toEqual([30, 30, 3]); // Dialga
    expect([r(643, "bw"), r(643, "xy"), r(643, "oras")]).toEqual([45, 45, 3]); // Reshiram
    expect([r(795, "sm"), r(795, "usum")]).toEqual([255, 45]); // Pheromosa
    expect([r(799, "sm"), r(799, "usum")]).toEqual([15, 45]); // Guzzlord
    expect([r(800, "sm"), r(800, "usum"), r(800, "swsh"), r(800, "sv")]).toEqual([3, 255, 255, 3]); // Necrozma
    expect([r(803, "usum"), r(803, "swsh"), r(805, "swsh")]).toEqual([3, 45, 30]); // Poipole, Stakataka
    expect([r(791, "usum"), r(791, "sv")]).toEqual([45, 3]); // Solgaleo
    expect([r(550, "swsh"), r(550, "sv")]).toEqual([25, 190]); // Basculin
    expect(r(25, "rse")).toBe(190);
  });

  it("the ranking uses the game's rate", () => {
    expect(rank({ ...DEFAULT_INPUTS, id: 384, game: "oras" }).target.rate).toBe(45);
    expect(rank({ ...DEFAULT_INPUTS, id: 384, game: "sv" }).target.rate).toBe(3);
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
    const s = series("heavy", gameOf("sm"), target({ rate: 3, weight: 10 }), S);
    expect(s.first.chance).toBe(0);
    expect(s.expected).toBe(Infinity);
    expect(s.throwsFor(0.9)).toBe(Infinity);
  });

  it("the shaking preview: shakes from the checks, Gen V's third failed check shows three, a critical capture one", () => {
    const seq = (xs: number[]) => {
      let i = 0;
      return () => xs[i++] ?? 0.99;
    };
    const four = { check: 0.5, checks: 4, chance: 0.0625, crit: 0, gen: 9 as const };
    expect(simulate(four, seq([0.1, 0.1, 0.9]))).toEqual({ shakes: 2, caught: false, critical: false });
    expect(simulate(four, seq([0.1, 0.1, 0.1, 0.9]))).toEqual({ shakes: 3, caught: false, critical: false });
    expect(simulate(four, seq([0.1, 0.1, 0.1, 0.1]))).toEqual({ shakes: 3, caught: true, critical: false });
    expect(simulate(four, seq([0.9]))).toEqual({ shakes: 0, caught: false, critical: false });
    // Gen V (DFC5): "If the first two are less than Y but the third check fails, it will burst out after three shakes".
    const five = { check: 0.5, checks: 3, chance: 0.125, crit: 0, gen: 5 as const };
    expect(simulate(five, seq([0.1, 0.1, 0.9]))).toEqual({ shakes: 3, caught: false, critical: false });
    expect(simulate(five, seq([0.1, 0.1, 0.1]))).toEqual({ shakes: 3, caught: true, critical: false });
    // A critical capture: the first number picks it, the second is its one check; it wobbles once.
    const crit = { ...four, crit: 0.2 };
    expect(simulate(crit, seq([0.1, 0.3]))).toEqual({ shakes: 1, caught: true, critical: true });
    expect(simulate(crit, seq([0.1, 0.7]))).toEqual({ shakes: 1, caught: false, critical: true });
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
    // Gyarados is a Water type: the Quick Ball (×5 on turn 1) first, the Net Ball (×3.5) next.
    expect(r.balls[0].ball).toBe("quick");
    expect(r.balls[1].ball).toBe("net");
    // A sleeping Caterpie at 1 HP: every ball is a sure catch, so the Poké Ball is best and the budget pick.
    const easy = rank({ ...DEFAULT_INPUTS, id: 10, game: "sv", level: 3, hp: 1, status: "sleep" });
    expect(easy.best.ball).toBe("poke");
    expect(easy.best.chance).toBe(1);
    expect(easy.budget?.ball).toBe("poke");
  });

  it("a link keeps every input and ignores nonsense", () => {
    const i = { ...DEFAULT_INPUTS, id: 150, game: "hgss" as const, level: 70, hp: 42, status: "paralysis" as const, turn: 4, dark: true, water: true, fishing: true, caught: true, yourLevel: 64, loveMatch: true, dex: 412, charm: true, darkGrass: true, power: 2, offGuard: true, badges: 3 };
    expect(decodeInputs(new URLSearchParams(encodeInputs(i)))).toEqual(i);
    expect(decodeInputs(new URLSearchParams(encodeInputs(DEFAULT_INPUTS)))).toEqual(DEFAULT_INPUTS);
    expect(decodeInputs({ p: "99999", g: "zz", l: "0", hp: "-3", s: "sad", t: "abc", dex: "5000", pow: "9", b: "12" })).toEqual(DEFAULT_INPUTS);
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
      expect(t("results.crit", { pct: "3.1%" })).toContain("3.1%");
      expect(t("trainer.blocked", { badges: 2, max: 30 })).toMatch(/2.*30/);
      expect(t("trainer.badgePenalty", { n: "0.51" })).toContain("0.51");
      expect(t("trainer.powerLv", { n: 3 })).toContain("3");
      expect(tp("metaSharedTitle", { name: "Gyarados", pct: "42%", ball: "Net Ball" })).toContain("Gyarados");
      if (locale !== "en") expect(t("throw.go")).not.toBe("Throw");
    }
  });
});
