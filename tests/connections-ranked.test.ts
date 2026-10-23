import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONN_RANKED_QUEUE_KEY, connSeasonEnd, connSeasonLabel, connSeasonOf } from "@/lib/connections/ranked";
import { clearMemoryRanked, memoryRankedStore, rankedKey } from "@/lib/server/ranked";
import { connRankedKey, connRankedMatchOf, connRankedStore, settleConnRanked } from "@/lib/server/connections-ranked";
import { settleRankedDuel } from "@/lib/server/ranked-duels";
import { matchSettingsSchema, newTicket, queueKey, searchMatch, searchRankedConnections, type SearchResult } from "@/lib/server/matchmaking";
import { pvpStore, queueStore, rankedQueueStore } from "@/lib/server/duel-store";
import { duelView, leaveDuel, rematchOf, type PvpDuel } from "@/lib/server/duels";
import { readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import type { ConnectionsDuel } from "@/lib/server/connections-duel";
import type { ConnDuelView } from "@/lib/pvp-types";
import { tierOf } from "@/lib/ranked";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = Date.UTC(2026, 9, 15, 12);
const SECOND = 1000;
const at = (t: number) => vi.setSystemTime(t);

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
  await rankedQueueStore.remove(CONN_RANKED_QUEUE_KEY);
  await queueStore.remove("connections");
});
afterEach(() => vi.useRealTimers());

const rating = async () => ({ rating: 1000, games: 0 });

async function rankedDuel(): Promise<{ duel: ConnectionsDuel; ids: [string, string]; tokens: [string, string] }> {
  const red = newTicket();
  waiting(await searchRankedConnections("Red", red, connRankedKey("a:red"), rating));
  const blue = matched(await searchRankedConnections("Blue", newTicket(), connRankedKey("a:blue"), rating));
  const redSeat = matched(await searchRankedConnections("Red", red, connRankedKey("a:red"), rating));
  const duel = (await pvpStore.load(blue.code))!.duel as ConnectionsDuel;
  return { duel, ids: [readPvpToken(redSeat.token, blue.code)!, readPvpToken(blue.token, blue.code)!], tokens: [redSeat.token, blue.token] };
}

describe("seasons", () => {
  it("run by calendar month, UTC", () => {
    expect(connSeasonOf(Date.UTC(2026, 9, 31, 23, 59))).toBe("2026-10");
    expect(connSeasonOf(Date.UTC(2026, 10, 1))).toBe("2026-11");
    expect(connSeasonEnd("2026-12")).toBe(Date.UTC(2027, 0, 1));
    expect(connSeasonLabel("2026-10")).toBe("October 2026");
  });

  it("keep a separate ladder per season, and apart from Pokédle's", async () => {
    const oct = connRankedStore("2026-10")!;
    const nov = connRankedStore("2026-11")!;
    await oct.apply({ code: "abcd1234", keys: ["k1_aaaaaaaaaaaaaaa", "k2_aaaaaaaaaaaaaaa"], names: ["A", "B"], expect: [{ rating: 1000, games: 0 }, { rating: 1000, games: 0 }], after: [1012, 988], scores: [1, 0] });
    expect(await oct.rating("k1_aaaaaaaaaaaaaaa")).toEqual({ rating: 1012, games: 1 });
    expect(await nov.rating("k1_aaaaaaaaaaaaaaa")).toBeNull();
    expect(await memoryRankedStore().rating("k1_aaaaaaaaaaaaaaa")).toBeNull();
    expect(connRankedKey("a:red")).not.toBe(rankedKey("a:red"));
  });
});

describe("ranked races", () => {
  it("queue apart from casual races and open a ranked duel with both ratings, keys server-side", async () => {
    expect(queueKey(matchSettingsSchema.parse({ game: "connections", ranked: true }))).toBe(CONN_RANKED_QUEUE_KEY);
    expect(queueKey({ game: "connections" })).toBe("connections");
    waiting(await searchRankedConnections("Red", newTicket(), connRankedKey("a:red"), rating));
    waiting(await searchMatch({ game: "connections" }, "Blue", newTicket()));

    await rankedQueueStore.remove(CONN_RANKED_QUEUE_KEY);
    await queueStore.remove("connections");
    const { duel, tokens } = await rankedDuel();
    expect(duel).toMatchObject({ kind: "connections", queue: "ranked", status: "playing", ranked: { season: "2026-10", ratings: [1000, 1000], games: [0, 0] } });
    const view = duelView(duel, readPvpToken(tokens[1], duel.code), T0 + 3 * SECOND, 1) as ConnDuelView;
    expect(view.ranked).toEqual({ season: "2026-10", ratings: [1000, 1000], provisional: [true, true], result: undefined });
    expect(JSON.stringify(view)).not.toContain(connRankedKey("a:red"));
    const rematch = rematchOf(duel, "zzzz9999", T0) as ConnectionsDuel;
    expect(rematch.ranked).toBeUndefined();
    expect(rematch.queue).toBeUndefined();
  });

  it("doesn't count a race still being played", async () => {
    const { duel } = await rankedDuel();
    expect(connRankedMatchOf(duel)).toBeNull();
    const out = await settleRankedDuel(duel as PvpDuel, 0);
    expect((out.duel as ConnectionsDuel).ranked!.result).toBeUndefined();
  });

  it("moves both ratings once when a race ends, and records the change on the duel", async () => {
    const { duel, ids } = await rankedDuel();
    const left = leaveDuel(duel, ids[0], T0 + 5 * SECOND);
    if (!left.ok) throw new Error(left.error);
    expect(left.duel.end).toMatchObject({ reason: "left", winner: 1 });
    const stored = await pvpStore.load(duel.code);
    expect(await pvpStore.save(left.duel, stored!.version)).toBe(true);

    const settled = await settleRankedDuel(left.duel as PvpDuel, stored!.version + 1);
    const result = (settled.duel as ConnectionsDuel).ranked!.result!;
    // Provisional games move fast: 48 / 2 on an even match.
    expect(result.before).toEqual([1000, 1000]);
    expect(result.after).toEqual([976, 1024]);
    const again = await settleRankedDuel(settled.duel, settled.rev);
    expect(again.rev).toBe(settled.rev);
    const store = connRankedStore("2026-10")!;
    expect(await store.rating(connRankedKey("a:blue"))).toEqual({ rating: 1024, games: 1 });
    expect(await store.rating(connRankedKey("a:red"))).toEqual({ rating: 976, games: 1 });
    const standing = await store.standing(connRankedKey("a:blue"));
    expect(standing).toMatchObject({ wins: 1, losses: 0, streak: 1, position: 1, players: 2 });
    const top = await store.top(10);
    expect(top.map((r) => r.name)).toEqual(["Blue", "Red"]);
    const view = duelView(settled.duel, ids[1], T0, settled.rev) as ConnDuelView;
    expect(view.ranked?.result).toEqual(result);
    // Counting the same duel again from the stored result changes nothing.
    expect(await settleConnRanked(settled.duel as ConnectionsDuel)).toBeNull();
  });

  it("counts the race in the season it was opened, even if it ends later", async () => {
    const { duel, ids } = await rankedDuel();
    at(Date.UTC(2026, 10, 1, 0, 5));
    const left = leaveDuel(duel, ids[1], Date.now());
    if (!left.ok) throw new Error(left.error);
    const result = await settleConnRanked(left.duel as ConnectionsDuel);
    expect(result).not.toBeNull();
    expect(await connRankedStore("2026-10")!.rating(connRankedKey("a:red"))).not.toBeNull();
    expect(await connRankedStore("2026-11")!.rating(connRankedKey("a:red"))).toBeNull();
  });

  it("uses Pokédle's tiers", () => {
    expect(tierOf(1000).name).toBe("Poké Ball");
    expect(tierOf(1850).name).toBe("Master Ball");
  });
});
