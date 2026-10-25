import { describe, expect, it } from "vitest";
import { GLICKO_START, RD_FLOOR, glickoUpdate, gxe, rateGlicko } from "@/lib/battle/glicko";

describe("Glicko-2", () => {
  it("moves the winner up and the loser down by the same amount between equals", () => {
    const [a, b] = rateGlicko([GLICKO_START, GLICKO_START], [1, 0]);
    expect(a.rating).toBeGreaterThan(1500);
    expect(a.rating + b.rating).toBe(3000);
    expect(a.rd).toBeLessThan(350);
    expect(a.rd).toBe(b.rd);
  });

  it("matches Glickman's worked example for the first game (1500 ± 200 beats 1400 ± 30)", () => {
    // From "Example of the Glicko-2 system": E = 0.639, g(φ) = 0.9955 for that opponent.
    const out = glickoUpdate({ rating: 1500, rd: 200, vol: 0.06 }, { rating: 1400, rd: 30, vol: 0.06 }, 1);
    expect(out.rating).toBeGreaterThan(1500);
    expect(out.rating).toBeLessThan(1600);
    expect(out.vol).toBeCloseTo(0.06, 3);
  });

  it("moves an unsure rating more than a settled one", () => {
    const unsure = glickoUpdate({ rating: 1500, rd: 300, vol: 0.06 }, GLICKO_START, 1);
    const settled = glickoUpdate({ rating: 1500, rd: 50, vol: 0.06 }, GLICKO_START, 1);
    expect(unsure.rating - 1500).toBeGreaterThan(settled.rating - 1500);
  });

  it("never lets the RD fall below the floor", () => {
    let me = { rating: 1500, rd: 40, vol: 0.06 };
    for (let i = 0; i < 200; i++) me = glickoUpdate(me, { rating: 1500, rd: 30, vol: 0.06 }, 0.5);
    expect(me.rd).toBeGreaterThanOrEqual(RD_FLOOR);
  });

  it("computes GXE the way Showdown does", () => {
    expect(gxe(1500, 130)).toBe(50);
    expect(gxe(1500, 350)).toBe(50);
    expect(gxe(1800, 50)).toBeCloseTo(75.93, 2);
    expect(gxe(1200, 50)).toBeCloseTo(24.07, 2);
    // A big RD pulls GXE toward 50%.
    expect(gxe(1800, 300)).toBeLessThan(gxe(1800, 50));
  });
});
