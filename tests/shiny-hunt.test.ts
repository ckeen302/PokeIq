import { describe, expect, it } from "vitest";
import { BDSP_RADAR, GAMES, chainRolls, charmApplies, dexNavCheck, getMethod, shinyChance, totalRolls, NO_BONUS, type OddsInput } from "@/lib/shiny-hunt/odds";
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

/*
 * Every figure below is checked against at least two independent sources, cited by the test that uses it. Short names:
 *  BP-SHINY   https://bulbapedia.bulbagarden.net/wiki/Shiny_Pok%C3%A9mon (its "Shiny Pokémon rates" table and per-generation sections)
 *  BP-CHARM   https://bulbapedia.bulbagarden.net/wiki/Shiny_Charm
 *  BP-MASUDA  https://bulbapedia.bulbagarden.net/wiki/Masuda_method
 *  BP-BREED   https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_breeding#Shiny_Pok.C3.A9mon
 *  BP-RADAR   https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9_Radar
 *  BP-DEXNAV  https://bulbapedia.bulbagarden.net/wiki/DexNav#Shiny_probability
 *  BP-SAFARI  https://bulbapedia.bulbagarden.net/wiki/Friend_Safari
 *  BP-AURA    https://bulbapedia.bulbagarden.net/wiki/Brilliant_Pok%C3%A9mon
 *  3DSRNG     https://github.com/wwwwwwzx/3DSRNGTool (commit ae5d1762), the Gen 6–7 RNG tool built from the games' code
 */
describe("shiny odds (the published figures)", () => {
  it("base rates: 1/8192 through Gen 5, 1/4096 from X and Y", () => {
    // pokecrystal engine/gfx/color.asm CheckShininess (Def, Spd, Spc DV = 10, Atk DV & 2: 1/2 × 1/16³ = 1/8192)
    //   https://github.com/pret/pokecrystal/blob/master/engine/gfx/color.asm
    // pokeemerald / pokefirered SHINY_ODDS 8 (of 65536) https://github.com/pret/pokeemerald/blob/master/include/constants/pokemon.h
    // pokeplatinum Pokemon_InlineIsPersonalityShiny (< 8) https://github.com/pret/pokeplatinum/blob/main/src/pokemon.c
    // BP-SHINY "Generation III onwards" (threshold 8, then 16 from Gen 6); Serebii https://www.serebii.net/games/shiny.shtml
    for (const g of ["gsc", "rse", "frlg", "dppt", "hgss", "bw", "b2w2"] as const) expect(odds(g, "wild")).toBe(8192);
    for (const g of ["xy", "oras", "sm", "usum", "swsh", "bdsp", "pla", "sv", "za"] as const) expect(odds(g, "wild")).toBe(4096);
  });
  it("Shiny Charm: 2 extra rolls (3 in Legends: Arceus and Z-A); none for BD/SP's wild Pokémon", () => {
    // B2W2: PokeFinder Core/Gen5/Generators/WildGenerator5.cpp (shinyRolls += 2) https://github.com/Admiral-Fish/PokeFinder ; BP-CHARM
    expect(odds("b2w2", "wild", { charm: true })).toBe(2731);
    // SV: Serebii https://www.serebii.net/scarletviolet/shinypokemon.shtml (3 in 4096) ; BP-SHINY Gen IX table
    expect(odds("sv", "wild", { charm: true })).toBe(1366);
    // Z-A: PKHeX Legality/Encounters/Templates/Gen9a/EncounterSlot9a.cs (ShinyCharm = 3) https://github.com/kwsch/PKHeX ;
    // Serebii https://www.serebii.net/legendsz-a/shinypokemon.shtml (1 in 1,024.38)
    expect(odds("za", "wild", { charm: true })).toBe(1024);
    // BD/SP: Serebii https://www.serebii.net/brilliantdiamondshiningpearl/shinypokemon.shtml ("does not work on wild
    // encounters"); BP-CHARM ("only affects breeding"); PokeFinder Core/Gen8/Generators/WildGenerator8.cpp (one PID, no rerolls)
    expect(odds("bdsp", "wild", { charm: true })).toBe(4096);
  });
  it("eggs without the Masuda method", () => {
    // Gen 3–5: base rate (BP-BREED); B2W2 charm: initial PID + 2 rerolls (PokeFinder Core/Gen5/Generators/EggGenerator5.cpp; BP-BREED)
    expect(odds("rse", "eggs")).toBe(8192);
    expect(odds("b2w2", "eggs", { charm: true })).toBe(2731);
    // Gen 6 on: with the charm the egg's own PID is replaced by 2 rolls, so 2/4096. Gen 6–7: 3DSRNG Core/EggRNG.cs
    // (PID_Rerollcount += 2 / += 6) and MainForm.cs (the main-RNG PID is used only without charm or Masuda). Gen 8–9:
    // PokeFinder Core/Gen8/Generators/EggGenerator8.cpp (pidRolls 2/6/8, BD/SP), Admiral-Fish RNGWriteups "Gen 8/Egg
    // Generation.md" step 13 https://github.com/Admiral-Fish/RNGWriteups/blob/master/Gen%208/Egg%20Generation.md, BP-BREED and BP-CHARM.
    for (const g of ["xy", "oras", "sm", "usum", "swsh", "bdsp", "sv"] as const) {
      expect(odds(g, "eggs")).toBe(4096);
      expect(odds(g, "eggs", { charm: true })).toBe(2048);
    }
  });
  it("Masuda method", () => {
    // Gen 4: 1 + 4 rerolls. pokeplatinum src/overlay005/daycare.c Egg_SetInitialData; pokeheartgold src/get_egg.c
    // SetBreedEggStats (for i < 4); BP-MASUDA (5/8192). (Serebii's general page still says 1 in 2,048 for Gen 4: outdated.)
    expect(odds("dppt", "masuda")).toBe(1639);
    expect(odds("hgss", "masuda")).toBe(1639);
    // Gen 5: 6/8192; with the charm 8/8192. PokeFinder EggGenerator5.cpp (masuda 5, charm 2 rerolls); BP-MASUDA.
    expect(odds("bw", "masuda")).toBe(1366);
    expect(odds("b2w2", "masuda", { charm: true })).toBe(1024);
    // Gen 6–9: 6/4096, 8/4096 with the charm. 3DSRNG Core/EggRNG.cs; PokeFinder EggGenerator8.cpp; BP-MASUDA;
    // Serebii SV/SwSh/BDSP shiny pages (1 in 682.7 / 1 in 512).
    expect(odds("xy", "masuda")).toBe(683);
    expect(odds("sv", "masuda")).toBe(683);
    expect(odds("swsh", "masuda", { charm: true })).toBe(512);
    expect(odds("bdsp", "masuda", { charm: true })).toBe(512);
  });
  it("Gen 2: an egg that inherits a shiny parent's DVs is 1 in 64", () => {
    // pokecrystal engine/events/daycare.asm (Defense DV copied, Special DV's low 3 bits copied, the rest random):
    // 1/2 (Atk) × 1/16 (Spd) × 1/2 (Spc) https://github.com/pret/pokecrystal/blob/master/engine/events/daycare.asm ; BP-SHINY, BP-BREED
    expect(odds("gsc", "breeding")).toBe(64);
  });
  it("Poké Radar: Diamond, Pearl and Platinum", () => {
    // pokeplatinum src/pokeradar.c CheckPatchShiny: LCRNG_RandMod(max(200, 8200 − 200·chain)) == 0, and
    // include/inlines.h LCRNG_RandMod (0 when the 16-bit value < ⌊0xFFFF/n⌋ + 1); BP-RADAR "Shiny probability"
    // (⌈65535 / (8200 − 200·chain)⌉ / 65536: 9 at a chain of 1, 10 at 5, 328 at 40). A patch that fails is still
    // generated normally (src/overlay006/wild_encounters.c CreateWildMon_FromRadarKeepChain), so 1/8192 is added.
    const at = (chain: number) => shinyChance("dppt", "pokeRadar", { ...NO_BONUS, chain });
    const forced = (n: number) => (at(n) - 1 / 8192) / (1 - 1 / 8192);
    expect(at(0)).toBeCloseTo(1 / 8192, 12);
    expect(forced(1) * 65536).toBeCloseTo(9, 6);
    expect(forced(5) * 65536).toBeCloseTo(10, 6);
    expect(forced(40) * 65536).toBeCloseTo(328, 6);
    expect(odds("dppt", "pokeRadar", { chain: 40 })).toBe(195);
    expect(odds("dppt", "pokeRadar", { chain: 400 })).toBe(195);
    expect(charmApplies(getMethod("dppt", "pokeRadar")!)).toBe(false);
  });
  it("Poké Radar: X and Y", () => {
    // 3DSRNG Gen6/PokeRadar.cs (Chance = chain ≥ 40 ? 100 : 8100 − 200·chain); BP-RADAR "Pokémon X and Y" (1/8100 down
    // to 1/100 at 40; a chained patch that fails is forced not to be shiny; the Shiny Charm doesn't apply)
    expect(odds("xy", "pokeRadar", { chain: 1 })).toBe(7900);
    expect(odds("xy", "pokeRadar", { chain: 35 })).toBe(1100);
    expect(odds("xy", "pokeRadar", { chain: 39 })).toBe(300);
    expect(odds("xy", "pokeRadar", { chain: 40, charm: true })).toBe(100);
    expect(odds("xy", "pokeRadar", { chain: 999 })).toBe(100);
  });
  it("Poké Radar: Brilliant Diamond and Shining Pearl", () => {
    // Serebii https://www.serebii.net/brilliantdiamondshiningpearl/shinypokemon.shtml and /pokeradar.shtml ; BP-RADAR
    // "Chain bonuses" (both from Anubis's datamine): 1 in 4096 at 0 … 1 in 99 from 40; the Shiny Charm doesn't apply.
    expect(BDSP_RADAR).toHaveLength(41);
    expect(odds("bdsp", "pokeRadar", { chain: 0 })).toBe(4096);
    expect(odds("bdsp", "pokeRadar", { chain: 16 })).toBe(2048);
    expect(odds("bdsp", "pokeRadar", { chain: 30 })).toBe(1310);
    expect(odds("bdsp", "pokeRadar", { chain: 39 })).toBe(200);
    expect(odds("bdsp", "pokeRadar", { chain: 40 })).toBe(99);
    expect(odds("bdsp", "pokeRadar", { chain: 120, charm: true })).toBe(99);
  });
  it("Grand Underground: the Diglett bonus doubles the Hideaway odds; no Shiny Charm", () => {
    // PokeFinder Core/Gen8/Generators/UndergroundGenerator.cpp (pidRolls = diglett ? 2 : 1, no charm);
    // Serebii BD/SP shiny page ("1 in 2048 compared to 1 in 4096"); BP-SHINY "Brilliant Diamond and Shining Pearl"
    expect(odds("bdsp", "underground")).toBe(4096);
    expect(odds("bdsp", "underground", { lure: true, charm: true })).toBe(2048);
  });
  it("Friend Safari: 5 rolls, 7 with the Shiny Charm", () => {
    // 3DSRNG MainForm.cs (FriendSafari: _PIDroll_count = 4) + Gen6/Wild6.cs (+= charm ? 3 : 1);
    // 3DSRNG wiki https://github.com/wwwwwwzx/3DSRNGTool/wiki/Friend-Safari-RNG ("~5/4096 … ~7/4096"); BP-SAFARI
    expect(odds("xy", "friendSafari")).toBe(820);
    expect(odds("xy", "friendSafari", { charm: true })).toBe(586);
  });
  it("DexNav: the Search Level formula, chains and the Shiny Charm", () => {
    // 3DSRNG Gen6/DexNav.cs (target 6·SL to 100, 2·SL + 400 to 200, SL + 600 above; Rand(10000) < target / 100;
    // checks 1, +2 charm, +4 boost on every 5th or 4% of the time, +5 on the 50th, +10 on the 100th); BP-DEXNAV (same
    // rules, ⌈target⌉ / 10000); Serebii https://www.serebii.net/omegarubyalphasapphire/dexnav.shtml tabulates the result
    // with the normal roll included, which these match.
    expect(dexNavCheck(0)).toBe(0);
    expect(dexNavCheck(16)).toBe(1 / 10000);
    expect(dexNavCheck(17)).toBe(2 / 10000);
    expect(dexNavCheck(100)).toBe(6 / 10000);
    expect(dexNavCheck(101)).toBe(7 / 10000);
    expect(dexNavCheck(200)).toBe(8 / 10000);
    expect(dexNavCheck(201)).toBe(9 / 10000);
    expect(dexNavCheck(999)).toBe(16 / 10000);
    const at = (level: number, chain: number, charm = false) => shinyChance("oras", "dexNav", { ...NO_BONUS, level, chain, charm });
    // Serebii, no charm: Search Level 0 → 1/4096; 1–16 on a multiple of 5 → 1/1344.23; 999 on the 50th → 1/62.01.
    expect(1 / at(0, 0)).toBeCloseTo(4096, 6);
    expect(1 / at(10, 4)).toBeCloseTo(1344.23, 1);
    expect(1 / at(999, 49)).toBeCloseTo(62.01, 1);
    // Serebii, charm: 1–16 unboosted 1/969.00, boosted 1/698.56, 50th 1/517.95; 999 on the 100th → 1/36.28.
    expect(1 / at(16, 9, true)).toBeCloseTo(698.56, 1);
    expect(1 / at(16, 49, true)).toBeCloseTo(517.95, 1);
    expect(1 / at(999, 99, true)).toBeCloseTo(36.28, 1);
    // An unlisted chain position: the 4% boost averaged in (Serebii's two columns, weighted 96 : 4).
    expect(at(5, 0, true)).toBeCloseTo(0.96 / 969.0 + 0.04 / 698.56, 7);
    expect(at(100, 12)).toBeCloseTo(0.96 / 1184.84 + 0.04 / 308.66, 7);
  });
  it("chain fishing, SOS chains and catch combos", () => {
    // Chain fishing: 3DSRNG MainForm.cs (_PIDroll_count = min(40, 2·chain)); BP-SHINY Gen VI ("41/4096 … at 20")
    const fishing = getMethod("xy", "chainFishing")!;
    expect(chainRolls(fishing, 0)).toBe(0);
    expect(chainRolls(fishing, 7)).toBe(14);
    expect(chainRolls(fishing, 50)).toBe(40);
    expect(odds("xy", "chainFishing", { chain: 20 })).toBe(100);
    expect(odds("oras", "chainFishing", { chain: 20, charm: true })).toBe(95.7);
    // SOS: 3DSRNG Gen7/SOSRNG.cs (PIDBonus = min(12, ⌊(chain − 1) / 10⌋ · 4)); Serebii
    // https://www.serebii.net/ultrasunultramoon/sosbattles.shtml (1/819.6 at 11–20, 1/315.54 at 31+); BP-SHINY Gen VII
    expect(odds("usum", "sos", { chain: 10 })).toBe(4096);
    expect(odds("usum", "sos", { chain: 15 })).toBe(820);
    expect(odds("usum", "sos", { chain: 31 })).toBe(316);
    expect(odds("sm", "sos", { chain: 40, charm: true })).toBe(274);
    // Sun and Moon keep the chain in 8 bits (BP-SHINY, https://bulbapedia.bulbagarden.net/wiki/SOS_Battle)
    expect(setOdds(setOdds(createHunt(1, "sm", 0), { method: "sos" }), { chain: 300 }).chain).toBe(255);
    // Catch combos: Serebii https://www.serebii.net/letsgopikachueevee/shinypokemon.shtml ; BP-SHINY Let's Go table
    expect(odds("lgpe", "catchCombo", { chain: 11 })).toBe(1024);
    expect(odds("lgpe", "catchCombo", { chain: 31 })).toBe(342);
    expect(odds("lgpe", "catchCombo", { chain: 31, lure: true, charm: true })).toBe(274);
  });
  it("Ultra Wormholes: by rings and distance", () => {
    // Serebii https://www.serebii.net/ultrasunultramoon/ultrawormholes.shtml (1 + k, 1 + 2k, 4k % with
    // k = min(9, distance / 500 − 1)); BP-SHINY "Pokémon Ultra Sun and Ultra Moon" table (1% … 10%, 19%, 36% at 5,000+)
    const pct = (rings: string, level: number) => Math.round(shinyChance("usum", "wormhole", { ...NO_BONUS, level, choices: { rings } }) * 1000) / 10;
    expect(pct("0", 9000)).toBe(1);
    expect(pct("1", 1000)).toBe(2);
    expect(pct("1", 1499)).toBe(2);
    expect(pct("2", 2500)).toBe(9);
    expect(pct("3", 2500)).toBe(16);
    expect(pct("3", 4999)).toBe(32);
    expect(pct("1", 5000)).toBe(10);
    expect(pct("2", 7000)).toBe(19);
    expect(pct("3", 5000)).toBe(36);
  });
  it("Sword/Shield: Brilliant Pokémon by Number Battled", () => {
    // BP-AURA and BP-SHINY "Pokémon Sword and Shield" (Anubis: 1–6 bonus rolls); Serebii
    // https://www.serebii.net/swordshield/shinypokemon.shtml (1 in 2048 at 1, 1 in 455.56 with the charm at 500)
    expect(odds("swsh", "brilliant", { choices: { battled: "1" } })).toBe(2048);
    expect(odds("swsh", "brilliant", { choices: { battled: "1" }, charm: true })).toBe(1024);
    expect(odds("swsh", "brilliant", { choices: { battled: "100" } })).toBe(1024);
    expect(odds("swsh", "brilliant", { choices: { battled: "300" }, charm: true })).toBe(512);
    expect(odds("swsh", "brilliant", { choices: { battled: "500" } })).toBe(586);
    expect(odds("swsh", "brilliant", { choices: { battled: "500" }, charm: true })).toBe(456);
  });
  it("Legends: Arceus research and outbreaks", () => {
    // PKHeX Saves/SAV8LA.cs GetShinyRolls (+1 level 10, +3 perfect, +3 charm); Serebii
    // https://www.serebii.net/legendsarceus/shinypokemon.shtml ; BP-SHINY Legends: Arceus table (outbreak +25, massive +12)
    expect(odds("pla", "wild", { choices: { research: "lv10" }, charm: true })).toBe(820);
    expect(odds("pla", "wild", { choices: { research: "perfect" }, charm: true })).toBe(586);
    expect(odds("pla", "outbreak")).toBe(158);
    expect(odds("pla", "outbreak", { choices: { research: "perfect" }, charm: true })).toBe(128);
    expect(odds("pla", "massiveOutbreak", { choices: { research: "lv10" } })).toBe(293);
    expect(odds("pla", "massiveOutbreak", { choices: { research: "perfect" }, charm: true })).toBe(216);
  });
  it("Scarlet/Violet outbreaks and Sparkling Power", () => {
    // Serebii https://www.serebii.net/scarletviolet/shinypokemon.shtml ; BP-SHINY Gen IX tables (+1 at 30, +2 at 60
    // cleared; +1/+2/+3 Sparkling Power; up to 8 rolls = 1/512.44)
    expect(odds("sv", "outbreak", { choices: { cleared: "30" } })).toBe(2048);
    expect(odds("sv", "outbreak", { choices: { cleared: "60" }, charm: true })).toBe(820);
    expect(odds("sv", "wild", { choices: { sparkling: "3" } })).toBe(1024);
    expect(odds("sv", "outbreak", { choices: { cleared: "60", sparkling: "3" }, charm: true })).toBe(512);
  });
  it("Legends: Z-A Hyperspace Lumiose and Sparkling Power", () => {
    // Serebii https://www.serebii.net/legendsz-a/shinypokemon.shtml (Lv. 1–3: 2, 3, 4 in 4096; 5, 6, 7 with the charm);
    // Rotom Labs https://rotomlabs.net/article/shiny-rates-for-legends-z-a-mega-dimension-dlc (Anubis's datamine, same
    // figures); PKHeX Gen9a/EncounterSlot9a.cs (ShinyHyperspace = 3 with a Shiny Power active, the Lv. 3 figure)
    expect(odds("za", "hyperspace")).toBe(4096);
    expect(odds("za", "hyperspace", { choices: { sparkling: "1" } })).toBe(2048);
    expect(odds("za", "hyperspace", { choices: { sparkling: "2" }, charm: true })).toBe(683);
    expect(odds("za", "hyperspace", { choices: { sparkling: "3" }, charm: true })).toBe(586);
  });
  it("flat chances", () => {
    // Dynamax Adventures: BP-CHARM (3/300 with the charm, citing SciresM); Serebii SwSh shiny page (1 in 300 / 1 in 100);
    // Smogon https://www.smogon.com/ingame/guides/swsh_shiny_hunt
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
        for (const input of [NO_BONUS, { charm: true, lure: true, chain: 9999, level: 9999, choices: {} }]) {
          const p = shinyChance(g.id, m.id, input);
          expect(p).toBeGreaterThan(0);
          // The best is a 3-ring Ultra Wormhole at 5,000 light-years or more: 36%.
          expect(p).toBeLessThanOrEqual(m.id === "wormhole" ? 0.36 : 0.05);
        }
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
  it("carry the DexNav Search Level and the wormhole distance", () => {
    let h = setOdds(createHunt(359, "oras", 1), { method: "dexNav", charm: true, level: 420, chain: 37 });
    const a = decodeHunt(encodeHunt(h))!;
    expect(a).toMatchObject({ game: "oras", method: "dexNav", level: 420, chain: 37, charm: true });
    expect(shinyChance(a.game, a.method, a)).toBe(shinyChance(h.game, h.method, h));
    h = setOdds(createHunt(792, "usum", 1), { method: "wormhole", level: 5000, choices: { rings: "3" } });
    expect(decodeHunt(encodeHunt(h))).toMatchObject({ method: "wormhole", level: 5000, choices: { rings: "3" } });
    // A link without the field (made before it existed) reads as 0; a level on a method without one is rejected.
    expect(decodeHunt("1.359.8.dexNav.1.0.-.10.5.0.0")).toMatchObject({ level: 0 });
    expect(decodeHunt("1.6.f.wild.0.0.0.1.0.0.0.5")).toBeNull();
    expect(decodeHunt("1.359.8.dexNav.1.0.-.10.5.0.0.1000")).toBeNull();
  });
  it("rejects anything malformed", () => {
    for (const bad of [null, "", "x", "2.6.g.wild.0.0.-.1.0.0.0", "1.0.g.wild.0.0.-.1.0.0.0", "1.6.z.wild.0.0.-.1.0.0.0", "1.6.g.nope.0.0.-.1.0.0.0", "1.6.g.wild.0.0.9.1.0.0.0", "1.6.g.wild.0.0.-.1.0.0.12"]) {
      expect(decodeHunt(bad)).toBeNull();
    }
    expect(decodeHunt("1.6.f.wild.1.0.0.10.5.0.0")).toMatchObject({ species: 6, game: "sv", charm: true, count: 10 });
  });
});
