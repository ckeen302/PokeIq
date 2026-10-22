import { describe, expect, it } from "vitest";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import * as lib from "@smogon/calc/dist/adaptable";
import { coverageChart, defensiveMultiplier, memberTyping, multiplierLabel } from "@/lib/battle/coverage";
import { applySpread, candidateNatures, optimizeSpread, speedEvsFor, speedWith, survives } from "@/lib/battle/ev-goals";
import { POKEPASTE_MAX_BYTES, pokepasteId, pokepasteRawUrl } from "@/lib/battle/pokepaste";
import { koShare, matchupLine, threatReports } from "@/lib/battle/threats";
import { completeSet, type PartialSet } from "@/lib/battle/sets";
import { loadUsage, parseSpread, popularSets, speedBenchmarks, USAGE_FORMATS } from "@/lib/battle/usage";

const gens = new Generations(Dex);
const gen9 = gens.get(9);
const calc = { gen: gen9, lib };

const set = (s: PartialSet) => completeSet(s);

describe("coverage chart", () => {
  it("counts weaknesses, resistances and immunities, with abilities", () => {
    const team = [
      set({ species: "Heatran", ability: "Flash Fire", moves: ["Magma Storm", "Earth Power"] }),
      set({ species: "Rotom-Wash", ability: "Levitate", moves: ["Hydro Pump", "Volt Switch"] }),
      set({ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake", "Scale Shot"] }),
    ];
    const chart = coverageChart(gen9, team);
    expect(chart.types).toHaveLength(18);
    const row = (t: string) => chart.rows.find((r) => r.type === t)!;
    // Ground: Heatran 4×, Rotom-Wash immune (Levitate), Garchomp neutral.
    expect(row("Ground").taken).toEqual([4, 0, 1]);
    expect(row("Ground").weak).toBe(1);
    expect(row("Ground").immune).toBe(1);
    // Fire: Heatran immune (Flash Fire) not resisted; Rotom-Wash resists; Garchomp resists.
    expect(row("Fire").taken).toEqual([0, 0.5, 0.5]);
    expect(row("Fire").immune).toBe(1);
    expect(row("Fire").resist).toBe(2);
    // Electric: Garchomp is immune by type.
    expect(row("Electric").taken[2]).toBe(0);
    // Offence: Earthquake and Earth Power hit Steel super-effectively.
    expect(row("Steel").superEffective).toBe(2);
    expect(row("Dragon").hitters).toEqual(["Garchomp: Scale Shot"]);
    expect(row("Flying").best).toBe(2); // Volt Switch
    expect(chart.notes).toContain("Heatran: Flash Fire: immune to Fire");
  });

  it("Thick Fat halves, Tera type replaces the typing and Tera Blast takes it", () => {
    const snorlax = set({ species: "Snorlax", ability: "Thick Fat", teraType: "Ghost", moves: ["Tera Blast", "Body Slam"] });
    expect(defensiveMultiplier(gen9, memberTyping(gen9, snorlax, false)!, "Fire")).toBe(0.5);
    expect(defensiveMultiplier(gen9, memberTyping(gen9, snorlax, false)!, "Fighting")).toBe(2);
    expect(defensiveMultiplier(gen9, memberTyping(gen9, snorlax, true)!, "Fighting")).toBe(0);
    const withTera = coverageChart(gen9, [snorlax], { tera: true });
    expect(withTera.rows.find((r) => r.type === "Psychic")!.dealt[0]).toBe(2); // Ghost Tera Blast
    const without = coverageChart(gen9, [snorlax]);
    expect(without.rows.find((r) => r.type === "Psychic")!.dealt[0]).toBe(1);
  });

  it("uses the generation's own types and chart", () => {
    expect(coverageChart(gens.get(1), [set({ species: "Gengar", moves: ["Psychic"] })]).types).toHaveLength(15);
    // Gen 1: Ghost doesn't affect Psychic.
    const gengar = coverageChart(gens.get(1), [set({ species: "Gengar", moves: ["Night Shade"] })]);
    expect(gengar.rows.find((r) => r.type === "Psychic")!.dealt[0]).toBe(0);
    expect(multiplierLabel(0.25)).toBe("¼");
    expect(multiplierLabel(4)).toBe("4×");
  });
});

describe("EV optimiser", () => {
  const ferro = set({ species: "Toxapex", ability: "Regenerator", item: "Leftovers", nature: "Relaxed", moves: ["Gyro Ball", "Leech Seed"] });
  const chomp = set({ species: "Garchomp", ability: "Rough Skin", nature: "Jolly", evs: { atk: 252, spe: 252, hp: 4 }, moves: ["Earthquake"] });

  it("finds the cheapest bulk that survives every roll, and checks it", () => {
    const blissey = set({ species: "Blissey", ability: "Natural Cure", nature: "Calm", moves: ["Seismic Toss", "Soft-Boiled"] });
    const attacker = set({ species: "Kingambit", ability: "Supreme Overlord", nature: "Adamant", evs: { atk: 252 }, moves: ["Kowtow Cleave"] });
    const result = optimizeSpread(calc, blissey, [{ kind: "survive", attacker, move: "Kowtow Cleave" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The answer survives; 4 fewer EVs in the stat it chose would not (minimal on that axis).
    expect(survives(calc, blissey, result.nature, result.evs, { kind: "survive", attacker, move: "Kowtow Cleave" }).survives).toBe(true);
    expect(result.used).toBe(result.evs.hp + result.evs.def + result.evs.spd + result.evs.spe);
    expect(result.remaining).toBe(510 - result.used);
    if (result.evs.def >= 4) {
      const less = { ...result.evs, def: result.evs.def - 4 };
      expect(survives(calc, blissey, result.nature, less, { kind: "survive", attacker, move: "Kowtow Cleave" }).survives).toBe(false);
    }
    expect(result.checks[0].detail).toMatch(/^Takes [\d.]+–[\d.]+% from Kingambit's Kowtow Cleave$/);
  });

  it("outspeeds with the fewest Speed EVs", () => {
    const target = speedWith(gen9, chomp, "Jolly", 252); // 333
    const tusk = set({ species: "Great Tusk", ability: "Protosynthesis", nature: "Jolly", moves: ["Headlong Rush"] });
    const ev = speedEvsFor(gen9, tusk, "Jolly", 280)!;
    expect(speedWith(gen9, tusk, "Jolly", ev)).toBeGreaterThan(280);
    expect(speedWith(gen9, tusk, "Jolly", ev - 4)).toBeLessThanOrEqual(280);
    const result = optimizeSpread(calc, tusk, [{ kind: "outspeed", speed: 280, label: "280" }]);
    expect(result.ok && result.evs.spe).toBe(ev);
    expect(target).toBe(333);
  });

  it("says when a goal is impossible", () => {
    const speed = optimizeSpread(calc, ferro, [{ kind: "outspeed", speed: 333, label: "Garchomp (Jolly 252 Spe)" }]);
    expect(speed.ok).toBe(false);
    if (!speed.ok) expect(speed.reason).toMatch(/^Impossible: Toxapex reaches \d+ Speed at most, and Garchomp \(Jolly 252 Spe\) has 333\.$/);
    const pult = set({ species: "Heatran", nature: "Timid", moves: ["Magma Storm"] });
    const kyogre = set({ species: "Kyogre", ability: "Drizzle", item: "Choice Specs", nature: "Modest", evs: { spa: 252 }, moves: ["Water Spout"] });
    const nuke = optimizeSpread(calc, pult, [{ kind: "survive", attacker: kyogre, move: "Water Spout" }], {
      gameType: "Singles",
      weather: "Rain",
      terrain: "",
      crit: false,
      flags: {},
    });
    expect(nuke.ok).toBe(false);
    if (!nuke.ok) expect(nuke.reason).toMatch(/Even with 252 HP \/ 252 SpD EVs, Kyogre's Water Spout does up to [\d.]+% to Heatran\./);
    expect(optimizeSpread(calc, ferro, []).ok).toBe(false);
    expect(optimizeSpread({ gen: gens.get(2), lib }, ferro, [{ kind: "outspeed", speed: 1, label: "x" }]).ok).toBe(false);
  });

  it("only suggests natures that lower an attacking stat the set doesn't use", () => {
    const natures = candidateNatures(gen9, ferro);
    expect(natures).toContain("Relaxed");
    expect(natures).toContain("Impish"); // +Def −SpA: no special moves
    expect(natures).not.toContain("Bold"); // −Atk: Gyro Ball is physical
  });

  it("applies goal EVs over the set's own, within 510", () => {
    const applied = applySpread(chomp, "Jolly", { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 });
    expect(applied.evs.hp + applied.evs.atk + applied.evs.spe).toBeLessThanOrEqual(510);
    expect(applied.evs.hp).toBe(252);
    expect(applied.evs.spe).toBe(252);
    expect(applied.evs.atk).toBe(4);
  });
});

describe("pokepaste links", () => {
  const id = "5c46f9ec443664cb";
  it("accepts pokepast.es paste links in their usual shapes", () => {
    for (const input of [`https://pokepast.es/${id}`, `https://pokepast.es/${id}/raw`, `pokepast.es/${id}`, `http://pokepast.es/${id}/`, ` https://POKEPAST.ES/${id.toUpperCase()} `]) {
      expect(pokepasteId(input)).toBe(id);
    }
    expect(pokepasteRawUrl(id)).toBe(`https://pokepast.es/${id}/raw`);
    expect(POKEPASTE_MAX_BYTES).toBeLessThanOrEqual(64 * 1024);
  });

  it("refuses every other host, path, port, credential and scheme", () => {
    for (const input of [
      `https://evil.com/${id}`,
      `https://pokepast.es.evil.com/${id}`,
      `https://evil.com/?u=pokepast.es/${id}`,
      `https://user@pokepast.es/${id}`,
      `https://pokepast.es:8080/${id}`,
      `https://pokepast.es/${id}/json`,
      `https://pokepast.es/${id}?x=1`,
      `https://pokepast.es/${id}#raw`,
      `https://pokepast.es/create`,
      `https://pokepast.es/${id.slice(1)}`,
      `ftp://pokepast.es/${id}`,
      `javascript:alert(1)`,
      `file:///etc/passwd`,
      `https://127.0.0.1/${id}`,
      "",
    ]) {
      expect(pokepasteId(input), input).toBeNull();
    }
    expect(() => pokepasteRawUrl("../etc")).toThrow();
  });
});

describe("usage data", () => {
  it("has a file for every listed format, most used first", async () => {
    for (const format of USAGE_FORMATS) {
      const file = await loadUsage(format);
      expect(file.format).toBe(format);
      expect(file.pokemon.length).toBeGreaterThan(20);
      expect(file.pokemon[0].usage).toBeGreaterThanOrEqual(file.pokemon[1].usage);
    }
  });

  it("builds popular sets and speed benchmarks from the numbers", async () => {
    const file = await loadUsage("gen9ou");
    const mon = file.pokemon[0];
    const sets = popularSets(mon, { level: 100, tera: true, isStatus: (m) => gen9.moves.get(m)?.category === "Status" });
    expect(sets.length).toBeGreaterThan(0);
    expect(sets[0].set.species).toBe(mon.species);
    expect(sets[0].set.moves.length).toBeLessThanOrEqual(4);
    expect(sets[0].set.ability).toBe(mon.abilities[0][0]);
    const base = gen9.species.get(mon.species)!.baseStats.spe;
    const speeds = speedBenchmarks(mon, base, 100);
    expect(speeds.length).toBeGreaterThan(0);
    expect(speeds[0].speed).toBeGreaterThanOrEqual(speeds[speeds.length - 1].speed);
    expect(parseSpread("Jolly:0/252/4/0/0/252")).toEqual({ nature: "Jolly", evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } });
    expect(parseSpread("nonsense")).toBeNull();
  });

  it("leaves status moves out of Choice sets", () => {
    const mon = {
      species: "Garchomp",
      usage: 0.1,
      abilities: [["Rough Skin", 1]] as [string, number][],
      items: [["Choice Scarf", 1]] as [string, number][],
      moves: [["Stealth Rock", 0.9], ["Earthquake", 0.9], ["Outrage", 0.8], ["Stone Edge", 0.5], ["Swords Dance", 0.4], ["Fire Fang", 0.3]] as [string, number][],
      spreads: [["Jolly:0/252/0/0/4/252", 1]] as [string, number][],
      teraTypes: [] as [string, number][],
    };
    const [only] = popularSets(mon, { level: 100, tera: false, isStatus: (m) => gen9.moves.get(m)?.category === "Status" });
    expect(only.set.moves).toEqual(["Earthquake", "Outrage", "Stone Edge", "Fire Fang"]);
    expect(only.label).toBe("Choice Scarf · Jolly 252 Atk / 4 SpD / 252 Spe");
  });
});

describe("threats", () => {
  it("flags a threat no member survives or outspeeds and OHKOs, and says why", () => {
    const kyogre = set({ species: "Kyogre", ability: "Drizzle", item: "Choice Specs", nature: "Modest", evs: { spa: 252, spe: 252 }, moves: ["Water Spout", "Thunder"] });
    const coal = set({ species: "Coalossal", ability: "Steam Engine", nature: "Hardy", moves: ["Flamethrower"] });
    const [report] = threatReports(calc, [coal], [{ set: kyogre, label: "test", usage: 0.5 }]);
    expect(report.struggles).toBe(true);
    expect(report.matchups[0].survives).toBe(false);
    expect(report.matchups[0].takes?.move).toBe("Water Spout");
    expect(matchupLine(report.matchups[0])).toMatch(/^Coalossal: takes [\d.]+–[\d.]+% from Water Spout; does [\d.]+–[\d.]+% back with Flamethrower, slower$/);
    const pex = set({ species: "Toxapex", ability: "Regenerator", nature: "Calm", evs: { hp: 252, spd: 252 }, moves: ["Surf"] });
    const [ok] = threatReports(calc, [coal, pex], [{ set: { ...kyogre, item: "" }, label: "test", usage: 0.5 }]);
    expect(ok.matchups[1].survives).toBe(true);
    expect(ok.struggles).toBe(false);
    expect(koShare([90, 95, 100, 105], 100)).toBe(0.5);
  });
});
