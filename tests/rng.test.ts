import { describe, expect, it } from "vitest";
import { Rng, hashString } from "@/lib/rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng("pikachu");
    const b = new Rng("pikachu");
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it("diverges across seeds", () => {
    expect(new Rng("a").next()).not.toEqual(new Rng("b").next());
  });

  it("stays in range and is roughly uniform", () => {
    const rng = new Rng(42);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20_000; i++) {
      const n = rng.int(0, 9);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(9);
      buckets[n]++;
    }
    for (const count of buckets) expect(count).toBeGreaterThan(1700);
  });

  it("shuffle is a permutation and does not mutate input", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = new Rng("s").shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(input);
  });

  it("hashString is stable", () => {
    expect(hashString("PokéIQ")).toBe(hashString("PokéIQ"));
    expect(hashString("PokéIQ")).not.toBe(hashString("PokeIQ"));
  });
});
