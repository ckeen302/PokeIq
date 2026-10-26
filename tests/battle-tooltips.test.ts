import { describe, expect, it } from "vitest";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import * as lib from "@smogon/calc/dist/adaptable";
import { calcStat, moveDamage, solveSpread, statRange, type FieldMon, type FieldState } from "@/lib/battle/tooltip-calc";
import type { StatsTable } from "@/lib/battle/sets";

const gens = new Generations(Dex);
const calc = (n = 9) => ({ gen: gens.get(n), lib });
type CalcGen = Parameters<typeof lib.calculate>[0];
const g = (n = 9) => gens.get(n) as unknown as CalcGen;

const noField: FieldState = { doubles: false, weather: "", terrain: "", pseudo: [], attacker: [], defender: [] };

/** A Pokémon's exact stats as the simulator's request would list them. */
function statsOf(p: lib.Pokemon): Partial<StatsTable> {
  return { ...p.rawStats };
}

describe("tooltip damage ranges", () => {
  it("match @smogon/calc for your own Pokémon from its exact stats", () => {
    const chomp = new lib.Pokemon(g(), "Garchomp", { level: 100, nature: "Jolly", evs: { atk: 252, def: 4, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } });
    const tran = new lib.Pokemon(g(), "Heatran", { level: 100, nature: "Hardy", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } });
    const me: FieldMon = { species: "Garchomp", level: 100, hpPercent: 100, boosts: {}, status: "", terastallized: false, stats: statsOf(chomp) };
    const foe: FieldMon = { species: "Heatran", level: 100, hpPercent: 100, boosts: {}, status: "", terastallized: false };
    for (const move of ["Earthquake", "Dragon Claw", "Stone Edge"]) {
      const ours = moveDamage(calc(), move, me, foe, noField, false)!;
      const theirs = lib.calculate(g(), chomp, tran, new lib.Move(g(), move));
      expect(ours.damage[1]).toEqual(theirs.range()[1]);
    }
  });

  it("count the battle's boosts, status, items, weather, terrain and screens", () => {
    const pult = new lib.Pokemon(g(), "Dragapult", { level: 100, nature: "Timid", evs: { spa: 252, spd: 4, spe: 252 }, boosts: { spa: 2 }, item: "Choice Specs" as never });
    const field = new lib.Field({ weather: "Rain", terrain: "Electric", defenderSide: { isLightScreen: true } });
    const target = new lib.Pokemon(g(), "Corviknight", { level: 100, nature: "Hardy", evs: {}, boosts: { spd: -1 }, status: "brn", curHP: 0 });
    const me: FieldMon = { species: "Dragapult", level: 100, hpPercent: 100, boosts: { spa: 2 }, status: "", item: "Choice Specs", terastallized: false, stats: statsOf(new lib.Pokemon(g(), "Dragapult", { level: 100, nature: "Timid", evs: { spa: 252, spd: 4, spe: 252 } })) };
    const foe: FieldMon = { species: "Corviknight", level: 100, hpPercent: 100, boosts: { spd: -1 }, status: "brn", terastallized: false };
    const state: FieldState = { ...noField, weather: "Rain", terrain: "Electric", defender: [{ id: "lightscreen", level: 1 }] };
    for (const move of ["Thunderbolt", "Hydro Pump", "Draco Meteor"]) {
      const ours = moveDamage(calc(), move, me, foe, state, false)!;
      const theirs = lib.calculate(g(), pult, target, new lib.Move(g(), move), field);
      expect(ours.damage[1], move).toEqual(theirs.range()[1]);
    }
  });

  it("use the random-battle spread for a random battle's foe, and Tera", () => {
    const lv = 84;
    const atk = new lib.Pokemon(g(), "Kingambit", { level: lv, nature: "Hardy", evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 }, teraType: "Dark" });
    const def = new lib.Pokemon(g(), "Gholdengo", { level: 79, nature: "Hardy", evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 } });
    const me: FieldMon = { species: "Kingambit", level: lv, hpPercent: 100, boosts: {}, status: "", teraType: "Dark", terastallized: true, stats: statsOf(atk) };
    const foe: FieldMon = { species: "Gholdengo", level: 79, hpPercent: 100, boosts: {}, status: "", terastallized: false };
    const ours = moveDamage(calc(), "Kowtow Cleave", me, foe, noField, true)!;
    expect(ours.damage).toEqual(lib.calculate(g(), atk, def, new lib.Move(g(), "Kowtow Cleave")).range());
  });

  it("work on the battle's generation", () => {
    const a = new lib.Pokemon(g(4), "Garchomp", { level: 100, nature: "Adamant", evs: { atk: 252, spe: 252, hp: 4 } });
    const d = new lib.Pokemon(g(4), "Skarmory", { level: 100, nature: "Hardy", evs: {} });
    const me: FieldMon = { species: "Garchomp", level: 100, hpPercent: 100, boosts: {}, status: "", terastallized: false, stats: statsOf(a) };
    const foe: FieldMon = { species: "Skarmory", level: 100, hpPercent: 100, boosts: {}, status: "", terastallized: false };
    expect(moveDamage(calc(4), "Fire Fang", me, foe, noField, false)!.damage[1]).toEqual(lib.calculate(g(4), a, d, new lib.Move(g(4), "Fire Fang")).range()[1]);
  });

  it("cover every plausible foe spread outside random battles, labelled", () => {
    const a = new lib.Pokemon(g(), "Garchomp", { level: 100, nature: "Jolly", evs: { atk: 252, spe: 252 } });
    const me: FieldMon = { species: "Garchomp", level: 100, hpPercent: 100, boosts: {}, status: "", terastallized: false, stats: statsOf(a) };
    const foe: FieldMon = { species: "Heatran", level: 100, hpPercent: 100, boosts: {}, status: "", terastallized: false };
    const frail = new lib.Pokemon(g(), "Heatran", { nature: "Hardy", evs: {} });
    const bulky = new lib.Pokemon(g(), "Heatran", { nature: "Bold", evs: { hp: 252, def: 252 } });
    const ours = moveDamage(calc(), "Earthquake", me, foe, noField, false)!;
    expect(ours.damage).toEqual([lib.calculate(g(), a, bulky, new lib.Move(g(), "Earthquake")).range()[0], lib.calculate(g(), a, frail, new lib.Move(g(), "Earthquake")).range()[1]]);
    expect(ours.spreadNote).toMatch(/Spread unknown/);
    // Special moves are measured against Sp. Def bulk.
    const special = moveDamage(calc(), "Draco Meteor", me, foe, noField, false)!;
    const calm = new lib.Pokemon(g(), "Heatran", { nature: "Calm", evs: { hp: 252, spd: 252 } });
    expect(special.damage[0]).toBe(lib.calculate(g(), a, calm, new lib.Move(g(), "Draco Meteor")).range()[0]);
    // Random battles know the spread: a single exact range, no note.
    expect(moveDamage(calc(), "Earthquake", me, foe, noField, true)!.spreadNote).toBeUndefined();
  });
});

describe("stats", () => {
  it("finds the spread behind exact stats, and the possible range", () => {
    const base = Dex.species.get("Garchomp").baseStats as StatsTable;
    const stats = { hp: calcStat("hp", base.hp, 100, 31, 0), atk: calcStat("atk", base.atk, 100, 31, 252, 1.1), spe: calcStat("spe", base.spe, 100, 31, 252) };
    const spread = solveSpread(base, 100, stats)!;
    for (const s of ["hp", "atk", "spe"] as const) {
      const nat = spread.nature;
      const mult = nat === "Adamant" || nat === "Lonely" || nat === "Brave" || nat === "Naughty" ? (s === "atk" ? 1.1 : 1) : 1;
      expect(calcStat(s, base[s], 100, spread.ivs[s], spread.evs[s], mult)).toBe(stats[s]);
    }
    expect(statRange("spe", base.spe, 100)).toEqual([188, 333]);
    expect(statRange("hp", base.hp, 100)).toEqual([326, 420]);
  });
});
