import { describe, expect, it } from "vitest";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import * as lib from "@smogon/calc/dist/adaptable";
import fixture from "./fixtures/analysis-battle.json";
import { agreement, fillSet, type AssumedSet } from "@/lib/battle/analysis/assume";
import { keyMomentLine, turnFacts } from "@/lib/battle/analysis/facts";
import { keySwings, koChance, resultPoint, rolloutsFor, standardError, swings, winPoint, type WinPoint } from "@/lib/battle/analysis/maths";
import { parseReplay, type Revealed } from "@/lib/battle/analysis/parse";
import { turnSetup } from "@/lib/battle/analysis/setup";
import { prepareLab, runLabRange } from "@/lib/battle/lab/simulate";
import { completeSet } from "@/lib/battle/sets";
import { assumeSets, standins } from "@/lib/server/analysis-sets";

const gens = new Generations(Dex);
const calc = { gen: gens.get(9), lib };

describe("analysis maths", () => {
  it("turns rollouts into a win chance with a 95% interval, from the viewer's side", () => {
    const totals = { battles: 100, wins: [60, 30] as [number, number], draws: 10 };
    const p1 = winPoint(3, totals, 0);
    expect(p1.p).toBeCloseTo(0.65);
    expect(p1.lo).toBeLessThan(0.65);
    expect(p1.hi).toBeGreaterThan(0.65);
    const p2 = winPoint(3, totals, 1);
    expect(p2.p).toBeCloseTo(0.35);
    expect(resultPoint(9, 1, 1)).toEqual({ turn: 9, n: 0, p: 1, lo: 1, hi: 1 });
    expect(resultPoint(9, 0, 1).p).toBe(0);
    expect(resultPoint(9, null, 1).p).toBe(0.5);
    expect(standardError(resultPoint(9, 0, 1))).toBe(0);
    expect(standardError(p1)).toBeCloseTo(Math.sqrt(0.65 * 0.35 / 100));
  });

  it("keeps only swings bigger than the noise, the biggest five, in turn order", () => {
    const pt = (turn: number, p: number, n = 100): WinPoint => ({ turn, n, p, lo: p, hi: p });
    const points = [pt(1, 0.5), pt(2, 0.52), pt(3, 0.2), pt(4, 0.25), pt(5, 0.7), pt(6, 0.0, 0)];
    const all = swings(points);
    expect(all.map((s) => s.turn)).toEqual([1, 2, 3, 4, 5]);
    expect(all[0].significant).toBe(false); // +2%: noise
    expect(all[1].significant).toBe(true); // −32%
    expect(all[2].significant).toBe(false); // +5% at n=100
    expect(all[3].significant).toBe(true);
    expect(all[4].delta).toBeCloseTo(-0.7);
    expect(keySwings(all).map((s) => s.turn)).toEqual([2, 4, 5]);
    expect(keySwings(all, 2).map((s) => s.turn)).toEqual([4, 5]);
  });

  it("KO chance is the share of rolls at or over the HP left, times accuracy", () => {
    expect(koChance([80, 85, 90, 95], 90)).toBe(0.5);
    expect(koChance([80, 85, 90, 95], 90, 80)).toBeCloseTo(0.4);
    expect(koChance([], 10)).toBe(0);
    expect(rolloutsFor({ budgetMs: 25_000, elapsedMs: 5_000, turnsLeft: 10, msPerRollout: 10, min: 40, max: 300 })).toBe(200);
    expect(rolloutsFor({ budgetMs: 25_000, elapsedMs: 24_000, turnsLeft: 10, msPerRollout: 10, min: 40, max: 300 })).toBe(40);
  });
});

describe("filling out sets", () => {
  const revealed: Revealed = { key: "p2: Swalot", species: "Swalot", level: 90, moves: ["Gunk Shot", "Swords Dance"], item: null, ability: null, teraType: "Dark" };
  it("prefers the candidate that agrees with what was revealed, and keeps the revealed facts", () => {
    const a = completeSet({ species: "Swalot", moves: ["Sludge Bomb", "Encore", "Toxic", "Protect"], item: "Black Sludge", ability: "Liquid Ooze" });
    const b = completeSet({ species: "Swalot", moves: ["Gunk Shot", "Swords Dance", "Earthquake", "Knock Off"], item: "Life Orb", ability: "Sticky Hold", teraType: "Ground" });
    expect(agreement(revealed, b)).toBeGreaterThan(agreement(revealed, a));
    const filled = fillSet(revealed, [a, b], "random");
    expect(filled.set.moves).toEqual(["Gunk Shot", "Swords Dance", "Earthquake", "Knock Off"]);
    expect(filled.set.teraType).toBe("Dark");
    expect(filled.set.level).toBe(90);
    expect(filled.revealedMoves).toBe(2);
    expect(fillSet(revealed, [], "usage").source).toBe("revealed");
  });
});

/**
 * tests/fixtures/analysis-battle.json: a Gen 9 Random Battle played to the
 * end on Pokémon Showdown's simulator (@pkmn/sim, both sides on the Smart
 * strategy), its spectator channel as a replay stores it.
 */
describe("a real battle, analysed", () => {
  const parsed = parseReplay(fixture.log);
  const viewer = 0;

  async function allSets() {
    const mons = [...parsed.revealed[0].values(), ...parsed.revealed[1].values()];
    return new Map<string, AssumedSet>((await assumeSets("gen9randombattle", mons)).map((a) => [a.key, a]));
  }

  it("reads the log turn by turn as a spectator saw it", () => {
    expect(parsed.gen).toBe(9);
    expect(parsed.doubles).toBe(false);
    expect(parsed.lastTurn).toBe(fixture.turns);
    expect(parsed.turns[1].sides[0].active[0]).toBe("p1: Toxapex");
    expect(parsed.events[1].actions[1]).toEqual([
      { kind: "tera", mon: "p2: Slaking", type: "Ground", slot: 0 },
      { kind: "move", mon: "p2: Slaking", move: "Earthquake", missed: false, slot: 0, target: "p1: Toxapex", spread: null },
    ]);
    expect(parsed.events[10].actions[0]).toEqual([{ kind: "switch", from: "p1: Lugia", to: "p1: Arceus", slot: 0 }]);
    expect(parsed.events[9].actions[1]).toEqual([{ kind: "switch", from: "p2: Great Tusk", to: "p2: Skarmory", slot: 0 }]);
    expect(parsed.events[20].actions[1]).toEqual([{ kind: "move", mon: "p2: Masquerain", move: "Hurricane", missed: true, slot: 0, target: "p1: Jirachi", spread: null }]);
    // A replacement after a faint isn't a choice (Slaking loafed around on turn 3, then fainted).
    expect(parsed.events[3].actions[1]).toEqual([]);
    expect(parsed.events[3].fainted).toEqual(["p2: Slaking"]);
    expect(parsed.events[13].fainted).toEqual(["p1: Arceus", "p2: Skarmory"]);
    expect(parsed.turns[4].sides[1].team.find((m) => m.key === "p2: Slaking")?.fainted).toBe(true);
    expect(parsed.turns[4].sides[1].team.find((m) => m.key === "p2: Sudowoodo")?.hp).toBe(100);
    expect(parsed.turns[5].sides[1].team.find((m) => m.key === "p2: Sudowoodo")?.hp).toBe(55);
    expect(parsed.turns[2].sides[1].teraUsed).toBe(true);
    expect(parsed.turns[6].sides[0].teraUsed).toBe(false);
    expect(parsed.turns[7].sides[0].teraUsed).toBe(true);
    expect(parsed.turns[11].sides[0].conditions).toEqual({ stealthrock: 1 });
    expect(parsed.revealed[1].get("p2: Masquerain")?.moves).toEqual(expect.arrayContaining(["Hurricane"]));
    expect([...parsed.revealed[0].keys()]).toHaveLength(6);
    expect([...parsed.revealed[1].keys()]).toHaveLength(6);
  });

  it("stands in for Pokémon that never appeared, the same way every time", async () => {
    const have = ["Vaporeon", "Grimmsnarl"];
    const a = await standins("gen9randombattle", 0, 3, have, "fixture");
    const b = await standins("gen9randombattle", 0, 3, have, "fixture");
    expect(a.map((e) => e.key)).toEqual(["p1: (unseen 1)", "p1: (unseen 2)", "p1: (unseen 3)"]);
    expect(a.map((e) => e.set.species)).toEqual(b.map((e) => e.set.species));
    expect(a.every((e) => e.source === "standin" && !have.includes(e.set.species))).toBe(true);
    expect(await standins("gen9randombattle", 0, 0, have, "fixture")).toEqual([]);
    const ou = await standins("gen9ou", 1, 2, ["Great Tusk"], "x");
    expect(ou).toHaveLength(2);
    expect(ou.some((e) => e.set.species === "Great Tusk")).toBe(false);
  });

  it("builds each turn's simulation, plays it, and explains the swings with real numbers", async () => {
    const sets = await allSets();
    expect([...sets.values()].every((a) => a.source === "random")).toBe(true);
    const keys: [string[], string[]] = [[...parsed.revealed[0].keys()], [...parsed.revealed[1].keys()]];
    const points: WinPoint[] = [];
    for (let t = 1; t <= parsed.lastTurn; t++) {
      const setup = turnSetup(parsed.turns[t], parsed.gen, sets, keys);
      expect(setup).not.toBeNull();
      // Every Pokémon either side showed, minus the fainted; the one in battle leads.
      const alive = (s: 0 | 1) => keys[s].length - parsed.turns[t].sides[s].team.filter((m) => m.fainted).length;
      expect(setup!.sides[0].team.length).toBe(alive(0));
      expect(setup!.sides[1].team.length).toBe(alive(1));
      const active = parsed.turns[t].sides[0].team.find((m) => m.key === parsed.turns[t].sides[0].active[0])!;
      expect(setup!.sides[0].team[0].hp).toBe(active.hp);
      const { totals } = runLabRange(prepareLab(setup!), "analysis-test", 0, 40);
      expect(totals.broken).toBe(0);
      points.push(winPoint(t, totals, viewer));
    }
    points.push(resultPoint(parsed.lastTurn + 1, fixture.winner as 0 | 1, viewer));
    const key = keySwings(swings(points));
    console.log(points.map((p) => `${p.turn}:${Math.round(p.p * 100)}`).join(" "));
    expect(key.length).toBeGreaterThan(0);
    const lines = key.map((s) => keyMomentLine(parsed, viewer, s, turnFacts(calc, parsed, s.turn, viewer, sets)));
    for (const line of lines) expect(line).toMatch(/^Turn \d+: .+ \(win chance \d+% → (\d+%|won|lost|draw)\)\.$/);
    console.log(points.map((p) => `${p.turn}:${Math.round(p.p * 100)}`).join(" "));
    console.log(lines.join("\n"));
  }, 180_000);

  it("flags missed KOs and risky switches only on the calc's numbers", async () => {
    const sets = await allSets();
    const all = Array.from({ length: parsed.lastTurn }, (_, i) => turnFacts(calc, parsed, i + 1, viewer, sets));
    for (const f of all) {
      if (f.missedKo) expect(f.missedKo.chance).toBeGreaterThanOrEqual(0.5);
      if (f.riskySwitch) expect(f.riskySwitch.chance).toBeGreaterThanOrEqual(0.5);
    }
    console.log(all.flatMap((f, i) => [f.missedKo && `T${i + 1} missed ${JSON.stringify(f.missedKo)}`, f.riskySwitch && `T${i + 1} risky ${JSON.stringify(f.riskySwitch)}`].filter(Boolean)).join("\n"));
  });
});

