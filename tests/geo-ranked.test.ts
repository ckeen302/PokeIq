import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEO_RANKED_REGION, geoSeasonDaysLeft, geoSeasonEnd, geoSeasonName, geoSeasonOf, isGeoSeason, previousGeoSeason } from "@/lib/geo-ranked";
import { clearMemoryRanked, memoryRankedStore, rankedKey, settleRanked, POKEDLE_LADDER } from "@/lib/server/ranked";
import { geoLadder, geoRankedKey, geoRankedStore, settleGeoRankedDuel } from "@/lib/server/geo-ranked";
import { GEO_RANKED_QUEUE_KEY, matchSettingsSchema, newTicket, queueKey, searchMatch, searchRankedMatch, type SearchResult } from "@/lib/server/matchmaking";
import { loadDuel, rankedQueueStore, saveDuel, queueStore } from "@/lib/server/duel-store";
import { createDuel, duelView, leaveDuel, rankedMatchOf, readDuelToken, rematchOf, withRankedResult, type Duel } from "@/lib/server/duel";
import type { PvpFailure } from "@/lib/server/duel-core";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = Date.UTC(2026, 9, 22, 12); // 22 October 2026
const SECOND = 1000;
const at = (t: number) => vi.setSystemTime(t);
const SEASON = "2026-10";

type Matched = Extract<SearchResult, { status: "matched" }>;
function matched(out: SearchResult | PvpFailure): Matched {
  if (!out.ok || out.status !== "matched") throw new Error(`expected a match, got ${JSON.stringify(out)}`);
  return out;
}
function waiting(out: SearchResult | PvpFailure) {
  if (!out.ok || out.status !== "waiting") throw new Error(`expected to wait, got ${JSON.stringify(out)}`);
  return out;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(T0);
  clearMemoryRanked();
  await rankedQueueStore.remove(GEO_RANKED_QUEUE_KEY);
  await queueStore.remove("geo:world");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("seasons", () => {
  it("are calendar months in UTC", () => {
    expect(geoSeasonOf(T0)).toBe(SEASON);
    expect(geoSeasonOf(Date.UTC(2026, 9, 31, 23, 59))).toBe(SEASON);
    expect(geoSeasonOf(Date.UTC(2026, 10, 1))).toBe("2026-11");
    expect(geoSeasonOf(Date.UTC(2027, 0, 1))).toBe("2027-01");
    expect(geoSeasonName(SEASON)).toBe("October 2026");
    expect(geoSeasonEnd(SEASON)).toBe(Date.UTC(2026, 10, 1));
    expect(geoSeasonEnd("2026-12")).toBe(Date.UTC(2027, 0, 1));
    expect(previousGeoSeason(SEASON)).toBe("2026-09");
    expect(previousGeoSeason("2026-01")).toBe("2025-12");
    expect(geoSeasonDaysLeft(SEASON, T0)).toBe(10);
    expect(geoSeasonDaysLeft(SEASON, Date.UTC(2026, 10, 2))).toBe(0);
    for (const s of ["2026-10", "1999-01"]) expect(isGeoSeason(s)).toBe(true);
    for (const s of ["2026-13", "2026-1", "26-10", 202610, null]) expect(isGeoSeason(s)).toBe(false);
  });

  it("each have their own ladder, apart from ranked Pokédle's", async () => {
    const match = { code: "abcd2345", keys: [geoRankedKey("a:red"), geoRankedKey("a:blue")] as [string, string], names: ["Red", "Blue"] as [string, string], reason: "played" as const, winner: 0 };
    await settleRanked(match, geoRankedStore(SEASON)!);
    expect((await geoRankedStore(SEASON)!.rating(geoRankedKey("a:red")))!.rating).toBeGreaterThan(1000);
    // Next month everyone starts again; Pokédle's ladder never saw it.
    expect(await geoRankedStore("2026-11")!.rating(geoRankedKey("a:red"))).toBeNull();
    expect(await memoryRankedStore(POKEDLE_LADDER).rating(rankedKey("a:red"))).toBeNull();
    expect(geoRankedKey("a:red")).not.toBe(rankedKey("a:red"));
    expect(geoLadder(SEASON)).toMatchObject({ id: "geo:2026-10", args: { p_season: SEASON }, migration: "0029_geo_ranked.sql" });
    expect((await geoRankedStore(SEASON)!.top(10)).map((r) => r.name)).toEqual(["Red", "Blue"]);
  });
});

describe("the ranked queue", () => {
  it("is one queue: the world map, every game", () => {
    expect(matchSettingsSchema.safeParse({ game: "geo", region: "world", ranked: true }).success).toBe(true);
    expect(matchSettingsSchema.safeParse({ game: "geo", region: "kanto", ranked: true }).success).toBe(false);
    expect(matchSettingsSchema.safeParse({ game: "geo", region: "world", era: "2d", ranked: true }).success).toBe(false);
    expect(queueKey({ game: "geo", region: "world", ranked: true })).toBe(GEO_RANKED_QUEUE_KEY);
    expect(queueKey({ game: "geo", region: "world" })).toBe("geo:world");
  });

  async function rankedDuel(start = T0): Promise<{ duel: Duel; ids: [string, string]; tokens: [string, string] }> {
    at(start);
    const rating = async () => ({ rating: 1000, games: 0 });
    const red = newTicket();
    waiting(await searchRankedMatch("Red", red, geoRankedKey("a:red"), rating, SEASON));
    at(start + 2 * SECOND);
    const blue = matched(await searchRankedMatch("Blue", newTicket(), geoRankedKey("a:blue"), rating, SEASON));
    const redSeat = matched(await searchRankedMatch("Red", red, geoRankedKey("a:red"), rating, SEASON));
    expect(redSeat.code).toBe(blue.code);
    expect(blue.href).toBe(`/guessr/duel/${blue.code}`);
    const duel = (await loadDuel(blue.code))!.duel;
    return { duel, ids: [readDuelToken(redSeat.token, blue.code)!, readDuelToken(blue.token, blue.code)!], tokens: [redSeat.token, blue.token] };
  }

  it("opens a ranked duel on the world map with both ratings, the keys kept server-side", async () => {
    const { duel, ids } = await rankedDuel();
    expect(duel).toMatchObject({ region: GEO_RANKED_REGION, status: "playing", ranked: { season: SEASON, ratings: [1000, 1000], games: [0, 0] } });
    expect(duel.era).toBeUndefined();
    const view = duelView(duel, ids[1], T0 + 3 * SECOND, 1);
    expect(view.ranked).toEqual({ season: SEASON, ratings: [1000, 1000], provisional: [true, true] });
    expect(JSON.stringify(view)).not.toContain(geoRankedKey("a:red"));
    // A rematch is casual.
    expect(rematchOf(duel, "zzzz9999", T0).ranked).toBeUndefined();
  });

  it("keeps ranked and casual searchers apart", async () => {
    waiting(await searchRankedMatch("Red", newTicket(), geoRankedKey("a:red"), async () => ({ rating: 1000, games: 0 }), SEASON));
    waiting(await searchMatch({ game: "geo", region: "world" }, "Blue", newTicket()));
  });

  it("doesn't count a duel still being played", async () => {
    const { duel } = await rankedDuel();
    expect(rankedMatchOf(duel)).toBeNull();
    expect((await settleGeoRankedDuel(duel, 0)).duel.ranked!.result).toBeUndefined();
  });

  it("counts leaving as a loss, once, in the duel's season", async () => {
    // Matched a minute before October ends.
    const LATE = Date.UTC(2026, 9, 31, 23, 59);
    const { duel, ids } = await rankedDuel(LATE);
    at(LATE + 5 * SECOND);
    const left = leaveDuel(duel, ids[0], LATE + 5 * SECOND);
    if (!left.ok) throw new Error(left.error);
    expect(left.duel.end).toMatchObject({ reason: "left", winner: 1 });
    expect(rankedMatchOf(left.duel)).toMatchObject({ season: SEASON, reason: "left", winner: 1, names: ["Red", "Blue"] });
    const stored = await loadDuel(duel.code);
    expect(await saveDuel(left.duel, stored!.version)).toBe(true);

    // Counted after the month has turned: still October's.
    at(Date.UTC(2026, 10, 1, 0, 0, 5));
    expect(geoSeasonOf(Date.now())).toBe("2026-11");
    const settled = await settleGeoRankedDuel(left.duel, stored!.version + 1);
    const result = settled.duel.ranked!.result!;
    expect(result.after[0]).toBeLessThan(1000);
    expect(result.after[1]).toBeGreaterThan(1000);
    expect(await geoRankedStore(SEASON)!.rating(geoRankedKey("a:blue"))).toEqual({ rating: result.after[1], games: 1 });
    expect(await geoRankedStore("2026-11")!.rating(geoRankedKey("a:blue"))).toBeNull();
    // Another poll changes nothing.
    const again = await settleGeoRankedDuel(settled.duel, settled.rev);
    expect(again.rev).toBe(settled.rev);
    expect(duelView(settled.duel, ids[1], T0, settled.rev).ranked?.result).toEqual(result);
    expect(withRankedResult(settled.duel, { before: [1, 1], after: [2, 2] }).ranked!.result).toEqual(result);
  });

  it("reads a duel played out to the end as played (a draw is half each)", () => {
    const { duel } = createDuel(GEO_RANKED_REGION, "Red", "abcd2345", T0, undefined, undefined, {
      season: SEASON,
      keys: ["k".repeat(16), "q".repeat(16)],
      ratings: [1000, 1000],
      games: [0, 0],
    });
    const done: Duel = { ...duel, status: "finished", players: [...duel.players, { id: "b", name: "Blue", ready: true, seenAt: T0 }], end: { reason: "rounds", winner: null, at: T0 } };
    expect(rankedMatchOf(done)).toMatchObject({ reason: "played", winner: null });
    expect(rankedMatchOf({ ...done, end: { reason: "hp", winner: 0, at: T0 } })).toMatchObject({ reason: "played", winner: 0 });
    expect(rankedMatchOf({ ...done, end: { reason: "idle", winner: null, at: T0 } })).toMatchObject({ reason: "idle" });
  });
});
