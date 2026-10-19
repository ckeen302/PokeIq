import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MATCH_FRESH_MS,
  cancelMatch,
  matchSettingsSchema,
  newTicket,
  planSearch,
  queueKey,
  searchMatch,
  seatNames,
  type MatchSettings,
  type SearchResult,
} from "@/lib/server/matchmaking";
import { loadDuel, pvpStore, queueStore } from "@/lib/server/duel-store";
import { readDuelToken } from "@/lib/server/duel";
import { readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import { DUEL_LEAD_MS } from "@/lib/duel-types";
import { PVP_LEAD_MS } from "@/lib/pvp-types";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;
const KANTO: MatchSettings = { game: "geo", region: "kanto" };
const POKEDLE: MatchSettings = { game: "pokedle" };

type Waiting = Extract<SearchResult, { status: "waiting" }>;
type Matched = Extract<SearchResult, { status: "matched" }>;

function waiting(out: SearchResult | PvpFailure): Waiting {
  if (!out.ok || out.status !== "waiting") throw new Error(`expected to wait, got ${JSON.stringify(out)}`);
  return out;
}
function matched(out: SearchResult | PvpFailure): Matched {
  if (!out.ok || out.status !== "matched") throw new Error(`expected a match, got ${JSON.stringify(out)}`);
  return out;
}

const at = (t: number) => vi.setSystemTime(t);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(T0);
  for (const s of [KANTO, POKEDLE, { game: "geo", region: "johto" } as const]) await queueStore.remove(queueKey(s));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("matchmaking", () => {
  it("pairs two searchers into a duel that starts on its own", async () => {
    const red = newTicket();
    const first = waiting(await searchMatch(POKEDLE, "Red", red));
    expect(first).toMatchObject({ ticket: red, since: T0 });

    at(T0 + 3 * SECOND);
    const blue = matched(await searchMatch(POKEDLE, "Blue", newTicket()));
    expect(blue.href).toBe(`/pokedle/duel/${blue.code}`);
    // Red learns of it on their next poll: the same duel, the other seat.
    at(T0 + 4 * SECOND);
    const redSeat = matched(await searchMatch(POKEDLE, "Red", red));
    expect(redSeat.code).toBe(blue.code);

    const { duel } = (await pvpStore.load(blue.code))!;
    expect(duel.players.map((p) => [p.name, p.ready])).toEqual([
      ["Red", true],
      ["Blue", true],
    ]);
    expect(readPvpToken(redSeat.token, blue.code)).toBe(duel.players[0].id);
    expect(readPvpToken(blue.token, blue.code)).toBe(duel.players[1].id);
    expect(duel.status).toBe("playing");
    expect(duel.kind === "pokedle" && duel.rounds[0].startsAt).toBe(T0 + 3 * SECOND + PVP_LEAD_MS);
    // Red's next poll still finds the seat (a lost response is fine); the queue is empty again.
    expect(matched(await searchMatch(POKEDLE, "Red", red)).code).toBe(blue.code);
    expect((await queueStore.load(queueKey(POKEDLE)))!.duel.waiting).toBeUndefined();
  });

  it("pairs PokéGuessr searchers on the same map", async () => {
    const red = newTicket();
    waiting(await searchMatch(KANTO, "Red", red));
    const blue = matched(await searchMatch(KANTO, "Blue", newTicket()));
    expect(blue.href).toBe(`/guessr/duel/${blue.code}`);
    const { duel } = (await loadDuel(blue.code))!;
    expect(duel).toMatchObject({ region: "kanto", status: "playing" });
    expect(duel.rounds[0].startsAt).toBe(T0 + DUEL_LEAD_MS);
    expect(readDuelToken(blue.token, blue.code)).toBe(duel.players[1].id);
    expect(readDuelToken(matched(await searchMatch(KANTO, "Red", red)).token, blue.code)).toBe(duel.players[0].id);
  });

  it("makes one pair of three searchers, and the third waits", async () => {
    const [a, b, c] = [newTicket(), newTicket(), newTicket()];
    waiting(await searchMatch(KANTO, "Ash", a));
    const pair = matched(await searchMatch(KANTO, "Brock", b));
    waiting(await searchMatch(KANTO, "Cynthia", c));
    expect(matched(await searchMatch(KANTO, "Ash", a)).code).toBe(pair.code);
    expect(waiting(await searchMatch(KANTO, "Cynthia", c)).ticket).toBe(c);
  });

  it("passes over a waiting searcher who stopped polling", async () => {
    const [a, b] = [newTicket(), newTicket()];
    waiting(await searchMatch(KANTO, "Ash", a));
    // Ash's tab closed: nothing for longer than a ticket stays fresh.
    at(T0 + MATCH_FRESH_MS + SECOND);
    waiting(await searchMatch(KANTO, "Brock", b));
    expect((await queueStore.load(queueKey(KANTO)))!.duel.waiting?.ticket).toBe(b);
    // Polling keeps a search alive: Brock, still polling, is paired with the next searcher.
    at(T0 + MATCH_FRESH_MS + 6 * SECOND);
    waiting(await searchMatch(KANTO, "Brock", b));
    at(T0 + 2 * MATCH_FRESH_MS);
    expect(matched(await searchMatch(KANTO, "Misty", newTicket())).ok).toBe(true);
  });

  it("forgets a cancelled search", async () => {
    const a = newTicket();
    waiting(await searchMatch(KANTO, "Ash", a));
    await cancelMatch(KANTO, a);
    // Someone else's ticket can't cancel it.
    const b = newTicket();
    waiting(await searchMatch(KANTO, "Brock", b));
    await cancelMatch(KANTO, a);
    expect((await queueStore.load(queueKey(KANTO)))!.duel.waiting?.ticket).toBe(b);
  });

  it("never pairs a search with itself", async () => {
    const a = newTicket();
    waiting(await searchMatch(KANTO, "Ash", a));
    for (let i = 1; i <= 5; i++) {
      at(T0 + i * SECOND);
      expect(waiting(await searchMatch(KANTO, "Ash", a)).since).toBe(T0);
    }
  });

  it("never pairs different games or settings", async () => {
    waiting(await searchMatch(KANTO, "Ash", newTicket()));
    waiting(await searchMatch({ game: "geo", region: "johto" }, "Brock", newTicket()));
    waiting(await searchMatch(POKEDLE, "Misty", newTicket()));
    expect(new Set([KANTO, { game: "geo", region: "johto" } as const, POKEDLE].map(queueKey)).size).toBe(3);
  });

  it("lets only one of two simultaneous searches have the waiting trainer", async () => {
    const a = newTicket();
    waiting(await searchMatch(POKEDLE, "Ash", a));
    const removed = vi.spyOn(pvpStore, "remove");
    const [b, c] = await Promise.all([searchMatch(POKEDLE, "Brock", newTicket()), searchMatch(POKEDLE, "Misty", newTicket())]);
    // Both read Ash waiting and opened a duel; one lost the swap, threw its duel away and waited instead.
    expect(removed).toHaveBeenCalledTimes(1);
    removed.mockRestore();
    const outcomes = [b, c].map((o) => (o.ok ? o.status : "failed")).sort();
    expect(outcomes).toEqual(["matched", "waiting"]);
    const winner = matched([b, c].find((o) => o.ok && o.status === "matched")!);
    expect(matched(await searchMatch(POKEDLE, "Ash", a)).code).toBe(winner.code);
    // The loser's duel was thrown away; the winner's has Ash in it.
    const { duel } = (await pvpStore.load(winner.code))!;
    expect(duel.players[0].name).toBe("Ash");
  });

  it("gives two trainers with the same name different names in the duel", async () => {
    waiting(await searchMatch(POKEDLE, "Ash", newTicket()));
    const out = matched(await searchMatch(POKEDLE, "ash", newTicket()));
    const { duel } = (await pvpStore.load(out.code))!;
    expect(duel.players.map((p) => p.name)).toEqual(["Ash", "ash 2"]);
    expect(seatNames("Red", "Blue")).toEqual(["Red", "Blue"]);
  });

  it("only takes real games and maps, and never shows anyone else's ticket", async () => {
    expect(matchSettingsSchema.safeParse({ game: "geo", region: "orre" }).success).toBe(false);
    expect(matchSettingsSchema.safeParse({ game: "quiz", module: "cry" }).success).toBe(false);
    expect(matchSettingsSchema.safeParse({ game: "geo", region: "world" }).success).toBe(true);
    const a = newTicket();
    waiting(await searchMatch(KANTO, "Ash", a));
    const other = waiting(await searchMatch({ game: "geo", region: "johto" }, "Brock", newTicket()));
    expect(JSON.stringify(other)).not.toContain(a);
    expect(planSearch({ key: "geo:kanto", matched: {} }, a, T0)).toEqual({ kind: "wait" });
  });
});
