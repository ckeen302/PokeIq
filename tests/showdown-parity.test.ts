import { describe, expect, it } from "vitest";
import { checkValidators, playOne, SCENARIOS, tally, VALIDATOR_PROBES, type Divergence } from "../scripts/showdown-parity";

/**
 * A small run of scripts/showdown-parity.ts (`npm run verify:showdown` plays
 * thousands): @pkmn/sim, which the Battle Lab runs in the browser, against
 * the official simulator the server battles on. Gen 9 must match line for
 * line; older generations may only differ in the ways the script already
 * knows about.
 */

const PER_SCENARIO = 3;
const SEED = 7;

describe("parity with Pokémon Showdown", () => {
  const divergences: Divergence[] = [];
  for (let i = 0; i < SCENARIOS.length * PER_SCENARIO; i++) {
    const outcome = playOne(i, SEED);
    for (const d of outcome.divergences) divergences.push({ ...d, battle: i });
  }

  it("has no divergence the script can't explain", () => {
    const unexplained = tally(divergences).filter((row) => row.category === "unclassified");
    expect(unexplained.map((row) => `${row.label}: ${row.example.official} / ${row.example.pkmn}`)).toEqual([]);
  });

  it("plays Gen 9 (singles, doubles, OU) and the Lab's Gen 4 example identically", () => {
    const strict = divergences.filter((d) => (d.formatid.startsWith("gen9") || d.formatid === "gen4customgame") && d.kind !== "team");
    expect(strict).toEqual([]);
  });

  it("the parity teams are legal for both validators", () => {
    // The probes are there to differ (they show where the validators' data moved apart).
    const failing = checkValidators().filter((d) => !VALIDATOR_PROBES.some((probe) => probe.label === d.scenario));
    expect(failing).toEqual([]);
  });
});
