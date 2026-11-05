import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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

  /**
   * The content itself, not just the version string: species, levels,
   * moves, abilities and Tera types hashed from Showdown's own files
   * against the same fields in ours. Items come from sampling the generator,
   * so they're left out.
   */
  it.each([
    ["gen9randombattle", "sets.json"],
    ["gen9randomdoublesbattle", "doubles-sets.json"],
  ] as const)("matches Showdown's %s data (%s) entry for entry", async (format, file) => {
    type Sets = Record<string, { level?: number; sets: { movepool: string[]; abilities: string[]; teraTypes?: string[] }[] }>;
    const { default: source } = (await import(`pokemon-showdown/dist/data/random-battles/gen9/${file}`)) as { default: Sets };
    const uniq = (list: string[]) => [...new Set(list)].sort();
    const fromShowdown = Object.entries(source)
      .filter(([id]) => Dex.species.get(id).exists)
      .map(([id, e]) => ({
        id: Dex.species.get(id).id,
        level: e.level ?? null,
        moves: uniq(e.sets.flatMap((s) => s.movepool)),
        abilities: uniq(e.sets.flatMap((s) => s.abilities)),
        teraTypes: uniq(e.sets.flatMap((s) => s.teraTypes ?? [])),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const table = randsets.formats[format] as Record<string, { level: number | null; abilities: string[]; moves: string[]; teraTypes: string[] }>;
    const ours = Object.entries(table)
      .map(([id, e]) => ({ id, level: e.level, moves: e.moves, abilities: e.abilities, teraTypes: e.teraTypes }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const hash = (rows: unknown[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    if (hash(ours) !== hash(fromShowdown)) {
      // Name the first few that differ, so a failure says what to rebuild.
      const theirs = new Map(fromShowdown.map((r) => [r.id, JSON.stringify(r)]));
      const differ = ours.filter((r) => theirs.get(r.id) !== JSON.stringify(r)).map((r) => r.id);
      const missing = fromShowdown.filter((r) => !(r.id in table)).map((r) => r.id);
      expect({ differ: differ.slice(0, 10), missing: missing.slice(0, 10) }, "rebuild with: npx tsx scripts/build-randsets.ts").toEqual({ differ: [], missing: [] });
    }
    expect(hash(ours)).toBe(hash(fromShowdown));
  });
});
