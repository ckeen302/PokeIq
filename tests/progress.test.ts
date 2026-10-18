import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "@/lib/session-types";

// progress.ts persists to localStorage; give the node test env an in-memory one.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

async function freshProgress() {
  vi.resetModules();
  return import("@/lib/progress");
}

function dailyRun(date: string, sid: string): RunResult {
  return {
    sid,
    spec: { module: "mixed", format: "classic", difficulty: "medium", seed: `daily:${date}`, daily: date },
    score: 1000,
    correct: 8,
    total: 10,
    bestStreak: 5,
    grid: "1111101110",
    durationMs: 60_000,
    rating: 1300,
    pokeiq: 108,
    finishedAt: 0,
  };
}

describe("currentStreak", () => {
  it("keeps a streak alive through yesterday and breaks it after a missed day", async () => {
    const { currentStreak } = await freshProgress();
    expect(currentStreak("2026-10-20", 5, "2026-10-20")).toBe(5);
    expect(currentStreak("2026-10-19", 5, "2026-10-20")).toBe(5);
    expect(currentStreak("2026-10-18", 5, "2026-10-20")).toBe(0);
    expect(currentStreak(null, 0, "2026-10-20")).toBe(0);
    // Across a month boundary.
    expect(currentStreak("2026-10-31", 3, "2026-11-01")).toBe(3);
  });
});

describe("recordRun daily bonus", () => {
  beforeEach(() => store.clear());

  it("pays the daily XP bonus and streak only once per date", async () => {
    const { recordRun, getProgress } = await freshProgress();
    const first = recordRun(dailyRun("2026-10-20", "a"));
    const second = recordRun(dailyRun("2026-10-20", "b"));
    expect(first.xp - second.xp).toBe(50);
    const p = getProgress();
    expect(p.daily.streak).toBe(1);
    expect(p.daily.results["2026-10-20"].correct).toBe(8);
  });

  it("extends the streak on consecutive days", async () => {
    const { recordRun, getProgress } = await freshProgress();
    recordRun(dailyRun("2026-10-20", "a"));
    recordRun(dailyRun("2026-10-21", "b"));
    expect(getProgress().daily.streak).toBe(2);
    recordRun(dailyRun("2026-10-23", "c"));
    expect(getProgress().daily.streak).toBe(1);
  });
});

describe("PokéGuessr daily streak", () => {
  it("counts consecutive daily games and resets after a missed day", async () => {
    const { recordGeoGame, geoDailyStreak, getProgress } = await import("@/lib/progress");
    const play = (daily: string) => recordGeoGame("kanto:classic", { kind: "game", score: 12000, rounds: [5000, 3000, 2000, 1000, 1000], daily });
    play("2026-11-01");
    play("2026-11-02");
    expect(geoDailyStreak(getProgress(), "2026-11-02")).toBe(2);
    expect(geoDailyStreak(getProgress(), "2026-11-03")).toBe(2);
    expect(geoDailyStreak(getProgress(), "2026-11-04")).toBe(0);
    play("2026-11-02");
    expect(getProgress().best["geo:dailyStreak"]).toBe(2);
    const first = play("2026-11-03");
    expect(geoDailyStreak(getProgress(), "2026-11-03")).toBe(3);
    expect(first.newBadges.map((b) => b.id)).not.toContain("geo-first");
  });
});
