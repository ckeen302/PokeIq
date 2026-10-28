import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { Dex } from "pokemon-showdown";
import randsets from "../src/data/battle/randsets.json";

const installed = (createRequire(import.meta.url)("pokemon-showdown/package.json") as { version: string }).version;

describe("the random-battle sets file (src/data/battle/randsets.json)", () => {
  it("was built from the installed pokemon-showdown (else: npx tsx scripts/build-randsets.ts)", () => {
    expect(randsets.version).toBe(installed);
  });

  it("covers every Pokémon in Showdown's Gen 9 random-battle data, with sensible entries", async () => {
    const { default: singles } = await import("pokemon-showdown/dist/data/random-battles/gen9/sets.json");
    const table = randsets.formats.gen9randombattle as Record<string, { level: number | null; abilities: string[]; moves: string[]; items: string[]; teraTypes: string[] }>;
    for (const id of Object.keys(singles)) {
      if (!Dex.species.get(id).exists) continue;
      const entry = table[id];
      expect(entry, id).toBeDefined();
      expect(entry.moves.length, id).toBeGreaterThan(0);
      expect(entry.abilities.length, id).toBeGreaterThan(0);
    }
    const garchomp = table.garchomp;
    expect(garchomp.level).toBeTypeOf("number");
    expect(garchomp.moves).toContain("Earthquake");
    expect(Object.keys(randsets.formats.gen9randomdoublesbattle).length).toBeGreaterThan(400);
  });
});
