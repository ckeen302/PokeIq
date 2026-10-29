import { beforeEach, describe, expect, it } from "vitest";
import { createDuel, guessDuel, joinDuel, leaveDuel, readyDuel, roundAnswer, touchDuel, type Duel, type DuelOutcome } from "@/lib/server/duel";
import { clearMemoryRoundScores, geoStatsKey, memoryRoundScoreStore, type PlayerRoundRow } from "@/lib/server/geo-round-scores";
import { duelRoundRows, duelRunId, logFinishedDuel, parseDuelRun, stampStatsKey, versusStatsFrom, versusStatsOf } from "@/lib/server/geo-duel-stats";
import { DUEL_LEAD_MS } from "@/lib/duel-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;
const must = (out: DuelOutcome): Duel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};

const row = (over: Partial<PlayerRoundRow>): PlayerRoundRow => ({ region: null, family: null, kind: "game", score: 0, hit: null, run: null, ...over });

describe("versus stats from logged rounds", () => {
  it("shows nothing it can't back: no rounds, no numbers", () => {
    expect(versusStatsFrom([])).toEqual({ duels: 0, guessedFirst: null, strongest: [], toughest: [], recent: [] });
  });

  it("counts duels, guessed-first rounds and the latest five results, newest first", () => {
    const rows: PlayerRoundRow[] = [];
    // Newest first, as the store returns them: seven duels of two rounds each.
    const results = ["win", "loss", "win", "draw", "win", "loss", "loss"] as const;
    results.forEach((r, i) => {
      rows.push(row({ kind: "duel", run: duelRunId(`code${i}xx`, r), score: 4000, hit: i % 2 === 0 }));
      rows.push(row({ kind: "duel", run: duelRunId(`code${i}xx`, r), score: 3000, hit: false }));
    });
    // Rounds outside duels don't count as duels, and a malformed run is ignored.
    rows.push(row({ kind: "game", run: "solo-run", score: 5000 }));
    rows.push(row({ kind: "duel", run: "nonsense", score: 5000, hit: true }));
    const s = versusStatsFrom(rows);
    expect(s.duels).toBe(7);
    expect(s.recent).toEqual(["win", "loss", "win", "draw", "win"]);
    // 4 of 14 duel rounds locked in first.
    expect(s.guessedFirst).toBe(Math.round((4 / 14) * 100));
  });

  it("ranks regions by average round score, needing a few rounds each, never one region on both lists", () => {
    const rows: PlayerRoundRow[] = [];
    const add = (region: string, scores: number[]) => scores.forEach((score) => rows.push(row({ region, score })));
    add("Kanto", [5000, 4800, 4900]);
    add("Johto", [4000, 4100, 3900]);
    add("Hoenn", [3000, 3000, 3000]);
    add("Sinnoh", [2000, 2100, 1900]);
    add("Unova", [1000, 900, 1100]);
    add("Kalos", [100, 200, 0]);
    add("Alola", [5000, 5000]); // two rounds: not enough to call
    rows.push(row({ region: "Galar", kind: "region-streak", score: 5000, hit: true })); // a region pick isn't a pin score
    const s = versusStatsFrom(rows);
    expect(s.strongest).toEqual(["Kanto", "Johto", "Hoenn"]);
    expect(s.toughest).toEqual(["Kalos", "Unova", "Sinnoh"]);

    const few = versusStatsFrom(rows.filter((r) => r.region === "Kanto" || r.region === "Johto"));
    expect(few.strongest).toEqual(["Kanto", "Johto"]);
    expect(few.toughest).toEqual([]);
  });

  it("round-trips the run id", () => {
    expect(parseDuelRun(duelRunId("abcdefgh", "loss"))).toEqual({ code: "abcdefgh", result: "loss" });
    expect(parseDuelRun("abcdefgh")).toBeNull();
    expect(parseDuelRun(null)).toBeNull();
  });
});

describe("logging a finished duel", () => {
  beforeEach(() => clearMemoryRoundScores());

  function playedDuel() {
    const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, "stats-seed");
    const joined = joinDuel(duel, "Blue", T0 + SECOND);
    if (!joined.ok) throw new Error(joined.error);
    const blue = joined.playerId;
    const t = T0 + 2 * SECOND;
    let d = must(readyDuel(must(readyDuel(joined.duel, red, true, t)), blue, true, t));
    // Round 1: Red pins the place first, Blue a moment later far away.
    const start = t + DUEL_LEAD_MS;
    const [x, y] = roundAnswer(d, 0).pin;
    d = touchDuel(touchDuel(d, red, start + SECOND), blue, start + SECOND);
    d = must(guessDuel(d, red, 0, { x, y }, start + 2 * SECOND));
    d = must(guessDuel(d, blue, 0, { x: x > 0.5 ? 0 : 1, y: y > 0.5 ? 0 : 1 }, start + 3 * SECOND));
    expect(d.rounds[0].result).toBeTruthy();
    // Blue forfeits.
    d = must(leaveDuel(d, blue, d.rounds[0].result!.nextAt));
    expect(d.status).toBe("finished");
    return { duel: d, red, blue };
  }

  it("only stamps a seat for the signed-in trainer of that name", () => {
    const { duel, red } = playedDuel();
    expect(stampStatsKey(duel, red, null)).toBe(duel);
    expect(stampStatsKey(duel, red, { id: "u1", username: "Blue" })).toBe(duel);
    const stamped = stampStatsKey(duel, red, { id: "u1", username: "red" });
    expect(stamped.players[0].statsKey).toBe(geoStatsKey("u:u1"));
    expect(stamped.players[1].statsKey).toBeUndefined();
  });

  it("logs the stamped trainer's rounds once, and their stats follow", async () => {
    const store = memoryRoundScoreStore();
    const { duel, red } = playedDuel();
    const stamped = stampStatsKey(duel, red, { id: "u1", username: "Red" });
    const rows = duelRoundRows(stamped);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: "duel", kind: "duel", hit: true, region: "Kanto", run: duelRunId("abcdefgh", "win") });

    // Not finished yet, or already finished before this write: nothing.
    await logFinishedDuel(stamped, stamped, store);
    expect(await store.ofPlayer(geoStatsKey("u:u1"))).toHaveLength(0);
    await logFinishedDuel({ ...stamped, status: "playing" }, stamped, store);
    const stats = await versusStatsOf(geoStatsKey("u:u1"), store);
    expect(stats).toMatchObject({ duels: 1, guessedFirst: 100, recent: ["win"] });
    // The unstamped opponent has no record.
    expect(await versusStatsOf(geoStatsKey("u:someone"), store)).toMatchObject({ duels: 0, guessedFirst: null, recent: [] });
  });
});
