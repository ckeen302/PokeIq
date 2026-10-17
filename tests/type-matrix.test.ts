import { describe, expect, it } from "vitest";
import { TYPES, defensiveProfile, effectiveness } from "@/lib/pokemon/type-matrix";

describe("type matrix", () => {
  it("covers all 18 types", () => expect(TYPES).toHaveLength(18));

  it.each([
    ["ground", ["fire", "flying"], 0],
    ["ice", ["grass", "flying"], 4],
    ["ice", ["dragon", "ground"], 4],
    ["fighting", ["ghost"], 0],
    ["fire", ["water", "rock"], 0.25],
    ["electric", ["water", "flying"], 4],
    ["dragon", ["fairy"], 0],
    ["steel", ["fairy"], 2],
    ["fairy", ["fighting", "dark"], 4],
    ["normal", ["normal"], 1],
  ] as const)("%s → %s = %s×", (atk, def, expected) => {
    expect(effectiveness(atk, def)).toBe(expected);
  });

  it("only produces in-game multipliers", () => {
    const allowed = new Set([0, 0.25, 0.5, 1, 2, 4]);
    for (const a of TYPES) for (const b of TYPES) {
      for (const m of defensiveProfile(a === b ? [a] : [a, b]).values()) expect(allowed.has(m)).toBe(true);
    }
  });
});
