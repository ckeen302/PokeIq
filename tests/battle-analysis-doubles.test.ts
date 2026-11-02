import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Teams } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import type { Battle as PkmnBattle, Side as PkmnSide } from "@pkmn/sim";
import fixtures from "./fixtures/analysis-doubles.json";
import { selfPlay, type Truth } from "./helpers/selfplay";
import type { AssumedSet } from "@/lib/battle/analysis/assume";
import { describeDoublesTurn, missedKoText, turnFacts, type MissedKo } from "@/lib/battle/analysis/facts";
import { parseReplay, type ParsedBattle } from "@/lib/battle/analysis/parse";
import { analyseReplay, unsupportedReason, type AnalysisResult } from "@/lib/battle/analysis/run";
import { turnSetup } from "@/lib/battle/analysis/setup";
import { computeStats } from "@/lib/battle/analysis/stats";
import { turningPoints } from "@/lib/battle/analysis/stats-text";
import { moveSlotOptions } from "@/lib/battle/choices";
import { chooseCpuDoubles } from "@/lib/battle/cpu-policy-doubles";
import { withMega } from "@/lib/battle/lab/policies";
import type { LabPool } from "@/lib/battle/lab/pool";
import { defaultSetup, emptySide, labMon } from "@/lib/battle/lab/setup";
import { prepareLab, runLabBattle, runLabRange, startLabBattle } from "@/lib/battle/lab/simulate";
import type { BattleRequest } from "@/lib/battle/play";
import type { ReplayData } from "@/lib/battle/replay";
import { completeSet } from "@/lib/battle/sets";
import { assumeSets, standins } from "@/lib/server/analysis-sets";
import * as lib from "@smogon/calc/dist/adaptable";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";

/**
 * Double battles in the post-battle analysis, on real Gen 9 Random Doubles
 * Battles: tests/fixtures/analysis-doubles.json (scripts/doubles-fixtures.ts,
 * Pokémon Showdown's simulator, both sides the computer on Hard) and the
 * same battles replayed live here for the simulator's own state each turn.
 */

const calc = { gen: new Generations(Dex).get(9), lib };
const FORMAT = "gen9randomdoublesbattle";

type Fixture = (typeof fixtures)[number];
const parsedOf = (f: Fixture) => parseReplay(f.log);

async function setsFor(parsed: ParsedBattle, seed: string) {
  const mons = [...parsed.revealed[0].values(), ...parsed.revealed[1].values()];
  const last = parsed.turns[parsed.lastTurn];
  const unseen = ([0, 1] as const).map((s) => Math.max(0, last.sides[s].size - parsed.revealed[s].size));
  const have = (s: 0 | 1) => mons.filter((m) => m.key.startsWith(`p${s + 1}:`)).map((m) => m.species);
  const all = [...(await assumeSets(FORMAT, mons)), ...(await standins(FORMAT, 0, unseen[0], have(0), seed)), ...(await standins(FORMAT, 1, unseen[1], have(1), seed))];
  const sets = new Map<string, AssumedSet>(all.map((a) => [a.key, a]));
  const keys: [string[], string[]] = [all.filter((a) => a.key.startsWith("p1:")).map((a) => a.key), all.filter((a) => a.key.startsWith("p2:")).map((a) => a.key)];
  return { sets, keys, all };
}

describe("doubles: reading a Random Doubles replay", () => {
  it("reads positions, targets, spread moves, Protect and switches into a position", () => {
    // Seed 23: Greedent and Chi-Yu against Flapple and Empoleon.
    const f = fixtures.find((x) => x.seed === 23)!;
    const p = parsedOf(f);
    expect(p.doubles).toBe(true);
    expect(p.gameType).toBe("doubles");
    expect(p.lastTurn).toBe(f.turns);
    expect(p.turns[1].sides[0].active).toEqual(["p1: Greedent", "p1: Chi-Yu"]);
    expect(p.turns[1].sides[1].active).toEqual(["p2: Flapple", "p2: Empoleon"]);
    const t1 = p.events[1];
    expect(t1.actions[0]).toEqual([
      { kind: "tera", mon: "p1: Greedent", type: "Ground", slot: 0 },
      { kind: "move", mon: "p1: Chi-Yu", move: "Overheat", missed: true, slot: 1, target: "p2: Flapple", spread: null },
      { kind: "move", mon: "p1: Greedent", move: "High Horsepower", missed: false, slot: 0, target: "p2: Empoleon", spread: null },
    ]);
    // The HP a hit left, before the berry it set off.
    expect(t1.hits.find((h) => h.move === "High Horsepower")).toMatchObject({ by: "p1: Greedent", target: "p2: Empoleon", before: 100, after: 18, ally: false, spread: false });
    expect(t1.hits.find((h) => h.move === "Tera Blast")).toMatchObject({ target: "p1: Greedent", before: 100, after: 37 });
    // Turn 4: a switch into position b; Rage Powder on itself.
    expect(p.events[4].actions[1][0]).toEqual({ kind: "switch", from: "p2: Empoleon", to: "p2: Skarmory", slot: 1 });
    expect(p.events[4].actions[0][0]).toMatchObject({ move: "Rage Powder", slot: 0, target: "p1: Amoonguss", spread: null });
    expect(p.turns[5].sides[1].active).toEqual(["p2: Luvdisc", "p2: Skarmory"]);
    // Turn 6: Rock Slide hits both foes and knocks Skarmory out; Empoleon replaces it (not a choice).
    expect(p.events[6].actions[0][1]).toMatchObject({ mon: "p1: Lycanroc", move: "Rock Slide", slot: 1, target: "p2: Skarmory", spread: ["p2: Luvdisc", "p2: Skarmory"] });
    expect(p.events[6].hits.filter((h) => h.spread).map((h) => [h.target, h.after])).toEqual([
      ["p2: Luvdisc", 61],
      ["p2: Skarmory", 0],
    ]);
    expect(p.events[6].fainted).toEqual(["p2: Skarmory"]);
    expect(p.events[6].actions[1].some((a) => a.kind === "switch")).toBe(false);
    // Turn 8: Earthquake with the partner protected hits only the foes.
    expect(p.events[8].protected).toEqual(["p1: Lycanroc"]);
    expect(p.events[8].actions[0][1]).toMatchObject({ mon: "p1: Gliscor", move: "Earthquake", spread: ["p2: Iron Thorns", "p2: Empoleon"] });
    expect(p.events[8].actions[1][0]).toMatchObject({ mon: "p2: Iron Thorns", move: "Rock Slide", spread: ["p1: Gliscor"] });
    expect(p.turns[9].sides[0].team.find((m) => m.key === "p1: Lycanroc")?.protectStreak).toBe(1);
    expect(p.turns[9].sides[1].active).toEqual(["p2: Iron Thorns", "p2: Kyurem"]);
    // One Pokémon left: position b is empty.
    expect(p.turns[10].sides[0].active).toEqual(["p1: Gliscor", null]);
    // A Pokémon that has moved can't Fake Out again; one just in hasn't.
    expect(p.turns[2].sides[0].team.find((m) => m.key === "p1: Greedent")?.moved).toBe(true);
    expect(p.turns[9].sides[1].team.find((m) => m.key === "p2: Kyurem")?.moved).toBe(false);
  });

  it("keeps every fixture's actions consistent with the positions", () => {
    for (const f of fixtures) {
      const p = parsedOf(f);
      for (let t = 1; t <= p.lastTurn; t++) {
        const state = p.turns[t];
        for (const s of [0, 1] as const) {
          expect(state.sides[s].active).toHaveLength(2);
          for (const a of p.events[t].actions[s]) {
            expect([0, 1]).toContain(a.slot);
            if (a.kind === "move") for (const k of a.spread ?? []) expect(k).toMatch(/^p[12]: /);
            if (a.kind === "switch" && t < p.lastTurn) expect(state.sides[s].active[a.slot]).toBe(a.from);
          }
        }
      }
      expect(p.winner).toBe(f.winner);
    }
  });
});

describe("doubles: each turn's position rebuilt exactly", () => {
  const keyOf = (species: string) => Dex.species.get(species).baseSpecies;
  for (const seed of [11, 23]) {
    it(`matches the simulator's own state at the start of every turn (seed ${seed})`, async () => {
      const live = selfPlay(FORMAT, seed);
      const fixture = fixtures.find((x) => x.seed === seed)!;
      // The live battle is the fixture's battle.
      expect(live.log).toEqual(fixture.log);
      const parsed = parseReplay(live.log);
      const { sets, keys } = await setsFor(parsed, `fixture-${seed}`);
      let compared = 0;
      for (let t = 1; t <= parsed.lastTurn; t++) {
        const truth: Truth | undefined = live.truth[t];
        if (!truth) continue;
        const setup = turnSetup(parsed.turns[t], 9, sets, keys, true)!;
        expect(setup.doubles).toBe(true);
        const { battle, misses } = startLabBattle(prepareLab(setup), `check-${seed}`, t);
        expect(misses).toEqual([]);
        for (const s of [0, 1] as const) {
          const want = truth.sides[s].active.filter((m): m is NonNullable<typeof m> => !!m);
          const got = battle.sides[s].active.filter((p) => p && !p.fainted && p.hp > 0);
          expect(got.map((p) => keyOf(p.species.name))).toEqual(want.map((m) => keyOf(m.species)));
          got.forEach((p, i) => {
            const m = want[i];
            expect(Math.abs(Math.round((100 * p.hp) / p.maxhp) - m.hp)).toBeLessThanOrEqual(1);
            expect(p.status || "").toBe(m.status);
            expect(Object.fromEntries(Object.entries(p.boosts).filter(([, v]) => v))).toEqual(m.boosts);
            expect(p.terastallized || "").toBe(m.terastallized);
            // Fake Out's one chance: gone for a Pokémon that has already moved.
            if (m.activeMoveActions > 0) expect(p.activeMoveActions).toBeGreaterThan(0);
          });
          // Everyone left standing that the battle has shown so far, at the same HP.
          const shown = new Set(parsed.turns[t].sides[s].team.map((m) => keyOf(m.species)));
          const bench = battle.sides[s].pokemon.filter((p) => !p.fainted && p.hp > 0);
          for (const p of bench) {
            const species = keyOf(p.species.name);
            if (!shown.has(species)) continue;
            const want = Object.entries(truth.sides[s].alive).find(([k]) => keyOf(k) === species);
            expect(want, `${species} on side ${s} at turn ${t}`).toBeDefined();
            expect(Math.abs(Math.round((100 * p.hp) / p.maxhp) - want![1])).toBeLessThanOrEqual(1);
          }
          const conditions = Object.fromEntries(Object.entries(battle.sides[s].sideConditions).map(([id, c]) => [id, (c as { layers?: number }).layers ?? 1]));
          expect(conditions).toEqual(truth.sides[s].conditions);
        }
        expect(battle.field.weather).toBe(truth.weather);
        expect(battle.field.terrain).toBe(truth.terrain);
        expect(!!battle.field.pseudoWeather.trickroom).toBe(truth.trickRoom);
        compared++;
      }
      expect(compared).toBe(parsed.lastTurn);
    }, 120_000);
  }

  it("plays a side down to one Pokémon in a double battle", () => {
    const mon = (species: string, moves: string[]) => labMon(completeSet({ species, moves, level: 80 }));
    const setup = {
      ...defaultSetup(),
      gen: 9 as const,
      doubles: true,
      inProgress: true,
      sides: [
        { ...emptySide(), team: [mon("Garchomp", ["Earthquake", "Dragon Claw", "Protect"])] },
        { ...emptySide(), team: [mon("Heatran", ["Flamethrower", "Earth Power"]), mon("Pikachu", ["Thunderbolt", "Fake Out"])] },
      ],
    } as Parameters<typeof prepareLab>[0];
    const { totals } = runLabRange(prepareLab(setup), "lone", 0, 30);
    expect(totals.battles).toBe(30);
    expect(totals.broken).toBe(0);
    expect(totals.wins[0] + totals.wins[1] + totals.draws).toBe(30);
  });
});

/** The analysis's pool, run here on this thread. */
function inlinePool(): LabPool {
  return {
    size: 1,
    run(setup: Parameters<LabPool["run"]>[0], seed: string, total: number) {
      const { totals, outcomes } = runLabRange(prepareLab(setup), seed, 0, total);
      return { promise: Promise.resolve({ done: total, total, totals, outcomes, elapsedMs: 0, cancelled: false, notes: [], misses: [] }), cancel: () => undefined };
    },
  } as unknown as LabPool;
}

describe("doubles: the analysis, start to finish", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { format: string; mons: Parameters<typeof assumeSets>[1]; unseen: [number, number]; seed: string };
      const have = (s: 0 | 1) => body.mons.filter((m) => m.key.startsWith(`p${s + 1}:`)).map((m) => m.species);
      const sets = [...(await assumeSets(body.format, body.mons)), ...(await standins(body.format, 0, body.unseen[0], have(0), body.seed)), ...(await standins(body.format, 1, body.unseen[1], have(1), body.seed))];
      return new Response(JSON.stringify({ sets }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  const replayOf = (f: Fixture): ReplayData =>
    ({ id: `dbl${f.seed}`, format: FORMAT, formatName: "[Gen 9] Random Doubles Battle", players: f.players as [string, string], winner: f.winner, turns: f.turns, log: f.log, reason: "normal" }) as unknown as ReplayData;

  it("isn't refused: any doubles format the Lab plays is analysed", () => {
    expect(unsupportedReason({ format: FORMAT, turns: 5 })).toBeNull();
    expect(unsupportedReason({ format: "gen9doublesou", turns: 5 })).toBeNull();
    expect(unsupportedReason({ format: "gen9randomdoublesbattle", turns: 0 })).toMatch(/before the first turn/);
    expect(unsupportedReason({ format: "gen9triplescustomgame" as never, turns: 5 })).toMatch(/^Triple battles can't be simulated/);
    expect(unsupportedReason({ format: "gen9randombattle", turns: 5 })).toBeNull();
  });

  const results = new Map<string, AnalysisResult>();
  for (const seed of [11, 37]) {
    for (const viewer of [0, 1] as const) {
      it(`ends at 100% for the winner and 0% for the loser, and names targets (seed ${seed}, side ${viewer})`, async () => {
        const f = fixtures.find((x) => x.seed === seed)!;
        const t0 = performance.now();
        const result = await analyseReplay(replayOf(f), viewer, inlinePool(), () => undefined, () => false);
        const ms = performance.now() - t0;
        expect(result).not.toBeNull();
        const r = result!;
        results.set(`${seed}:${viewer}`, r);
        expect(r.doubles).toBe(true);
        expect(r.points).toHaveLength(f.turns + 1);
        const end = r.points[r.points.length - 1];
        expect(end.n).toBe(0);
        expect(end.p).toBe(f.winner === viewer ? 1 : 0);
        for (const p of r.points.slice(0, -1)) {
          expect(p.n).toBeGreaterThanOrEqual(10);
          expect(p.p).toBeGreaterThanOrEqual(0);
          expect(p.p).toBeLessThanOrEqual(1);
        }
        // Both sides' positions in every key moment, and a line in the usual form.
        for (const k of r.keyMoments) {
          expect(k.text).toMatch(/^Turn \d+: .+ \(win chance \d+% → (\d+%|won|lost|draw)\)\.$/);
          expect(k.board?.[0].length).toBeGreaterThan(0);
          expect(k.board?.[1].length).toBeGreaterThan(0);
          expect(k.board!.every((side) => side.length <= 2)).toBe(true);
        }
        for (const l of [...r.missedKos, ...r.riskySwitches]) expect(l.text).toMatch(/^Turn \d+: [A-Z].+\.$/);
        console.log(`seed ${seed} side ${viewer}: ${r.rollouts} rollouts in ${(ms / 1000).toFixed(1)} s, ${r.points.map((p) => Math.round(p.p * 100)).join(" ")}`);
        console.log([...r.keyMoments, ...r.missedKos, ...r.riskySwitches].map((k) => `  ${k.text}`).join("\n"));
      }, 300_000);
    }
  }

  it("analyses a Doubles OU battle too (team preview, the format's own set sources)", async () => {
    const live = selfPlay("gen9doublesou", 5, { teamFormat: FORMAT });
    expect(live.refused).toEqual([]);
    expect(live.winner).not.toBeNull();
    const replay = { id: "dblou5", format: "gen9doublesou", formatName: "[Gen 9] Doubles OU", players: live.players, winner: live.winner, turns: live.turns, log: live.log, reason: "normal" } as unknown as ReplayData;
    const r = (await analyseReplay(replay, 0, inlinePool(), () => undefined, () => false))!;
    expect(r.doubles).toBe(true);
    expect(r.points).toHaveLength(live.turns + 1);
    expect(r.points[r.points.length - 1].p).toBe(live.winner === 0 ? 1 : 0);
    // Random Doubles Pokémon are mostly missing from Doubles OU's usage statistics: those fall back to random-battle sets.
    expect(Object.values(r.sources[0]).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(0);
    console.log(`Doubles OU: ${live.turns} turns, ${r.rollouts} rollouts, ${r.points.map((p) => Math.round(p.p * 100)).join(" ")}`);
  }, 300_000);

  it("names the targets, spread hits and shared KOs in a turn's words", () => {
    const p23 = parsedOf(fixtures.find((x) => x.seed === 23)!);
    expect(describeDoublesTurn(p23, 0, 8)).toBe(
      "your Lycanroc-Dusk protected itself; your Gliscor's Earthquake hit both foes (Iron Thorns −81%, Empoleon −42%); Iron Thorns's Rock Slide hit your Gliscor (Gliscor −22%); your Gliscor's Earthquake knocked out Empoleon"
    );
    expect(describeDoublesTurn(p23, 1, 8)).toBe(
      "your Iron Thorns's Rock Slide hit Gliscor (Gliscor −22%); Lycanroc-Dusk protected itself; Gliscor's Earthquake hit both of your Pokémon (Iron Thorns −81%, Empoleon −42%); Gliscor's Earthquake knocked out your Empoleon"
    );
    expect(describeDoublesTurn(p23, 0, 9)).toContain("Kyurem-Black used Icicle Spear on your Gliscor (blocked by Protect)");
    const p11 = parsedOf(fixtures.find((x) => x.seed === 11)!);
    expect(describeDoublesTurn(p11, 0, 6)).toContain("your Froslass and Zapdos knocked out Regigigas together");
    expect(describeDoublesTurn(p11, 0, 12)).toContain("Espeon and Alcremie-Ruby-Swirl knocked out your Smeargle together");
    expect(describeDoublesTurn(p11, 1, 13)).toContain("Alcremie-Ruby-Swirl used Helping Hand on your Espeon");
  });

  it("explains a missed KO by its target", () => {
    const p = parsedOf(fixtures[0]);
    const aimed: MissedKo = { turn: 2, mon: "Garchomp", move: "Dragon Claw", target: "Heatran", chance: 0.87, instead: { kind: "move", mon: "p1: Garchomp", move: "Dragon Claw", missed: false, slot: 0, target: "p2: Amoonguss", spread: null }, doubles: true, slot: 0, aimedAt: "Amoonguss" };
    expect(missedKoText(p, 0, aimed)).toBe("your Garchomp missed a KO on Heatran by targeting Amoonguss (Dragon Claw had a 87% chance to KO Heatran)");
    const other: MissedKo = { ...aimed, aimedAt: undefined, instead: { kind: "move", mon: "p1: Garchomp", move: "Protect", missed: false, slot: 0, target: "p1: Garchomp", spread: null } };
    expect(missedKoText(p, 0, other)).toBe("your Garchomp's Dragon Claw had a 87% chance to KO Heatran; it used Protect instead");
  });

  it("flags missed KOs only on the calc's numbers, and never one the partner took", async () => {
    for (const f of fixtures) {
      const p = parsedOf(f);
      const { sets } = await setsFor(p, `facts-${f.seed}`);
      for (const viewer of [0, 1] as const) {
        for (let t = 1; t <= p.lastTurn; t++) {
          const facts = turnFacts(calc, p, t, viewer, sets);
          for (const m of facts.missedKos) {
            expect(m.chance).toBeGreaterThanOrEqual(0.5);
            const targetKey = p.turns[t].sides[viewer === 0 ? 1 : 0].active.find((k) => k && p.revealed[viewer === 0 ? 1 : 0].get(k)?.species === m.target);
            expect(targetKey && p.events[t].fainted.includes(targetKey)).toBeFalsy();
          }
          for (const r of facts.riskySwitches) expect(r.chance).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  });

  it("turning points name the targets", async () => {
    const f = fixtures.find((x) => x.seed === 11)!;
    const r = results.get("11:0") ?? (await analyseReplay(replayOf(f), 0, inlinePool(), () => undefined, () => false))!;
    const stats = computeStats(f.log);
    expect(stats.doubles).toBe(true);
    const tps = turningPoints(r.points, stats, 0, 5);
    expect(tps.length).toBeGreaterThan(0);
    for (const tp of tps) expect(tp.text).toMatch(/turn \d+ .*((dropped|raised|took) your odds|your odds went) from \d+% to (\d+%|the win|the loss|a draw)\.$/i);
    // Across the battle's turns, the plain words name who each move went at.
    const plain = stats.notes.slice(1).map((notes) => turningPoints([{ turn: 1, n: 100, p: 0.5, lo: 0.4, hi: 0.6 }, { turn: 2, n: 0, p: 1, lo: 1, hi: 1 }], { ...stats, notes: [[], notes] }, 0, 1)[0]?.text ?? "");
    expect(plain.some((t) => / used [A-Z][\w' -]+ on (your |Blue's |both )/.test(t))).toBe(true);
    console.log(tps.map((t) => t.text).join("\n"));
  }, 300_000);
});

describe("doubles: the policy", () => {
  Teams.setGeneratorFactory(TeamGenerators);
  const team = (seed: string) => Teams.generate(FORMAT, { seed: seed as never }).map((s) => labMon(completeSet({ ...s, species: s.species, nature: s.nature || "" })));

  it("only ever makes legal choices, across whole Random Doubles battles", () => {
    let decisions = 0;
    let refused = 0;
    let fallbacks = 0;
    for (let g = 0; g < 12; g++) {
      const setup = { ...defaultSetup(), gen: 9 as const, doubles: true, sides: [{ ...emptySide(), team: team(`${g * 7 + 1},2,3,4`) }, { ...emptySide(), team: team(`${g * 7 + 5},6,7,8`) }] } as Parameters<typeof prepareLab>[0];
      const prep = prepareLab(setup);
      prep.formatid = FORMAT;
      const { record } = runLabBattle(prep, "legal", g, {
        choosers: (rands, rec) =>
          ([0, 1] as const).map((s) => (battle: PkmnBattle, side: PkmnSide) => {
            const request = side.activeRequest as unknown as BattleRequest;
            const choice = withMega(chooseCpuDoubles(battle, side, s === 0 ? "hard" : "normal", rands[s], () => rec.fallbacks++), request);
            decisions++;
            // Every part is one of the request's own options for that position, no Pokémon is sent in twice, and at most one Terastallizes.
            if (!request.teamPreview && !request.forceSwitch) {
              const parts = choice.split(", ");
              expect(parts).toHaveLength(request.active!.length);
              parts.forEach((part, slot) => {
                const legal = moveSlotOptions(request, slot, true).map((o) => o.text);
                expect(legal).toContain(part.replace(/ mega$/, ""));
              });
              const switches = parts.filter((x) => x.startsWith("switch"));
              expect(new Set(switches).size).toBe(switches.length);
              expect(parts.filter((x) => x.includes("terastallize")).length).toBeLessThanOrEqual(1);
            }
            return choice;
          }) as [never, never],
      });
      refused += record.refused;
      fallbacks += record.fallbacks;
      expect(record.broken).toBe(false);
    }
    expect(decisions).toBeGreaterThan(100);
    expect(refused).toBe(0);
    expect(fallbacks).toBe(0);
  }, 120_000);

  it("plays the fixtures' battles with nothing refused", () => {
    for (const f of fixtures) expect(selfPlay(FORMAT, f.seed).refused).toEqual([]);
  }, 120_000);
});
