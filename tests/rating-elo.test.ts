import { describe, expect, it } from "vitest";
import { ELO_FLOOR, ELO_START, eloDecay, eloDecayDays, eloExpected, eloK, eloUpdate } from "@/lib/rating/elo";

describe("Elo (Showdown's ladder)", () => {
  it("starts and floors at 1000", () => {
    expect(ELO_START).toBe(1000);
    expect(ELO_FLOOR).toBe(1000);
  });

  it("gives the expected score Elo does", () => {
    expect(eloExpected(1000, 1000)).toBe(0.5);
    expect(eloExpected(1000, 1400)).toBeCloseTo(1 / 11, 12);
    expect(eloExpected(1400, 1000)).toBeCloseTo(10 / 11, 12);
    expect(eloExpected(1200, 1000)).toBeCloseTo(0.7597469266, 9);
    expect(eloExpected(1000, 1200) + eloExpected(1200, 1000)).toBeCloseTo(1, 12);
  });

  describe("K", () => {
    it("below 1200: a loss costs 10 at the floor rising to 50, a win pays 90 falling to 50, a tie 50", () => {
      expect(eloK(1000, 0)).toBe(10);
      expect(eloK(1000, 1)).toBe(90);
      expect(eloK(1000, 0.5)).toBe(50);
      expect(eloK(1100, 0)).toBe(30);
      expect(eloK(1100, 1)).toBe(70);
      expect(eloK(1100, 0.5)).toBe(50);
      expect(eloK(1199, 0)).toBeCloseTo(49.8, 12);
      expect(eloK(1199, 1)).toBeCloseTo(50.2, 12);
      expect(eloK(1199.99, 0.5)).toBe(50);
    });

    it("is 32 from 1200 to 1350, 40 above 1350 up to 1600, and 32 above 1600, whatever the result", () => {
      for (const score of [0, 0.5, 1]) {
        expect(eloK(1200, score)).toBe(32);
        expect(eloK(1300, score)).toBe(32);
        expect(eloK(1350, score)).toBe(32);
        expect(eloK(1350.01, score)).toBe(40);
        expect(eloK(1500, score)).toBe(40);
        expect(eloK(1600, score)).toBe(40);
        expect(eloK(1600.01, score)).toBe(32);
        expect(eloK(2000, score)).toBe(32);
      }
    });
  });

  describe("update", () => {
    it("moves equals by K/2: a win from the start pays 45, a loss would cost 5 but stops at the floor, a tie is nothing", () => {
      expect(eloUpdate(1000, 1000, 1)).toBe(1045);
      expect(eloUpdate(1000, 1000, 0)).toBe(1000);
      expect(eloUpdate(1000, 1000, 0.5)).toBe(1000);
      expect(eloUpdate(1100, 1100, 0)).toBe(1085);
    });

    it("gives the two players of one game different Ks", () => {
      // 1500 (K 40) beats 1100 (K 30 for a loss): the favourite gains 40/11, the underdog loses 30/11.
      expect(eloUpdate(1500, 1100, 1)).toBeCloseTo(1500 + 40 / 11, 10);
      expect(eloUpdate(1100, 1500, 0)).toBeCloseTo(1100 - 30 / 11, 10);
      // The upset: the underdog's win pays 70 × 10/11, the favourite's loss costs 40 × 10/11.
      expect(eloUpdate(1100, 1500, 1)).toBeCloseTo(1100 + 700 / 11, 10);
      expect(eloUpdate(1500, 1100, 0)).toBeCloseTo(1500 - 400 / 11, 10);
    });

    it("never drops below the floor, and has no ceiling", () => {
      expect(eloUpdate(1000, 1500, 0)).toBe(1000);
      expect(eloUpdate(1003, 1000, 0)).toBe(1000);
      expect(eloUpdate(3000, 3000, 1)).toBe(3016);
      expect(eloUpdate(1000, 3000, 1)).toBeCloseTo(1090 - 90 / (1 + 10 ** 5), 9);
    });
  });

  describe("decay", () => {
    it("leaves 1400 and below alone", () => {
      expect(eloDecay(1000, 0)).toBe(1000);
      expect(eloDecay(1400, 0)).toBe(1400);
      expect(eloDecay(1399.5, 0, false)).toBe(1399.5);
    });

    it("loses nothing with six or more games that day", () => {
      expect(eloDecay(1800, 6)).toBe(1800);
      expect(eloDecay(2400, 40, false)).toBe(2400);
    });

    it("loses a point per 100 above 1500 with one to five games", () => {
      expect(eloDecay(1800, 1)).toBe(1797);
      expect(eloDecay(1800, 5)).toBe(1797);
      expect(eloDecay(1899, 3)).toBe(1896);
      expect(eloDecay(1600, 1)).toBe(1599);
      expect(eloDecay(1599, 1)).toBe(1599);
      expect(eloDecay(1450, 2)).toBe(1450);
    });

    it("loses a point per 50 above 1400 with no games", () => {
      expect(eloDecay(1800, 0)).toBe(1792);
      expect(eloDecay(1450, 0)).toBe(1449);
      expect(eloDecay(1449, 0)).toBe(1449);
      expect(eloDecay(1401, 0)).toBe(1401);
      expect(eloDecay(2000.5, 0)).toBe(1988.5);
    });

    it("decays two points less in a less popular format, never below nothing", () => {
      expect(eloDecay(1800, 0, false)).toBe(1794);
      expect(eloDecay(1800, 3, false)).toBe(1799);
      expect(eloDecay(1650, 3, false)).toBe(1650);
      expect(eloDecay(1500, 0, false)).toBe(1500);
      expect(eloDecay(1549, 0, false)).toBe(1549);
      expect(eloDecay(1550, 0, false)).toBe(1549);
    });

    it("defaults to a popular format", () => {
      expect(eloDecay(1800, 0)).toBe(eloDecay(1800, 0, true));
    });
  });

  describe("catching up on missed days", () => {
    it("applies each day's games in turn", () => {
      expect(eloDecayDays(1800, 3, [3, 0, 6])).toBe(1790);
      expect(eloDecayDays(1800, 3, [6, 6, 6])).toBe(1800);
    });

    it("treats days with no entry as days with no games", () => {
      expect(eloDecayDays(1800, 3, [])).toBe(1778);
      expect(eloDecayDays(1800, 2, [3])).toBe(1790);
    });

    it("is nothing for no days, and floors at 1449 (popular) or 1549 (not) with no games", () => {
      expect(eloDecayDays(1800, 0, [])).toBe(1800);
      expect(eloDecayDays(1800, 10_000, [])).toBe(1449);
      expect(eloDecayDays(1800, 10_000, [], false)).toBe(1549);
      expect(eloDecayDays(1449, 5, [])).toBe(1449);
    });

    it("keeps going past a quiet day when a later day has games", () => {
      // Day 1 at 1449 loses nothing; day 2's games still count on day 2, and day 3 is quiet again.
      expect(eloDecayDays(1449, 3, [0, 2, 0])).toBe(1449);
      expect(eloDecayDays(1550, 3, [0, 2, 0])).toBe(1550 - 3 - 0 - 2);
    });

    it("decays less in a less popular format", () => {
      expect(eloDecayDays(1800, 2, [0, 0], false)).toBe(1789);
      expect(eloDecayDays(1800, 2, [0, 0], true)).toBe(1785);
    });
  });
});
