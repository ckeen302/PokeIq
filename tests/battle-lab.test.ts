import { describe, expect, it } from "vitest";
import { Teams } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import { completeSet, type TeamSet } from "@/lib/battle/sets";
import { battleSeed, cleanMasterSeed, newMasterSeed, strategyRandom } from "@/lib/battle/lab/seed";
import { decodeSetup, defaultSetup, emptySide, encodeSetup, labMon, normalizeSetup, setupJson, setupProblem } from "@/lib/battle/lab/setup";
import { LabSetupError, prepareLab, runLabBattle, runLabRange } from "@/lib/battle/lab/simulate";
import {
  addRecord,
  emptyTotals,
  histogramMedian,
  margin,
  mergeTotals,
  summaryLine,
  topMoves,
  wilson,
  type BattleRecord,
  type LabTotals,
} from "@/lib/battle/lab/stats";
import { EMPTY_SIDE_FIELD, LAB_GENS, type LabGen, type LabMon, type LabSetup, type LabStrategy } from "@/lib/battle/lab/types";

Teams.setGeneratorFactory(TeamGenerators);

const set = (species: string, extra: Partial<TeamSet> = {}) => completeSet({ species, ...extra });

function matchup(gen: LabGen, a: LabMon[], b: LabMon[], strategies: [LabStrategy, LabStrategy] = ["smart", "smart"], doubles = false): LabSetup {
  return {
    ...defaultSetup(),
    gen,
    doubles,
    sides: [
      { ...emptySide(), team: a, strategy: strategies[0] },
      { ...emptySide(), team: b, strategy: strategies[1] },
    ],
  };
}

/** Six random-battle sets for the generation, as Lab Pokémon. */
function randomTeam(gen: LabGen, seed: string, doubles = false): LabMon[] {
  const format = doubles && gen >= 8 ? `gen${gen}randomdoublesbattle` : `gen${gen}randombattle`;
  return Teams.generate(format, { seed: seed as never }).map((s) => labMon(set(s.species, { ...s, nature: s.nature || "" } as Partial<TeamSet>)));
}

describe("battle lab: seeds and reproducibility", () => {
  it("derives a distinct, stable simulator seed for every battle of a run", () => {
    expect(battleSeed("abc", 0)).toBe(battleSeed("abc", 0));
    expect(battleSeed("abc", 0)).not.toBe(battleSeed("abc", 1));
    expect(battleSeed("abc", 0)).not.toBe(battleSeed("abd", 0));
    const seeds = Array.from({ length: 10_000 }, (_, i) => battleSeed("run", i));
    expect(new Set(seeds).size).toBe(10_000);
    for (const s of seeds.slice(0, 50)) {
      const parts = s.split(",").map(Number);
      expect(parts).toHaveLength(4);
      for (const p of parts) expect(p >= 0 && p < 65_536 && Number.isInteger(p)).toBe(true);
    }
    const a = strategyRandom("run", 3, 0);
    const b = strategyRandom("run", 3, 0);
    const c = strategyRandom("run", 3, 1);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  it("makes and cleans master seeds", () => {
    expect(newMasterSeed()).toMatch(/^[a-z2-9]{8}$/);
    expect(newMasterSeed()).not.toBe(newMasterSeed());
    expect(cleanMasterSeed("  my seed! ")).toBe("myseed");
    expect(cleanMasterSeed("??")).toBeNull();
    expect(cleanMasterSeed("x".repeat(40))).toHaveLength(32);
  });

  it("the same master seed gives the same results, however the battles are split up", () => {
    const setup = defaultSetup();
    setup.sides[0].strategy = "random";
    setup.sides[1].strategy = "smart";
    const prep = prepareLab(setup);
    const whole = runLabRange(prep, "repro", 0, 60);
    // Two "workers", out of order.
    const late = runLabRange(prep, "repro", 35, 60);
    const early = runLabRange(prep, "repro", 0, 35);
    expect(mergeTotals(mergeTotals(emptyTotals(), late.totals), early.totals)).toEqual(whole.totals);
    expect([...early.outcomes, ...late.outcomes]).toEqual([...whole.outcomes]);
    // A fresh run with the same seed: identical. Another seed: different battles.
    expect(runLabRange(prepareLab(setup), "repro", 0, 60)).toEqual(whole);
    expect([...runLabRange(prep, "other", 0, 60).outcomes]).not.toEqual([...whole.outcomes]);
    // Any battle can be replayed on its own, with its log, and comes out the same.
    for (const i of [0, 17, 59]) {
      const replay = runLabBattle(prep, "repro", i, { log: true });
      expect(replay.record.outcome + 1).toBe(whole.outcomes[i]);
      expect(replay.log!.some((l) => l.startsWith("|win|") || l === "|tie")).toBe(true);
    }
  }, 30_000);
});

describe("battle lab: statistics", () => {
  it("Wilson score intervals match the textbook values", () => {
    const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(5e-4);
    const half = wilson(50, 100);
    close(half.p, 0.5);
    close(half.lo, 0.4038);
    close(half.hi, 0.5962);
    const one = wilson(1, 10);
    close(one.lo, 0.0179);
    close(one.hi, 0.4042);
    const none = wilson(0, 10);
    expect(none.lo).toBe(0);
    close(none.hi, 0.2775);
    const all = wilson(10, 10);
    expect(all.hi).toBe(1);
    close(all.lo, 0.7225);
    // Symmetric, inside [0, 1], narrowing as n grows.
    for (const [k, n] of [[3, 17], [632, 1000], [6321, 10_000]]) {
      const w = wilson(k, n);
      const flip = wilson(n - k, n);
      close(w.lo, 1 - flip.hi);
      expect(w.lo).toBeLessThanOrEqual(w.p);
      expect(w.hi).toBeGreaterThanOrEqual(w.p);
    }
    expect(margin(wilson(6321, 10_000))).toBeLessThan(margin(wilson(632, 1000)));
    close(margin(wilson(6321, 10_000)), 0.0094);
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it("medians come from the turn histogram", () => {
    expect(histogramMedian([0, 1, 1, 1])).toBe(2);
    expect(histogramMedian([0, 1, 0, 1])).toBe(2);
    expect(histogramMedian([0, 0, 0, 0, 5, 1])).toBe(4);
    expect(histogramMedian([])).toBe(0);
  });

  it("totals add up the same in any order, and read as one plain line", () => {
    const record = (outcome: 0 | 1 | 2, turns: number, extra: Partial<BattleRecord> = {}): BattleRecord => ({
      outcome,
      capped: false,
      broken: false,
      turns,
      winnerHp: outcome === 2 ? null : 40,
      kos: [[outcome === 0 ? 1 : 0], [outcome === 1 ? 1 : 0]],
      otherKos: [0, 0],
      critKo: [false, false],
      missed: [false, false],
      moves: [{ Pound: turns }, { Tackle: turns }],
      refused: 0,
      fallbacks: 0,
      ...extra,
    });
    const records = [record(0, 4), record(0, 5, { critKo: [true, false] }), record(1, 9, { missed: [true, false] }), record(2, 300, { capped: true }), record(0, 3)];
    const forward = records.reduce((t, r) => addRecord(t, r), emptyTotals());
    const backward = [...records].reverse().reduce((t, r) => addRecord(t, r), emptyTotals());
    expect(forward).toEqual(backward);
    const split = mergeTotals(
      records.slice(0, 2).reduce((t, r) => addRecord(t, r), emptyTotals()),
      records.slice(2).reduce((t, r) => addRecord(t, r), emptyTotals())
    );
    expect(split).toEqual(forward);
    expect(forward.wins).toEqual([3, 1]);
    expect(forward.draws).toBe(1);
    expect(forward.capped).toBe(1);
    expect(forward.critWins).toEqual([1, 0]);
    expect(forward.missLosses).toEqual([1, 0]);
    expect(forward.winnerHp[0][4]).toBe(3);
    expect(topMoves(forward, 0)[0]).toMatchObject({ move: "Pound", uses: 321 });
    expect(summaryLine(forward, ["Piplup", "Turtwig"])).toBe("Piplup wins 60.0% (± 32.6%) over 5 battles, 20.0% draws; median 5 turns.");
    const t: LabTotals = emptyTotals();
    expect(summaryLine(t, ["A", "B"])).toBe("No battles yet.");
  });
});

describe("battle lab: strategies always make legal choices", () => {
  const PAIRS: [LabStrategy, LabStrategy][] = [
    ["smart", "greedy"],
    ["random", "scripted"],
    ["greedy", "random"],
    ["scripted", "smart"],
  ];

  it("in singles, every generation", () => {
    for (const gen of LAB_GENS) {
      const totals = emptyTotals();
      PAIRS.forEach((pair, i) => {
        const setup = matchup(gen, randomTeam(gen, `${gen},1,${i},1`), randomTeam(gen, `${gen},2,${i},2`), pair);
        // Scripted sides get a script for some of their Pokémon.
        for (const side of setup.sides) if (side.strategy === "scripted") side.team.forEach((m, j) => (m.script = j % 2 ? [m.set.moves[1] ?? m.set.moves[0]] : [...m.set.moves].reverse()));
        mergeTotals(totals, runLabRange(prepareLab(setup), `legal-${gen}`, 0, 3).totals);
      });
      expect({ gen, refused: totals.refused, broken: totals.broken, fallbacks: totals.fallbacks }).toEqual({ gen, refused: 0, broken: 0, fallbacks: 0 });
      expect(totals.battles).toBe(12);
    }
  }, 240_000);

  it("in doubles", () => {
    for (const gen of [3, 5, 7, 8, 9] as LabGen[]) {
      const totals = emptyTotals();
      PAIRS.forEach((pair, i) => {
        const setup = matchup(gen, randomTeam(gen, `${gen},3,${i},3`, true), randomTeam(gen, `${gen},4,${i},4`, true), pair, true);
        mergeTotals(totals, runLabRange(prepareLab(setup), `legal-d${gen}`, 0, 2).totals);
      });
      expect({ gen, refused: totals.refused, broken: totals.broken, fallbacks: totals.fallbacks }).toEqual({ gen, refused: 0, broken: 0, fallbacks: 0 });
    }
  }, 240_000);

  it("Scripted plays its list in order; Greedy picks the hardest hit", () => {
    const tank = labMon(set("Blissey", { level: 100, moves: ["Soft-Boiled"] }));
    const scripted = labMon(set("Garchomp", { level: 60, moves: ["Swords Dance", "Earthquake", "Dragon Claw", "Protect"] }), ["Swords Dance", "Earthquake", "Protect"]);
    const setup = matchup(9, [scripted], [tank], ["scripted", "greedy"]);
    const out = runLabBattle(prepareLab(setup), "script", 0, { log: true });
    const used = out.log!.filter((l) => l.startsWith("|move|p1a:")).map((l) => l.split("|")[3]);
    expect(used.slice(0, 5)).toEqual(["Swords Dance", "Earthquake", "Protect", "Protect", "Protect"]);
    setup.sides[0].loop = true;
    const looped = runLabBattle(prepareLab(setup), "script", 0, { log: true });
    const again = looped.log!.filter((l) => l.startsWith("|move|p1a:")).map((l) => l.split("|")[3]);
    expect(again.slice(0, 5)).toEqual(["Swords Dance", "Earthquake", "Protect", "Swords Dance", "Earthquake"]);

    // Every strategy Mega Evolves the first time it can.
    for (const strategy of ["smart", "greedy", "random", "scripted"] as LabStrategy[]) {
      const mega = matchup(7, [labMon(set("Charizard", { item: "Charizardite X", moves: ["Flare Blitz", "Dragon Claw"] }))], [labMon(set("Snorlax", { moves: ["Body Slam"] }))], [strategy, "greedy"]);
      const log = runLabBattle(prepareLab(mega), "mega", 0, { log: true }).log!;
      expect(log.some((l) => l.startsWith("|-mega|p1a: Charizard|")), strategy).toBe(true);
    }

    // Greedy: Thunderbolt (super effective) over Tackle into Gyarados.
    const greedy = matchup(9, [labMon(set("Pikachu", { moves: ["Tackle", "Thunderbolt", "Growl"] }))], [labMon(set("Gyarados", { moves: ["Splash"] }))], ["greedy", "greedy"]);
    const g = runLabBattle(prepareLab(greedy), "greedy", 0, { log: true });
    expect(g.log!.filter((l) => l.startsWith("|move|p1a:")).every((l) => l.includes("|Thunderbolt|"))).toBe(true);
  });
});

describe("battle lab: matchups with a known answer", () => {
  it("a mirror match with the same strategy on both sides is a coin flip", () => {
    const chomp = () => labMon(set("Garchomp", { ability: "Rough Skin", nature: "Jolly", evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, moves: ["Earthquake", "Dragon Claw", "Stone Edge", "Swords Dance"] }));
    const { totals } = runLabRange(prepareLab(matchup(9, [chomp()], [chomp()])), "mirror", 0, 400);
    const ci = wilson(totals.wins[0], totals.wins[0] + totals.wins[1]);
    expect(ci.lo).toBeLessThan(0.5);
    expect(ci.hi).toBeGreaterThan(0.5);
    expect(Math.abs(ci.p - 0.5)).toBeLessThan(0.08);
  }, 60_000);

  it("swapping the sides swaps the odds (no bias toward Side A)", () => {
    const a = [labMon(set("Garchomp", { nature: "Jolly", evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, moves: ["Earthquake", "Dragon Claw", "Stone Edge", "Swords Dance"] }))];
    const b = [labMon(set("Rotom-Wash", { nature: "Bold", evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, moves: ["Hydro Pump", "Volt Switch", "Will-O-Wisp", "Pain Split"] }))];
    const one = runLabRange(prepareLab(matchup(9, a, b)), "swap", 0, 600).totals;
    const two = runLabRange(prepareLab(matchup(9, b, a)), "swap-2", 0, 600).totals;
    const p1 = wilson(one.wins[0], one.wins[0] + one.wins[1]);
    const p2 = wilson(two.wins[1], two.wins[0] + two.wins[1]);
    // Garchomp's odds as Side A and as Side B: the two intervals overlap.
    expect(p1.lo).toBeLessThan(p2.hi);
    expect(p2.lo).toBeLessThan(p1.hi);
  }, 120_000);

  it("the same seed reproduces a run exactly; a different seed doesn't", () => {
    const setup = matchup(9, randomTeam(9, "1,2,3,4"), randomTeam(9, "5,6,7,8"));
    const x = runLabRange(prepareLab(setup), "repro", 0, 40).totals;
    const y = runLabRange(prepareLab(setup), "repro", 0, 40).totals;
    const z = runLabRange(prepareLab(setup), "other", 0, 40).totals;
    expect(y).toEqual(x);
    expect(z).not.toEqual(x);
  }, 120_000);

  it("a faster, sure-hit one-hit KO wins every battle", () => {
    const fast = labMon(set("Garchomp", { nature: "Jolly", evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, moves: ["Earthquake"] }));
    const slow = labMon(set("Pikachu", { level: 5, moves: ["Thunderbolt"] }));
    const { totals } = runLabRange(prepareLab(matchup(9, [fast], [slow])), "ohko", 0, 300);
    expect(totals.wins[0]).toBe(300);
    expect(totals.turns[0][1]).toBe(300);
    expect(totals.kos[0][0]).toBe(300);
  }, 60_000);

  it("an 85%-accurate move that decides the battle wins about 85% of the time", () => {
    // Both at 1% HP: the faster Dragapult wins exactly when Fire Blast hits; if it misses, Snorlax's Crunch finishes it.
    const a = { ...labMon(set("Dragapult", { nature: "Timid", moves: ["Fire Blast"] })), hp: 1 };
    const b = { ...labMon(set("Snorlax", { moves: ["Crunch"] })), hp: 1 };
    for (const strategies of [["smart", "smart"], ["greedy", "scripted"]] as [LabStrategy, LabStrategy][]) {
      const { totals } = runLabRange(prepareLab(matchup(9, [a], [b], strategies)), "accuracy", 0, 2000);
      const ci = wilson(totals.wins[0], totals.battles);
      expect(totals.draws).toBe(0);
      expect(ci.lo).toBeLessThan(0.85);
      expect(ci.hi).toBeGreaterThan(0.85);
      // A Fire Blast that misses is the only way Side A loses.
      expect(totals.missLosses[0]).toBe(totals.wins[1]);
    }
  }, 120_000);

  it("the example: Gen 4, a level 5 Piplup with an Oran Berry against a level 5 Turtwig", () => {
    const { totals } = runLabRange(prepareLab(defaultSetup()), "example", 0, 300);
    expect(totals.battles).toBe(300);
    expect(totals.wins[0]).toBeGreaterThan(totals.wins[1]);
    expect(totals.winnerHp[0].reduce((a, b) => a + b, 0)).toBe(totals.wins[0]);
  }, 60_000);
});

describe("battle lab: starting conditions", () => {
  it("sets HP, status, stat stages, weather, terrain, hazards and screens before turn 1", () => {
    const setup = matchup(9, [{ ...labMon(set("Garchomp", { moves: ["Earthquake"] })), hp: 50, status: "par", boosts: { atk: 2, spe: -1 } }, labMon(set("Pikachu", { moves: ["Thunderbolt"] }))], [labMon(set("Snorlax", { moves: ["Body Slam"] }))]);
    setup.weather = "raindance";
    setup.weatherTurns = 0;
    setup.terrain = "electricterrain";
    setup.terrainTurns = 3;
    setup.sides[1].field = { ...EMPTY_SIDE_FIELD, stealthrock: true, spikes: 2, reflect: true };
    const { log, misses } = runLabBattle(prepareLab(setup), "start", 0, { log: true });
    expect(misses).toEqual([]);
    const turn1 = log!.indexOf("|turn|1");
    const before = log!.slice(0, turn1);
    expect(before).toContain("|-sethp|p1a: Garchomp|179/357|[silent]");
    expect(before).toContain("|-status|p1a: Garchomp|par");
    expect(before).toContain("|-boost|p1a: Garchomp|atk|2|[silent]");
    expect(before).toContain("|-unboost|p1a: Garchomp|spe|1|[silent]");
    expect(before).toContain("|-weather|RainDance");
    expect(before).toContain("|-fieldstart|move: Electric Terrain");
    expect(before.filter((l) => l.startsWith("|-sidestart|p2: Side B|"))).toEqual([
      "|-sidestart|p2: Side B|move: Stealth Rock",
      "|-sidestart|p2: Side B|Spikes",
      "|-sidestart|p2: Side B|Spikes",
      "|-sidestart|p2: Side B|Reflect",
    ]);
    // Rain that never ends; terrain that lasts three turns.
    expect(log!.some((l) => l === "|-weather|none")).toBe(false);
    const terrainEnd = log!.findIndex((l) => l.startsWith("|-fieldend|move: Electric Terrain"));
    if (terrainEnd >= 0) expect(log!.lastIndexOf("|turn|3", terrainEnd)).toBeGreaterThan(0);
  });

  it("reports a status that can't take", () => {
    const setup = matchup(9, [{ ...labMon(set("Charizard", { moves: ["Flamethrower"] })), status: "brn" }], [labMon(set("Snorlax", { moves: ["Body Slam"] }))]);
    expect(runLabBattle(prepareLab(setup), "x", 0, { log: true }).misses).toHaveLength(1);
  });

  it("refuses what the generation doesn't have, and explains", () => {
    const bad = (team: LabMon[], gen: LabGen = 4) => () => prepareLab(matchup(gen, team, [labMon(set("Snorlax", { moves: ["Tackle"] }))]));
    expect(bad([labMon(set("Sprigatito", { moves: ["Tackle"] }))])).toThrow(LabSetupError);
    expect(bad([labMon(set("Pikachu", { moves: ["Nuzzle"] }))])).toThrow(/no move called "Nuzzle" in Gen 4/);
    expect(bad([labMon(set("Pikachu", { moves: ["Tackle"], item: "Booster Energy" }))])).toThrow(/no item/);
    expect(bad([labMon(set("Aegislash-Blade", { moves: ["Tackle"] }))], 9)).toThrow(/Start it as Aegislash/);
    // Gen 1: no items; held items are dropped with a note.
    const gen1 = prepareLab(matchup(1, [labMon(set("Pikachu", { moves: ["Thunderbolt"], item: "Leftovers" }))], [labMon(set("Snorlax", { moves: ["Tackle"] }))]));
    expect(gen1.notes[0]).toMatch(/Gen 1 has no held items/);
    expect(setupProblem(matchup(9, [], [labMon(set("Snorlax", { moves: ["Tackle"] }))]))).toBe("Side A needs a Pokémon.");
    expect(setupProblem(matchup(9, [labMon(set("Snorlax", { moves: ["Tackle"] }))], [labMon(set("Snorlax", { moves: ["Tackle"] }))], ["smart", "smart"], true))).toMatch(/two Pokémon/);
  });

  it("credits KOs to the Pokémon behind them; status, weather and recoil count as indirect", () => {
    // Shedinja (1 HP) hits Ferrothorn and faints to Iron Barbs: Ferrothorn's KO.
    const barbs = matchup(9, [labMon(set("Ferrothorn", { ability: "Iron Barbs", moves: ["Iron Defense"] }))], [labMon(set("Shedinja", { moves: ["Tackle"] }))]);
    const a = runLabRange(prepareLab(barbs), "barbs", 0, 20).totals;
    expect(a.kos[0][0]).toBe(20);
    expect(a.otherKos[0]).toBe(0);
    // Magikarp only splashes and faints to Toxic: an indirect KO for Side A.
    const toxic = matchup(9, [labMon(set("Blissey", { moves: ["Toxic"] }))], [labMon(set("Magikarp", { moves: ["Splash"] }))], ["scripted", "scripted"]);
    const b = runLabRange(prepareLab(toxic), "toxic", 0, 10).totals;
    expect(b.wins[0]).toBe(10);
    expect(b.otherKos[0]).toBe(10);
    expect(b.kos[0][0] ?? 0).toBe(0);
  });

  it("names twins apart so the KOs go to the right one", () => {
    const twin = () => labMon(set("Pikachu", { moves: ["Thunderbolt"] }));
    const prep = prepareLab(matchup(9, [twin(), twin()], [labMon(set("Snorlax", { moves: ["Tackle"] }))]));
    expect(prep.names[0]).toEqual(["Pikachu", "Pikachu 2"]);
  });
});

describe("battle lab: share links", () => {
  it("round-trips a setup through the query string", async () => {
    const plain = defaultSetup();
    const code = await encodeSetup(plain);
    expect(code).toMatch(/^z[A-Za-z0-9_-]+$/);
    expect(await decodeSetup(code)).toEqual(plain);

    const big = matchup(9, randomTeam(9, "9,9,9,9", true), randomTeam(9, "8,8,8,8", true), ["scripted", "random"], true);
    big.sides[0].team[0] = { ...big.sides[0].team[0], hp: 37, status: "tox", boosts: { def: 1, evasion: -2 }, script: ["Protect"] };
    big.sides[0].loop = true;
    big.sides[1].field = { ...EMPTY_SIDE_FIELD, toxicspikes: 2, auroraveil: true };
    big.weather = "snowscape";
    big.weatherTurns = 0;
    big.terrain = "psychicterrain";
    big.terrainTurns = 8;
    const decoded = await decodeSetup(await encodeSetup(big));
    expect(decoded).toEqual(normalizeSetup(JSON.parse(setupJson(big))));
    expect(decoded).toEqual(big);
    // Six on six in doubles fits comfortably in a link.
    expect((await encodeSetup(big)).length).toBeLessThan(2500);
  });

  it("reads a plain (uncompressed) link and rejects junk", async () => {
    const json = setupJson(defaultSetup());
    const plain = `j${Buffer.from(json).toString("base64url")}`;
    expect(await decodeSetup(plain)).toEqual(defaultSetup());
    for (const junk of ["", "x123", "zzzzzz", `j${Buffer.from("{}").toString("base64url")}`, `j${Buffer.from("[1,2]").toString("base64url")}`, "z!!", "j" + "A".repeat(30_000)]) {
      expect(await decodeSetup(junk)).toBeNull();
    }
  });

  it("cleans what it reads: values in range, only what the generation has", () => {
    const raw = JSON.parse(setupJson(defaultSetup()));
    raw.gen = 2;
    raw.doubles = true;
    raw.weather = "snowscape";
    raw.sides[0].team[0].hp = 0;
    raw.sides[0].team[0].boosts = { atk: 9, spe: -12, bogus: 3 };
    raw.sides[0].team[0].status = "sick";
    raw.sides[0].strategy = "cheat";
    raw.sides[1].field = { spikes: 3, stealthrock: true };
    const clean = normalizeSetup(raw)!;
    expect(clean.doubles).toBe(false);
    expect(clean.weather).toBe("");
    expect(clean.sides[0].team[0]).toMatchObject({ hp: 1, boosts: { atk: 6, spe: -6 }, status: "" });
    expect(clean.sides[0].strategy).toBe("smart");
    // Gen 2: one layer of Spikes, no Stealth Rock.
    expect(clean.sides[1].field).toMatchObject({ spikes: 1, stealthrock: false });
    expect(normalizeSetup({ gen: 10, sides: [] })).toBeNull();
  });
});
