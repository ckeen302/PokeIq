import { beforeEach, describe, expect, it } from "vitest";
import { answerFor, planRounds, regionGroupOf } from "@/lib/server/geo";
import {
  bestStreakOf,
  clearMemoryStreaks,
  gradeStreak,
  memoryStreakStore,
  readStreak,
  readStreakResult,
  recordStreakRun,
  startStreak,
  streakRegionOf,
} from "@/lib/server/geo-streak";
import { readGeoShare } from "@/lib/server/geo-share";
import { GEO_REGION_STREAK_BOARD, GEO_STREAK_REGIONS, type GeoStreakRegion } from "@/lib/geo-streak-types";
import { WORLD_REGION, type GeoSpec } from "@/lib/geo-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const SPEC: GeoSpec = { region: WORLD_REGION, kind: "streak" };

/** The region of the run's current round, worked out the way the server does (the browser never gets it). */
function regionOfRound(token: string, index: number): GeoStreakRegion {
  const state = readStreak(token)!;
  const round = planRounds(SPEC, state.seed).filter((r) => streakRegionOf(answerFor(SPEC, r)))[index];
  const region = streakRegionOf(answerFor(SPEC, round));
  if (!region) throw new Error("round outside the nine regions");
  return region;
}
const wrong = (right: GeoStreakRegion): GeoStreakRegion => GEO_STREAK_REGIONS.find((r) => r !== right)!;

describe("Region Streak", () => {
  it("starts with a screenshot and the nine regions, and nothing that gives the place away", () => {
    const start = startStreak({ name: "Red" });
    expect(start.shot).toMatch(/^\/api\/geo\/shot\/[A-Za-z0-9_-]+$/);
    expect(start.regions).toEqual([...GEO_STREAK_REGIONS]);
    const state = readStreak(start.token)!;
    expect(state.streak).toBe(0);
    // The current round is sealed: the token's readable part carries no place or region name.
    const readable = Buffer.from(start.token.split(".")[0], "base64url").toString("utf8");
    const answer = answerFor(SPEC, planRounds(SPEC, state.seed).filter((r) => streakRegionOf(answerFor(SPEC, r)))[0]);
    expect(readable).not.toContain(answer.name);
    expect(JSON.stringify(start)).not.toContain(answer.name);
    for (const r of GEO_STREAK_REGIONS) expect(readable).not.toContain(`"${r}"`);
  });

  it("keeps the run alive on the right region and deals the next shot; a wrong pick ends it", () => {
    const start = startStreak();
    const right = regionOfRound(start.token, 0);
    const one = gradeStreak(readStreak(start.token)!, { region: right });
    if (!one.ok) throw new Error(one.error);
    expect(one.body.correct).toBe(true);
    expect(one.body.streak).toBe(1);
    expect(one.body.region).toBe(right);
    expect(one.body.done).toBe(false);
    expect(one.body.next?.shot).toMatch(/^\/api\/geo\/shot\//);
    expect(one.body.next?.shot).not.toBe(start.shot);
    expect(one.body.resultToken).toBeUndefined();
    // The answer arrives only now, with the grade.
    expect(one.body.answer.name).toBeTruthy();
    expect(regionGroupOf(one.body.answer.region)).toBe(right);

    const second = regionOfRound(one.body.token, 1);
    const two = gradeStreak(readStreak(one.body.token)!, { region: wrong(second) });
    if (!two.ok) throw new Error(two.error);
    expect(two.body.correct).toBe(false);
    expect(two.body.picked).toBe(wrong(second));
    expect(two.body.region).toBe(second);
    expect(two.body.streak).toBe(1);
    expect(two.body.done).toBe(true);
    expect(two.body.next).toBeUndefined();
    const result = readStreakResult(two.body.resultToken);
    expect(result?.streak).toBe(1);
    expect(result?.durationMs).toBeGreaterThan(0);

    // Over is over: no more picks.
    const again = gradeStreak(readStreak(two.body.token)!, { region: second });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(409);
  });

  it("grades each round once (claim keys differ per round) and a timeout counts as a miss", () => {
    const start = startStreak();
    const state = readStreak(start.token)!;
    const a = gradeStreak(state, { region: regionOfRound(start.token, 0) });
    if (!a.ok) throw new Error(a.error);
    const b = gradeStreak(readStreak(a.body.token)!, { timeout: true });
    if (!b.ok) throw new Error(b.error);
    expect(a.claimKey).not.toBe(b.claimKey);
    expect(b.body.correct).toBe(false);
    expect(b.body.timedOut).toBe(true);
    expect(b.body.done).toBe(true);
  });

  it("rejects a forged or expired token and a tampered result", () => {
    expect(readStreak("nope")).toBeNull();
    const start = startStreak();
    const [body, sig] = start.token.split(".");
    expect(readStreak(`${body}x.${sig}`)).toBeNull();
    expect(readStreakResult(start.token)).toBeNull();
  });

  it("maps DLC areas and the Sevii Islands to their region", () => {
    expect(streakRegionOf({ region: "Isle of Armor" })).toBe("Galar");
    expect(streakRegionOf({ region: "Sevii Islands" })).toBe("Kanto");
    expect(streakRegionOf({ region: "Blueberry Academy" })).toBe("Unova");
    expect(streakRegionOf({ region: "Kitakami" })).toBe("Paldea");
    expect(streakRegionOf({ region: "Nowhere" })).toBeNull();
  });

  it("shares a finished run as a result page view", async () => {
    const start = startStreak();
    const miss = gradeStreak(readStreak(start.token)!, { region: wrong(regionOfRound(start.token, 0)) });
    if (!miss.ok) throw new Error(miss.error);
    const view = await readGeoShare(miss.body.resultToken!);
    expect(view?.kind).toBe("region-streak");
    expect(view?.headline).toBe("0 in a row");
    expect(view?.playHref).toBe("/guessr/streak");
    expect(await readGeoShare("duel:nope")).toBeNull();
    expect(await readGeoShare("garbage")).toBeNull();
  });
});

describe("best region streak per trainer", () => {
  beforeEach(() => clearMemoryStreaks());

  it("keeps the best and counts runs", async () => {
    const store = memoryStreakStore();
    expect(await bestStreakOf("k", store)).toBeNull();
    expect(await recordStreakRun("k", 3, store)).toEqual({ best: 3, runs: 1 });
    expect(await recordStreakRun("k", 1, store)).toEqual({ best: 3, runs: 2 });
    expect(await recordStreakRun("k", 7, store)).toEqual({ best: 7, runs: 3 });
    expect(await bestStreakOf("k", store)).toEqual({ best: 7, runs: 3 });
    expect(await bestStreakOf("other", store)).toBeNull();
  });

  it("has a leaderboard board of its own", () => {
    expect(GEO_REGION_STREAK_BOARD).toBe("world:region-streak");
    expect(GEO_REGION_STREAK_BOARD.length).toBeLessThanOrEqual(40);
  });
});
