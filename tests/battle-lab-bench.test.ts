import { describe, expect, it } from "vitest";
import { Teams } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import { completeSet } from "@/lib/battle/sets";
import { defaultSetup, emptySide, labMon } from "@/lib/battle/lab/setup";
import { prepareLab, runLabRange } from "@/lib/battle/lab/simulate";
import { medianTurns } from "@/lib/battle/lab/stats";
import type { LabMon, LabSetup, LabStrategy } from "@/lib/battle/lab/types";

/**
 * Battles per second on one thread, every battle on the real simulator.
 * The page runs one worker per spare core, so multiply by the worker count.
 * Run alone for clean numbers: npx vitest run tests/battle-lab-bench.test.ts
 */

Teams.setGeneratorFactory(TeamGenerators);

const team = (format: string, seed: string): LabMon[] =>
  Teams.generate(format, { seed: seed as never }).map((s) => labMon(completeSet({ ...s, species: s.species, nature: s.nature || "" })));

function sixes(strategy: LabStrategy, doubles = false): LabSetup {
  const format = doubles ? "gen9randomdoublesbattle" : "gen9randombattle";
  return {
    ...defaultSetup(),
    gen: 9,
    doubles,
    sides: [
      { ...emptySide(), team: team(format, "1,2,3,4"), strategy },
      { ...emptySide(), team: team(format, "5,6,7,8"), strategy },
    ],
  };
}

function bench(name: string, setup: LabSetup, battles: number) {
  const prep = prepareLab(setup);
  runLabRange(prep, "warmup", 0, Math.min(5, battles)); // JIT and data warm-up
  const t0 = performance.now();
  const { totals } = runLabRange(prep, "bench", 0, battles);
  const ms = performance.now() - t0;
  const perSecond = (battles / ms) * 1000;
  console.log(`${name.padEnd(40)} ${String(battles).padStart(5)} battles  ${(ms / 1000).toFixed(2).padStart(6)} s  ${perSecond.toFixed(1).padStart(7)} battles/s  median ${medianTurns(totals)} turns`);
  expect(totals.battles).toBe(battles);
  expect(totals.refused + totals.broken + totals.fallbacks).toBe(0);
  return perSecond;
}

describe("battle lab: speed (one thread)", () => {
  it("1v1", () => {
    const smart = bench("1v1 Gen 4 Piplup vs Turtwig, Smart", defaultSetup(), 600);
    const greedy = defaultSetup();
    greedy.sides[0].strategy = greedy.sides[1].strategy = "greedy";
    bench("1v1 Gen 4 Piplup vs Turtwig, Greedy", greedy, 600);
    expect(smart).toBeGreaterThan(5);
  }, 120_000);

  it("6v6", () => {
    const smart = bench("6v6 Gen 9 random teams, Smart", sixes("smart"), 40);
    bench("6v6 Gen 9 random teams, Random", sixes("random"), 40);
    bench("6v6 Gen 9 random doubles, Smart", sixes("smart", true), 20);
    expect(smart).toBeGreaterThan(0.5);
  }, 240_000);
});
