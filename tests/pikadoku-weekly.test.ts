import { beforeEach, describe, expect, it } from "vitest";
import { gridFromIds } from "@/lib/pikadoku/generator";
import { isSolvable } from "@/lib/pikadoku/solve";
import { decodeShare, encodeShare, pikadokuShareText } from "@/lib/share";
import { WEEK_THEMES, isLiveWeek, themeFor, weekEnd, weekNumber, weekStart, weeklyIds } from "@/lib/pikadoku/weekly";
import { clearMemoryPdk, memoryPdkStore } from "@/lib/server/pikadoku-board";
import { finishGame } from "@/lib/server/pikadoku-result";
import { weeklyGrid } from "@/lib/server/pikadoku";
import { resolveGrid } from "@/lib/server/pikadoku-http";
import { solveGrid } from "@/lib/pikadoku/solve";
import { DEFAULT_PDK_SETTINGS } from "@/lib/pikadoku/types";

describe("weeks", () => {
  it("run Monday to Sunday", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // a Monday
    expect(weekStart("2026-10-22")).toBe("2026-10-19"); // launch day, a Thursday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekEnd("2026-10-19")).toBe("2026-10-25");
  });
  it("numbers weeks from the launch week", () => {
    expect(weekNumber("2026-10-19")).toBe(1);
    expect(weekNumber("2026-10-26")).toBe(2);
    expect(weekNumber("2026-11-30")).toBe(7);
  });
  it("rotates Kanto, Starters, Legendary, Gen 9, Competitive, then round again", () => {
    expect(WEEK_THEMES.map((t) => t.id)).toEqual(["kanto", "starters", "legendary", "gen9", "competitive"]);
    const mondays = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];
    expect(mondays.map((m) => themeFor(m).id)).toEqual(["kanto", "starters", "legendary", "gen9", "competitive"]);
    expect(themeFor("2026-11-23").id).toBe("kanto"); // week 6
  });
  it("is live only for the current week (within a day of UTC's)", () => {
    const now = Date.parse("2026-10-23T12:00:00Z"); // Friday
    expect(isLiveWeek("2026-10-19", now)).toBe(true);
    expect(isLiveWeek("2026-10-26", now)).toBe(false);
    expect(isLiveWeek("2026-10-12", now)).toBe(false);
    expect(isLiveWeek("2026-10-21", now)).toBe(false); // not a Monday
    expect(isLiveWeek("2026-10-26", Date.parse("2026-10-25T23:00:00Z"))).toBe(true); // a time zone ahead of UTC
    expect(isLiveWeek("nope", now)).toBe(false);
  });
});

describe("weekly grids", () => {
  it("are generated from the theme's subset, with its anchor, solvable and stable", () => {
    for (let i = 0; i < 20; i++) {
      const monday = weekStart(new Date(Date.parse("2026-10-19T00:00:00Z") + i * 7 * 86_400_000).toISOString().slice(0, 10));
      const theme = themeFor(monday);
      const ids = weeklyIds(monday);
      expect(ids).toEqual(weeklyIds(monday));
      expect(ids.rows[0]).toBe(theme.anchor);
      expect(new Set([...ids.rows, ...ids.cols]).size).toBe(6);
      const grid = gridFromIds(ids);
      expect(isSolvable(grid.answers, theme.min), `${theme.id} ${monday}`).toBe(true);
      expect(grid.rows.slice(1).concat(grid.cols).every((c) => theme.allow(c)), `${theme.id} ${monday}`).toBe(true);
    }
  });
  it("differs from week to week", () => {
    expect(weeklyIds("2026-10-19")).not.toEqual(weeklyIds("2026-10-26"));
    expect(weeklyIds("2026-10-19").rows[0]).toBe("region:1"); // Kanto week
    expect(weeklyIds("2026-11-02").rows[0]).toBe("other:lm"); // Legendary week
  });
});

describe("weekly play on the server", () => {
  beforeEach(() => clearMemoryPdk());
  const MONDAY = "2026-10-19";
  const NOW = Date.parse("2026-10-23T12:00:00Z");
  const winning = () => [...solveGrid(weeklyGrid(MONDAY).answers)!].map(([cell, id]) => ({ cell, id }));
  const base = { week: MONDAY, difficulty: "normal" as const, settings: DEFAULT_PDK_SETTINGS, identity: "d:bbbbbbbbbbbbbbbbbbbb", name: "Misty" };

  it("is dealt like a daily: nine PP, nothing practice-only", () => {
    const found = resolveGrid({ week: MONDAY, difficulty: "normal" }, NOW);
    expect("grid" in found && found.daily).toBe(true);
    expect("grid" in found && found.weekly?.theme).toBe("Kanto week");
    expect("error" in resolveGrid({ week: "2026-10-21", difficulty: "normal" }, NOW)).toBe(true);
  });
  it("has its own board, separate from the day's", async () => {
    const store = memoryPdkStore();
    const out = await finishGame({ ...base, guesses: winning(), start: undefined }, store, NOW);
    expect(out.ok && out.result.counted).toBe(true);
    expect((await store.counts(MONDAY, "weekly"))!.totals.some((t) => t > 0)).toBe(true);
    expect((await store.counts(MONDAY, "normal"))!.totals.every((t) => t === 0)).toBe(true);
  });
  it("is not recorded once the week is over", async () => {
    const store = memoryPdkStore();
    const out = await finishGame({ ...base, guesses: winning() }, store, Date.parse("2026-11-04T12:00:00Z"));
    expect(out.ok && out.result.counted).toBe(false);
    expect((await store.counts(MONDAY, "weekly"))!.totals.every((t) => t === 0)).toBe(true);
  });
  it("shares as a weekly result, colours only", () => {
    const r = { game: "pikadoku" as const, weekly: 1, difficulty: "normal" as const, grid: "pbgyxxxxx" };
    expect(decodeShare(encodeShare(r))).toEqual(r);
    expect(pikadokuShareText(r)).toContain("Pikadoku Weekly #1");
  });
});
