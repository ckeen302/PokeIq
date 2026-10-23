import { describe, expect, it } from "vitest";
import { generatePuzzle, validatePuzzle } from "@/lib/connections/generator";
import { packIds } from "@/lib/connections/packs";
import { CONN_PACKS, parsePracticeSeed } from "@/lib/connections/pack-seed";
import { factsOf } from "@/lib/connections/facts";
import { practiceConnPuzzle } from "@/lib/server/connections";

describe("themed packs", () => {
  it("read their Pokémon from the data", () => {
    expect([...packIds("kanto")].every((id) => id >= 1 && id <= 151)).toBe(true);
    expect(packIds("kanto").size).toBe(151);
    expect([...packIds("gen9")].every((id) => factsOf(id).gen === 9)).toBe(true);
    const comp = [...packIds("competitive")].map((id) => factsOf(id).name);
    expect(comp.length).toBeGreaterThan(30);
    expect(comp).toContain("Great Tusk");
  });

  it("parse out of a practice seed", () => {
    expect(parsePracticeSeed("kanto-hard-abcd1234")).toEqual({ pack: "kanto", difficulty: "hard" });
    expect(parsePracticeSeed("gen9-normal-abcd1234")).toEqual({ pack: "gen9" });
    expect(parsePracticeSeed("competitive-abcd1234")).toEqual({ pack: "competitive" });
    expect(parsePracticeSeed("easy-abcd1234")).toEqual({ difficulty: "easy" });
  });

  for (const pack of CONN_PACKS) {
    it(`${pack}: every tile is from the pack and the puzzle is fair, seeded`, () => {
      const allowed = packIds(pack);
      for (const seed of ["a1", "b2", "c3", "d4", "e5"]) {
        const p = generatePuzzle(seed, { pack });
        expect(validatePuzzle(p)).toEqual([]);
        expect(p.tiles).toHaveLength(16);
        expect(p.tiles.every((id) => allowed.has(id))).toBe(true);
        expect(generatePuzzle(seed, { pack })).toEqual(p);
      }
    });
  }

  it("a pack in the practice seed is served the same puzzle every time, with no mixed groups", () => {
    const a = practiceConnPuzzle("kanto-normal-abcd1234");
    expect(practiceConnPuzzle("kanto-normal-abcd1234")).toBe(a);
    expect(a.tiles.every((id) => id <= 151)).toBe(true);
    expect(a.groups.every((g) => !g.category.startsWith("mixed:"))).toBe(true);
  });
});
