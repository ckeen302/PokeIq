import { describe, expect, it } from "vitest";
import RECORDS from "@/data/games-records.json";
import { GAMES_ATHLETES, GAMES_BY_KEY } from "@/lib/games/data";
import { buildRecords, indexRecords, RECORD_EVENTS, type RecordsFile } from "@/lib/games/records";
import { POKEDEX } from "@/lib/pokemon/pokedex";

/**
 * The records (src/data/games-records.json) are the model's output, built
 * by scripts/games-records.ts. They must match the model exactly (a
 * changed constant means running the script again), cover every athlete,
 * and pass the design's sanity checks.
 */

const file = RECORDS as unknown as RecordsFile;
const species = indexRecords(file, (k) => GAMES_BY_KEY.get(k)?.entrant.kind === "pokemon");
const all = indexRecords(file);

describe("games records", () => {
  it("cover every Pokémon and every form with its own stats", () => {
    expect(file.rows).toHaveLength(GAMES_ATHLETES.length);
    expect(species.keys).toHaveLength(POKEDEX.length);
    expect(file.events).toEqual([...RECORD_EVENTS]);
  });

  it("match the model (run scripts/games-records.ts after a change)", () => {
    expect(buildRecords(GAMES_ATHLETES)).toEqual(file);
  }, 120_000);

  it("pass the sanity table", () => {
    expect(species.ranking("100m")[0]).toBe("regieleki");
    expect(["groudon", "copperajah"]).toContain(species.ranking("weightlifting")[0]);
    const p4p = species.ranking("weightlifting").map((k) => ({ k, r: species.mark(k, "weightlifting")! / GAMES_BY_KEY.get(k)!.kg })).sort((a, b) => b.r - a.r)[0];
    expect(GAMES_BY_KEY.get(p4p.k)!.kg).toBeLessThan(5);
    expect(GAMES_BY_KEY.get(p4p.k)!.stats.atk).toBeGreaterThan(100);
    for (const e of ["50m-freestyle", "100m-freestyle"] as const) {
      const w = GAMES_BY_KEY.get(species.ranking(e)[0])!;
      expect(w.types.includes("water") || w.shape === "fish").toBe(true);
    }
    // Shuckle is the slowest over 100 m; Blissey (55 Speed) mid-field.
    expect(species.ranking("100m").at(-1)).toBe("shuckle");
    const b = species.rank("blissey", "100m")!;
    expect(b).toBeGreaterThan(300);
    expect(b).toBeLessThan(900);
  });

  it("stay inside plausible bounds (no Magikarp throws a shot 100 m)", () => {
    const bounds: Record<string, [number, number]> = { "100m": [4, 400], "long-jump": [0, 30], "high-jump": [0, 16], "shot-put": [0, 100], javelin: [0, 115], weightlifting: [2, 3000], "50m-freestyle": [10, 600] };
    for (const [e, [lo, hi]] of Object.entries(bounds)) {
      for (const k of all.ranking(e as never)) {
        const v = all.mark(k, e as never)!;
        expect(v, `${k} ${e}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${k} ${e}`).toBeLessThanOrEqual(hi);
      }
    }
    expect(all.mark("magikarp", "shot-put")).toBeNull();
  });

  it("give every type a nation of three", () => {
    for (const [t, keys] of Object.entries(file.nations)) {
      expect(keys.length, t).toBeGreaterThanOrEqual(3);
      for (const k of keys) expect(GAMES_BY_KEY.get(k)!.types).toContain(t);
    }
  });
});
