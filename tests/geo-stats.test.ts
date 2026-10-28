import { beforeEach, describe, expect, it } from "vitest";
import { aggregateGeoStats, clearMemoryRoundScores, geoStatsKey, logRoundScore, memoryRoundScoreStore, playerGeoStats, type PlayerRoundRow } from "@/lib/server/geo-round-scores";
import { bestAndWorst } from "@/lib/geo-results";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const row = (r: Partial<PlayerRoundRow>): PlayerRoundRow => ({ region: null, family: null, kind: "game", score: 0, hit: null, run: null, ...r });

describe("PokéGuessr profile stats", () => {
  it("aggregates accuracy, best round and games by region and by game", () => {
    const stats = aggregateGeoStats([
      row({ region: "Kanto", family: "rby", score: 5000, run: "g1" }),
      row({ region: "Kanto", family: "frlg", score: 2500, run: "g1" }),
      row({ region: "Johto", family: "gsc", score: 1000, run: "g1", kind: "daily" }),
      row({ region: "Johto", family: "gsc", score: 0, run: "g2" }),
      row({ region: "Kanto", family: "rby", kind: "region-streak", score: 5000, hit: true, run: "s1" }),
      row({ region: "Hoenn", family: "rse", kind: "region-streak", score: 0, hit: false, run: "s1" }),
    ]);
    expect(stats.rounds).toBe(4);
    expect(stats.games).toBe(2);
    expect(stats.streakPicks).toBe(2);
    expect(stats.streakHits).toBe(1);
    expect(stats.byRegion.map((r) => r.key)).toEqual(["Kanto", "Johto", "Hoenn"]);
    const kanto = stats.byRegion[0];
    expect(kanto.rounds).toBe(2);
    expect(kanto.accuracy).toBe(75);
    expect(kanto.best).toBe(5000);
    expect(kanto.streakPicks).toBe(1);
    expect(kanto.streakHits).toBe(1);
    const johto = stats.byRegion[1];
    expect(johto.accuracy).toBe(10);
    expect(johto.best).toBe(1000);
    const hoenn = stats.byRegion[2];
    expect(hoenn.rounds).toBe(0);
    expect(hoenn.streakPicks).toBe(1);
    // Games are named, most played first.
    expect(stats.byGame[0].key).toBe("Red / Blue / Yellow");
    expect(stats.byGame.find((g) => g.key === "Gold / Silver / Crystal")?.accuracy).toBe(10);
  });

  it("ignores rows without a region or an unknown family, and handles nothing played", () => {
    expect(aggregateGeoStats([])).toEqual({ rounds: 0, games: 0, streakPicks: 0, streakHits: 0, byRegion: [], byGame: [] });
    const stats = aggregateGeoStats([row({ family: "not-a-game", score: 3000, run: "g" })]);
    expect(stats.rounds).toBe(1);
    expect(stats.byRegion).toEqual([]);
    expect(stats.byGame).toEqual([]);
  });
});

describe("logging rounds per trainer", () => {
  beforeEach(() => clearMemoryRoundScores());

  it("reads back only the trainer's own rounds, newest first, and keeps region streak picks out of shot ratings", async () => {
    const store = memoryRoundScoreStore();
    const me = geoStatsKey("u:1");
    await logRoundScore({ shot: "s1", score: 4000, mode: "solo", kind: "game", region: "Kanto", family: "rby", run: "a", player: me }, store);
    await logRoundScore({ shot: "s1", score: 1000, mode: "solo", kind: "game", region: "Kanto", family: "rby", run: "b", player: geoStatsKey("u:2") }, store);
    await logRoundScore({ shot: "s1", score: 5000, mode: "region-streak", kind: "region-streak", region: "Kanto", family: "rby", run: "c", hit: true, player: me }, store);
    await logRoundScore({ shot: "s2", score: 2000, mode: "daily", kind: "daily", region: "Johto", family: "gsc", run: "d" }, store);
    const mine = await store.ofPlayer(me);
    expect(mine.map((r) => r.run)).toEqual(["c", "a"]);
    const stats = await playerGeoStats(me, store);
    expect(stats?.games).toBe(1);
    expect(stats?.streakHits).toBe(1);
    // The shot's rating takes the two pin rounds only.
    expect(await store.stats()).toEqual(expect.arrayContaining([{ id: "s1", avg: 2500, rounds: 2 }]));
    expect(geoStatsKey("u:1")).not.toBe("u:1");
    expect(geoStatsKey("u:1")).toBe(me);
  });
});

describe("the results map's best and worst rounds", () => {
  it("lights the highest and lowest scores, and none when they tie", () => {
    expect(bestAndWorst([1000, 5000, 200, 3000, 4000])).toEqual({ best: 1, worst: 2 });
    expect(bestAndWorst([5000, 5000, 5000])).toEqual({ best: null, worst: null });
    expect(bestAndWorst([4200])).toEqual({ best: null, worst: null });
    expect(bestAndWorst([])).toEqual({ best: null, worst: null });
  });
});
