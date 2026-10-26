import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_RAMP_FROM, difficultyOf, heuristicDifficultyOf, isGeoSpec, planRounds, setShotScores } from "@/lib/server/geo";
import { FLAGGED_WEIGHT, MIN_SCORED_ROUNDS, SHOT_FLAG, fitsMode, flagNames, heuristicDifficulty, rampOrder, scoredDifficulty, shotWeight } from "@/lib/geo-difficulty";
import { COMPARE_MIN_PLAYERS, bucketOf, dailyStats, percentBeaten } from "@/lib/geo-compare";
import { WORLD_REGION } from "@/lib/geo-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const root = process.cwd();
const geo = JSON.parse(readFileSync(path.join(root, "src/data/geo.json"), "utf8")) as { world: { locations: { shots: { id: string }[] }[] } };
const meta = JSON.parse(readFileSync(path.join(root, "src/data/geo-shot-meta.json"), "utf8")) as { shots: Record<string, [number, number, number, number]> };
const ids = geo.world.locations.flatMap((l) => l.shots.map((s) => s.id));

describe("the screenshot audit", () => {
  it("rates every shot in the data, and nothing else", () => {
    expect(ids.filter((id) => !meta.shots[id])).toEqual([]);
    expect(Object.keys(meta.shots).filter((id) => !ids.includes(id))).toEqual([]);
  });
  it("keeps ratings between 1 and 5", () => {
    for (const [, , flags, d] of Object.values(meta.shots)) {
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(50);
      expect(flags).toBeLessThan(16);
    }
  });
  it("names flags", () => {
    expect(flagNames(SHOT_FLAG.tall | SHOT_FLAG.ui)).toEqual(["ui", "tall"]);
  });
  it("rates a town easier than a cave inside a building", () => {
    const town = heuristicDifficulty({ name: "Hammerlocke", family: "swsh", flags: 0, detail: 20, placeShots: 12 });
    const city = heuristicDifficulty({ name: "Saffron City", family: "lgpe", flags: 0, detail: 20, placeShots: 12 });
    const cave = heuristicDifficulty({ name: "Rock Tunnel", parent: "Route 10", family: "rby", flags: SHOT_FLAG.ui, detail: 5, placeShots: 1 });
    expect(city).toBeLessThan(town);
    expect(cave).toBeGreaterThan(city + 1);
  });
});

describe("weights and modes", () => {
  it("deals flagged shots less, never not at all", () => {
    expect(shotWeight(3, SHOT_FLAG.blurry)).toBe(FLAGGED_WEIGHT);
    expect(shotWeight(3, 0)).toBe(1);
    expect(shotWeight(3, SHOT_FLAG.tall, "easy")).toBeGreaterThan(0);
  });
  it("leans Easy to easy shots and Hard to hard ones", () => {
    expect(shotWeight(1.5, 0, "easy")).toBeGreaterThan(shotWeight(4.5, 0, "easy"));
    expect(shotWeight(4.5, 0, "hard")).toBeGreaterThan(shotWeight(1.5, 0, "hard"));
    expect(fitsMode(2.5, "easy") && !fitsMode(3.5, "easy") && fitsMode(3.5, "hard") && fitsMode(9, "normal")).toBe(true);
  });
  it("moves a rating toward players' scores only with enough rounds", () => {
    expect(scoredDifficulty(3, 5000, MIN_SCORED_ROUNDS - 1)).toBe(3);
    expect(scoredDifficulty(3, 5000, MIN_SCORED_ROUNDS * 4)).toBe(1);
    expect(scoredDifficulty(3, 0, MIN_SCORED_ROUNDS * 4)).toBe(5);
  });
  it("orders a ramp easiest first", () => {
    expect(rampOrder([{ difficulty: 4 }, { difficulty: 2 }, { difficulty: 3 }]).map((r) => r.difficulty)).toEqual([2, 3, 4]);
  });
});

describe("Easy, Hard and the Daily ramp", () => {
  const avg = (rounds: { shot: string }[]) => rounds.reduce((s, r) => s + difficultyOf(r.shot), 0) / rounds.length;
  it("plays Easy and Hard on the world map", () => {
    expect(isGeoSpec({ region: WORLD_REGION, kind: "game", difficulty: "easy" })).toBe(true);
    expect(isGeoSpec({ region: WORLD_REGION, kind: "game", difficulty: "hard" })).toBe(true);
    expect(isGeoSpec({ region: "kanto", kind: "streak", difficulty: "hard" })).toBe(true);
  });
  it("deals easier shots in Easy than in Hard", () => {
    const easy: { shot: string }[] = [];
    const hard: { shot: string }[] = [];
    for (let i = 0; i < 40; i++) {
      easy.push(...planRounds({ region: WORLD_REGION, kind: "game", difficulty: "easy" }, `s${i}`));
      hard.push(...planRounds({ region: WORLD_REGION, kind: "game", difficulty: "hard" }, `s${i}`));
    }
    expect(avg(easy)).toBeLessThan(avg(hard) - 0.5);
  });
  it("ramps the Daily from its first round to its last", () => {
    for (const day of [DAILY_RAMP_FROM, "2026-11-02", "2026-12-25"]) {
      const rounds = planRounds({ region: WORLD_REGION, kind: "game", daily: day }, `geo-daily:${day}`);
      expect(rounds).toHaveLength(5);
      const d = rounds.map((r) => heuristicDifficultyOf(r.shot));
      expect([...d].sort((a, b) => a - b)).toEqual(d);
    }
  });
  it("plans a Daily the same however often it's asked, even as players' scores move ratings", () => {
    for (const day of ["2026-10-20", DAILY_RAMP_FROM]) {
      const a = planRounds({ region: WORLD_REGION, kind: "game", daily: day }, `geo-daily:${day}`);
      setShotScores(a.map((r) => ({ id: r.shot, avg: 0, rounds: 1000 })));
      const b = planRounds({ region: WORLD_REGION, kind: "game", daily: day }, `geo-daily:${day}`);
      setShotScores([]);
      expect(b).toEqual(a);
    }
  });
  it("lets players' scores move a shot's rating", () => {
    const id = ids[0];
    setShotScores([{ id, avg: 0, rounds: 100 }]);
    expect(difficultyOf(id)).toBe(5);
    setShotScores([]);
    expect(difficultyOf(id)).toBe(heuristicDifficultyOf(id));
  });
});

describe("how you compared", () => {
  it("buckets a day's scores and says how many you beat", () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(25000)).toBe(9);
    const s = dailyStats("2026-10-28", [1000, 5000, 12000, 12000, 20000, 24000], 12000);
    expect(s.players).toBe(6);
    expect(s.buckets.reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.below).toBe(2);
    expect(percentBeaten(s)).toBe(50);
  });
  it("has nothing to say with too few players", () => {
    expect(percentBeaten(dailyStats("2026-10-28", Array(COMPARE_MIN_PLAYERS - 1).fill(1), 2))).toBeNull();
  });
});
