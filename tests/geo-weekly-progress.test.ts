import { describe, expect, it } from "vitest";
import {
  GEO_WEEKLY_ROTATION,
  geoPreviousWeek,
  geoWeekOf,
  geoWeeklyCandidates,
  geoWeeklyEndsAt,
  geoWeeklyMap,
  geoWeeklyNumber,
  isGeoWeek,
} from "@/lib/geo-weekly";
import { GEO_ACHIEVEMENTS, GEO_EXPERT_ROUNDS, geoAchievement } from "@/lib/geo-achievements";
import { achievementStates, geoProgressFor, longestDayRun, masteryFromRounds, metricsFromRounds } from "@/lib/server/geo-progress";
import { clearMemoryRoundScores, geoStatsKey, logRoundScore, type PlayerRoundRow } from "@/lib/server/geo-round-scores";
import { currentGeoWeekly, geoMasteryIndex, geoRegions, isGeoSpec, planRounds, startGeo } from "@/lib/server/geo";
import { GEO_MAP_ORDER } from "@/lib/geo-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const row = (r: Partial<PlayerRoundRow>): PlayerRoundRow => ({ region: null, family: null, kind: "game", score: 0, hit: null, run: null, ...r });

describe("Weekly Challenge calendar", () => {
  it("turns at Monday 00:00 UTC", () => {
    expect(geoWeekOf(Date.parse("2026-10-29T12:00:00Z"))).toBe("2026-10-26");
    expect(geoWeekOf(Date.parse("2026-11-01T23:59:59Z"))).toBe("2026-10-26");
    expect(geoWeekOf(Date.parse("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
    expect(geoWeekOf(Date.parse("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
    expect(geoWeeklyEndsAt("2026-10-26")).toBe(Date.parse("2026-11-02T00:00:00Z"));
    expect(geoWeeklyNumber("2026-10-26")).toBe(1);
    expect(geoWeeklyNumber("2026-11-02")).toBe(2);
    expect(geoPreviousWeek("2026-11-02")).toBe("2026-10-26");
  });

  it("only takes real Mondays from launch", () => {
    expect(isGeoWeek("2026-10-26")).toBe(true);
    expect(isGeoWeek("2026-10-27")).toBe(false);
    expect(isGeoWeek("2026-10-19")).toBe(false);
    expect(isGeoWeek("2026-02-30")).toBe(false);
    expect(isGeoWeek(42)).toBe(false);
  });

  it("rotates deterministically over maps that exist", () => {
    for (const id of GEO_WEEKLY_ROTATION) expect(GEO_MAP_ORDER).toContain(id);
    expect(geoWeeklyCandidates("2026-10-26")[0]).toBe(GEO_WEEKLY_ROTATION[0]);
    expect(geoWeeklyCandidates("2026-11-02")[0]).toBe(GEO_WEEKLY_ROTATION[1]);
    // A full turn later, the same map again.
    const later = new Date(Date.parse("2026-10-26T00:00:00Z") + GEO_WEEKLY_ROTATION.length * 7 * 86_400_000).toISOString().slice(0, 10);
    expect(geoWeeklyCandidates(later)[0]).toBe(GEO_WEEKLY_ROTATION[0]);
    // An unplayable map passes to the next in line.
    expect(geoWeeklyMap("2026-10-26", (id) => id !== GEO_WEEKLY_ROTATION[0])).toBe(GEO_WEEKLY_ROTATION[1]);
  });

  it("plays the same five places for everyone all week, and keeps them sealed", () => {
    const weekly = currentGeoWeekly(Date.parse("2026-10-29T12:00:00Z"));
    expect(weekly).not.toBeNull();
    expect(isGeoSpec({ region: weekly!.region, kind: "game" })).toBe(true);
    const spec = { region: weekly!.region, kind: "game" as const, weekly: weekly!.week };
    const a = planRounds(spec, `geo-weekly:${weekly!.week}`);
    const b = planRounds(spec, `geo-weekly:${weekly!.week}`);
    expect(a).toHaveLength(5);
    expect(a.map((r) => r.shot)).toEqual(b.map((r) => r.shot));
    const one = startGeo(spec);
    const two = startGeo(spec);
    expect(one.round.shot).toBe(two.round.shot);
    // The first round gives out a picture, never the place.
    expect(JSON.stringify(one.round)).not.toMatch(/"(name|pin|mask|location|region)"/);
  });
});

describe("PokéGuessr achievements and mastery", () => {
  it("defines every achievement once", () => {
    const ids = GEO_ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(geoAchievement("expert-johto")?.name).toBe("Johto Expert");
  });

  it("counts perfect rounds, streak runs, daily runs and region averages", () => {
    const day = (d: string) => Date.parse(`${d}T15:00:00Z`);
    const m = metricsFromRounds([
      row({ score: 5000, region: "Kanto" }),
      row({ score: 5000, region: "Kanto" }),
      row({ score: 3000, region: "Johto" }),
      row({ kind: "streak", run: "s1", hit: true, score: 4000 }),
      row({ kind: "streak", run: "s1", hit: true, score: 4000 }),
      row({ kind: "streak", run: "s1", hit: false, score: 100 }),
      row({ kind: "region-streak", run: "r1", hit: true, score: 5000 }),
      row({ kind: "region-streak", run: "r1", hit: true, score: 5000 }),
      row({ kind: "region-streak", run: "r1", hit: true, score: 5000 }),
      row({ kind: "daily", at: day("2026-10-20"), score: 10 }),
      row({ kind: "daily", at: day("2026-10-21"), score: 10 }),
      row({ kind: "daily", at: day("2026-10-21"), score: 10 }),
      row({ kind: "daily", at: day("2026-10-22"), score: 10 }),
      row({ kind: "daily", at: day("2026-10-25"), score: 10 }),
    ]);
    // Region streak picks score 5,000 when right but aren't pin rounds.
    expect(m.perfectRounds).toBe(2);
    expect(m.rounds).toBe(11);
    expect(m.bestStreak).toBe(3);
    expect(m.dailyStreakBest).toBe(3);
    expect(m.regions.Kanto).toEqual({ rounds: 2, avg: 5000 });
    expect(longestDayRun([])).toBe(0);

    const states = achievementStates(m);
    const get = (id: string) => states.find((s) => s.id === id)!;
    expect(get("perfect-1").earned).toBe(true);
    expect(get("perfect-10")).toMatchObject({ earned: false, have: 2, need: 10 });
    expect(get("daily-3").earned).toBe(true);
    expect(get("expert-kanto")).toMatchObject({ earned: false, have: 2, need: GEO_EXPERT_ROUNDS });
    // A recorded achievement stays earned.
    expect(achievementStates(m, new Map([["perfect-100", 1]])).find((s) => s.id === "perfect-100")?.earned).toBe(true);
  });

  it("needs both the rounds and the average for a region expert", () => {
    const many = (score: number) => Array.from({ length: GEO_EXPERT_ROUNDS }, () => row({ region: "Johto", score }));
    const expert = (rows: PlayerRoundRow[]) => achievementStates(metricsFromRounds(rows)).find((s) => s.id === "expert-johto")!.earned;
    expect(expert(many(4000))).toBe(true);
    expect(expert(many(2000))).toBe(false);
    expect(expert(many(4000).slice(1))).toBe(false);
  });

  it("works out mastery from the places scored 4,000+ at least once", () => {
    const index = geoMasteryIndex();
    const kanto = index.regions.find((r) => r.id === "kanto")!;
    expect(kanto.areas.size).toBe(geoRegions().find((r) => r.id === "kanto")!.locations);
    // Two shots of one Kanto place, and one shot of another.
    const byArea = new Map<string, string[]>();
    for (const [shot, area] of index.areaOfShot) if (kanto.areas.has(area)) byArea.set(area, [...(byArea.get(area) ?? []), shot]);
    const [[, shotsA], [, shotsB]] = [...byArea].filter(([, s]) => s.length > 1);
    const rows = [row({ shot: shotsA[0], score: 4500 }), row({ shot: shotsA[1], score: 4900 }), row({ shot: shotsB[0], score: 3999 })];
    const k = masteryFromRounds(rows, index).find((r) => r.id === "kanto")!;
    expect(k.mastered).toBe(1);
    expect(k.places).toBe(kanto.areas.size);
  });

  it("reads a trainer's progress from their logged rounds", async () => {
    clearMemoryRoundScores();
    const key = geoStatsKey("d:test-device-123");
    await logRoundScore({ shot: "abcdefgh", score: 5000, mode: "solo", kind: "game", player: { key, name: null }, region: "Kanto" });
    const progress = await geoProgressFor({ key });
    expect(progress.rounds).toBe(1);
    expect(progress.perfectRounds).toBe(1);
    expect(progress.achievements.find((a) => a.id === "perfect-1")?.earned).toBe(true);
    expect(progress.mastery).toHaveLength(9);
  });
});
