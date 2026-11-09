import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { CROWD_MIN_PINS, aggregateCrowd, crowdAllowed, crowdDayOver, firstPinPerPlayer } from "@/lib/geo-crowd";
import { signToken } from "@/lib/server/crypto";
import { geoDailyAnswers, mapPointOf } from "@/lib/server/geo";
import { clearMemoryRoundScores, logRoundScore, memoryRoundScoreStore } from "@/lib/server/geo-round-scores";
import { clearCrowdCache, crowdAccess, dailyCrowd, finishedDaily } from "@/lib/server/geo-crowd";
import type { GeoResult } from "@/lib/geo-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
const crowdRoute = await import("@/app/api/geo/crowd/route");

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

function resultToken(date: string | undefined, rounds = 5, kind: "game" | "streak" = "game") {
  const result: GeoResult = {
    sid: "s1",
    spec: { region: "world", kind, ...(date ? { daily: date } : {}) },
    score: 12000,
    rounds: Array.from({ length: rounds }, () => ({ score: 2400 })),
    durationMs: 1000,
    finishedAt: Date.now(),
  };
  return signToken("geo-result", result);
}

describe("crowd map aggregation", () => {
  it("counts pins into a coarse square grid, busiest cell first", () => {
    const pins: [number, number][] = [
      [0.11, 0.25],
      [0.12, 0.26],
      [0.13, 0.24],
      [0.9, 0.9],
    ];
    const r = aggregateCrowd(pins, { width: 2000, height: 1000 }, 1, { grid: 20 })!;
    expect(r.pins).toBe(4);
    expect(r.max).toBe(3);
    expect(r.cells).toHaveLength(2);
    expect(r.cells[0][2]).toBe(3);
    // Square cells: 100 map px each way.
    expect(r.cw).toBeCloseTo(0.05);
    expect(r.ch).toBeCloseTo(0.1);
    // A cell's centre, never the pin itself.
    expect(r.cells[0][0]).toBeCloseTo(0.125);
    expect(r.cells[0][1]).toBeCloseTo(0.25);
    for (const [x, y] of r.cells) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("drops pins off the map, and shows nothing below the minimum", () => {
    expect(aggregateCrowd([[0.5, 0.5], [0.5, 0.5]], { width: 10, height: 10 }, 1)).toBeNull();
    expect(aggregateCrowd([[0.5, 0.5], [0.5, 0.5], [1.5, 0.5], [Number.NaN, 0.2]], { width: 10, height: 10 }, 1)).toBeNull();
    const edge = aggregateCrowd([[1, 1], [1, 1], [0, 0]], { width: 10, height: 10 }, 2)!;
    expect(edge.round).toBe(2);
    expect(edge.pins).toBe(CROWD_MIN_PINS);
  });

  it("keeps each trainer's first pin only", () => {
    const rows = [
      { player: "a", n: 1 },
      { player: "b", n: 2 },
      { player: "a", n: 3 },
      { player: null, n: 4 },
      { player: null, n: 5 },
    ];
    expect(firstPinPerPlayer(rows).map((r) => r.n)).toEqual([1, 2, 4, 5]);
  });
});

describe("crowd map spoiler guard", () => {
  const now = at("2026-11-09T15:00:00Z");

  it("hides today's (and yesterday's, still played west of UTC) map from anyone who hasn't finished it", () => {
    expect(crowdAllowed("2026-11-09", null, now)).toBe(false);
    expect(crowdAllowed("2026-11-08", null, now)).toBe(false);
    expect(crowdAllowed("2026-11-09", "2026-11-08", now)).toBe(false);
    expect(crowdDayOver("2026-11-08", now)).toBe(false);
  });

  it("shows it to the trainer who finished that Daily, and to everyone once the day is over", () => {
    expect(crowdAllowed("2026-11-09", "2026-11-09", now)).toBe(true);
    expect(crowdAllowed("2026-11-07", null, now)).toBe(true);
    expect(crowdDayOver("2026-11-07", now)).toBe(true);
    expect(crowdDayOver("2026-11-08", at("2026-11-10T00:00:00Z"))).toBe(true);
  });

  it("never serves a day still to come, or a bad date", () => {
    expect(crowdAllowed("2026-11-11", "2026-11-11", now)).toBe(false);
    expect(crowdAllowed("2026-02-31", null, now)).toBe(false);
    expect(crowdAllowed("2001-01-01", null, now)).toBe(false);
  });

  it("only a signed, finished Daily result proves the trainer finished", () => {
    expect(finishedDaily(resultToken("2026-11-09"))).toBe("2026-11-09");
    expect(finishedDaily(resultToken("2026-11-09", 3))).toBeNull();
    expect(finishedDaily(resultToken(undefined))).toBeNull();
    expect(finishedDaily(resultToken("2026-11-09", 5, "streak"))).toBeNull();
    // Tamper mid-signature: the last base64url character can carry only padding bits, so changing it may decode to the same bytes.
    const real = resultToken("2026-11-08");
    const at = real.length - 8;
    const forged = real.slice(0, at) + (real[at] === "A" ? "B" : "A") + real.slice(at + 1);
    expect(finishedDaily(forged)).toBeNull();
    expect(crowdAccess("2026-11-09", resultToken("2026-11-09"), now)).toBe(true);
    expect(crowdAccess("2026-11-09", resultToken("2026-11-08"), now)).toBe(false);
  });
});

describe("a day's crowd map from the pin log", () => {
  const today = new Date().toISOString().slice(0, 10);
  beforeEach(() => {
    clearMemoryRoundScores();
    clearCrowdCache();
  });

  it("puts each round's pins on the Daily's map, one per trainer, and leaves out thin rounds", async () => {
    const daily = geoDailyAnswers(today)!;
    expect(daily.rounds.length).toBe(5);
    const store = memoryRoundScoreStore();
    const [r1, r2] = daily.rounds;
    // Round 1: four trainers (one pins twice, from a replay), plus a free-play round on the same shot.
    for (const [player, pin] of [
      ["p1", [0.3, 0.4]],
      ["p2", [0.31, 0.4]],
      ["p3", [0.6, 0.5]],
      ["p4", [0.3, 0.41]],
      ["p1", [0.9, 0.9]],
    ] as const) {
      await logRoundScore({ shot: r1.shot, score: 100, mode: "daily", player, pin: [...pin] }, store);
    }
    await logRoundScore({ shot: r1.shot, score: 100, mode: "solo", player: "p9", pin: [0.1, 0.1] }, store);
    // Round 2: too few to show.
    await logRoundScore({ shot: r2.shot, score: 100, mode: "daily", player: "p1", pin: [0.5, 0.5] }, store);

    const crowd = await dailyCrowd(today, store);
    expect(crowd.rounds.map((r) => r.round)).toEqual([1]);
    const round = crowd.rounds[0];
    expect(round.pins).toBe(4);
    expect(round.cells.reduce((s, c) => s + c[2], 0)).toBe(4);
    // Nothing per trainer goes out: only cells and counts.
    expect(JSON.stringify(crowd)).not.toMatch(/p1|p2|player/);
    // The world pins land where the map reads them.
    expect(mapPointOf(daily.region, 0.3, 0.4)).not.toBeNull();
  });

  it("the API refuses today's map without a finished Daily, and serves it with one", async () => {
    const get = (q: string) => crowdRoute.GET(new NextRequest(`http://localhost:3000/api/geo/crowd?${q}`, { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` } }));
    expect((await get(`date=${today}`)).status).toBe(403);
    expect((await get(`date=${today}&t=${encodeURIComponent(resultToken(new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10)))}`)).status).toBe(403);
    const ok = await get(`date=${today}&t=${encodeURIComponent(resultToken(today))}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toMatch(/private/);
    expect(await ok.json()).toEqual({ date: today, rounds: [] });
    expect((await get("date=nope")).status).toBe(400);
  });
});
