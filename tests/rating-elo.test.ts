import { describe, expect, it } from "vitest";
import { ELO_FLOOR, ELO_START, eloDecay, eloDecayDays, eloExpected, eloK, eloUpdate } from "@/lib/rating/elo";

describe("Showdown Elo", () => {
  it("starts and floors at 1000", () => {
    expect(ELO_START).toBe(1000);
    expect(ELO_FLOOR).toBe(1000);
    expect(eloUpdate(1000, 1000, 0)).toBe(1000);
    expect(eloUpdate(1001, 1000, 0)).toBe(1000);
    expect(eloUpdate(1003, 1400, 0)).toBeGreaterThan(1000);
  });

  it("gives even odds to equal ratings and favours the higher one", () => {
    expect(eloExpected(1000, 1000)).toBe(0.5);
    expect(eloExpected(1400, 1000)).toBeCloseTo(0.909, 3);
    expect(eloExpected(1000, 1400) + eloExpected(1400, 1000)).toBeCloseTo(1, 10);
  });

  it("follows Showdown's K curve", () => {
    // Below 1200: a win is worth a lot, a loss little, meeting at 50 by 1200.
    expect(eloK(1000, 1)).toBe(90);
    expect(eloK(1000, 0)).toBe(10);
    expect(eloK(1000, 0.5)).toBe(50);
    expect(eloK(1100, 1)).toBe(70);
    expect(eloK(1100, 0)).toBe(30);
    expect(eloK(1199, 1)).toBeCloseTo(50.2, 5);
    expect(eloK(1199, 0)).toBeCloseTo(49.8, 5);
    // 1200–1350: 32. 1350–1600: 40. Above: 32.
    expect(eloK(1200, 1)).toBe(32);
    expect(eloK(1350, 0)).toBe(32);
    expect(eloK(1351, 1)).toBe(40);
    expect(eloK(1600, 0)).toBe(40);
    expect(eloK(1601, 1)).toBe(32);
    expect(eloK(2000, 0.5)).toBe(32);
  });

  it("updates by the player's own K: a new trainer gains 45 for a win and loses nothing for a loss", () => {
    expect(eloUpdate(1000, 1000, 1)).toBe(1045);
    expect(eloUpdate(1000, 1000, 0)).toBe(1000);
    expect(eloUpdate(1000, 1000, 0.5)).toBe(1000);
    // Established ratings move by K/2 on an even game.
    expect(eloUpdate(1500, 1500, 1)).toBe(1520);
    expect(eloUpdate(1500, 1500, 0)).toBe(1480);
    expect(eloUpdate(1250, 1250, 1)).toBe(1266);
    // An upset moves more than a formality.
    expect(eloUpdate(1300, 1500, 1)).toBeGreaterThan(eloUpdate(1500, 1300, 1) - 1500 + 1300);
  });

  it("decays only above 1400, by the day's games", () => {
    expect(eloDecay(1400, 0)).toBe(1400);
    expect(eloDecay(1399, 0)).toBe(1399);
    // Six games: safe.
    expect(eloDecay(1800, 6)).toBe(1800);
    expect(eloDecay(1800, 12)).toBe(1800);
    // One to five games: a point per 100 above 1500.
    expect(eloDecay(1800, 1)).toBe(1797);
    expect(eloDecay(1800, 5)).toBe(1797);
    expect(eloDecay(1599, 3)).toBe(1599);
    expect(eloDecay(1600, 3)).toBe(1599);
    expect(eloDecay(1450, 2)).toBe(1450);
    // No games: a point per 50 above 1400.
    expect(eloDecay(1800, 0)).toBe(1792);
    expect(eloDecay(1450, 0)).toBe(1449);
    expect(eloDecay(1449, 0)).toBe(1449);
    expect(eloDecay(1401, 0)).toBe(1401);
  });

  it("decays a quiet ladder at half the rate", () => {
    expect(eloDecay(1800, 0, false)).toBe(1796);
    expect(eloDecay(1800, 1, false)).toBe(1799);
    expect(eloDecay(1450, 0, false)).toBe(1450);
  });

  it("catches up over several days, each with its own games", () => {
    expect(eloDecayDays(1800, 0, [])).toBe(1800);
    expect(eloDecayDays(1800, 1, [0])).toBe(1792);
    expect(eloDecayDays(1800, 2, [0])).toBe(eloDecay(eloDecay(1800, 0), 0));
    expect(eloDecayDays(1800, 3, [6, 2, 0])).toBe(eloDecay(eloDecay(1800, 2), 0));
    // A long absence drains to the 1400 line and no further.
    expect(eloDecayDays(1800, 400, [])).toBeGreaterThanOrEqual(1400);
    expect(eloDecayDays(1800, 400, [])).toBeLessThan(1450);
    expect(eloDecayDays(1200, 400, [])).toBe(1200);
  });
});
