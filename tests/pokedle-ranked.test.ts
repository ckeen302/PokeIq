import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RANKED_FLOOR,
  RANKED_K,
  RANKED_K_PROVISIONAL,
  RANKED_PROVISIONAL_GAMES,
  expectedScore,
  matchScores,
  rateMatch,
  tierOf,
} from "@/lib/ranked";
import {
  RANKED_GAP_BASE,
  RANKED_GAP_MAX,
  RANKED_QUEUE_KEY,
  allowedGap,
  emptyRankedQueue,
  planRanked,
  withRankedWaiter,
  type RankedQueueRow,
} from "@/lib/server/ranked-queue";
import { clearMemoryRanked, memoryRankedStore, newAnonId, rankedKey, readAnonId, settleRanked } from "@/lib/server/ranked";
import { settleRankedDuel } from "@/lib/server/ranked-duels";
import { newTicket, searchMatch, searchRankedMatch, type SearchResult } from "@/lib/server/matchmaking";
import { pvpStore, queueStore, rankedQueueStore } from "@/lib/server/duel-store";
import { duelView, emoteDuel, leaveDuel, rematchOf, touchDuel, type PvpDuel } from "@/lib/server/duels";
import { emoteBlocked, readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import { rankedMatchOf, type PokedleDuel } from "@/lib/server/pokedle-duel";
import { EMOTE_BURST, EMOTE_GAP_MS, EMOTE_WINDOW_MS, PVP_AWAY_MS, type DleDuelView } from "@/lib/pvp-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
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
  await rankedQueueStore.remove(RANKED_QUEUE_KEY);
  await queueStore.remove("pokedle:all");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("rating maths", () => {
  it("gives even odds to equal ratings and favours the higher one", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 3);
    expect(expectedScore(1000, 1400) + expectedScore(1400, 1000)).toBeCloseTo(1, 10);
  });

  it("moves established ratings by K/2 on an even game, provisional ones by the larger K", () => {
    const [a, b] = rateMatch(
      [
        { rating: 1000, games: 20 },
        { rating: 1000, games: 20 },
      ],
      [1, 0]
    );
    expect(a).toEqual({ before: 1000, after: 1000 + RANKED_K / 2, delta: RANKED_K / 2 });
    expect(b.delta).toBe(-RANKED_K / 2);

    const [p, q] = rateMatch(
      [
        { rating: 1000, games: 0 },
        { rating: 1000, games: RANKED_PROVISIONAL_GAMES },
      ],
      [1, 0]
    );
    expect(p.delta).toBe(RANKED_K_PROVISIONAL / 2);
    expect(q.delta).toBe(-RANKED_K / 2);
    // The tenth game is still provisional; the eleventh isn't.
    expect(rateMatch([{ rating: 1000, games: RANKED_PROVISIONAL_GAMES - 1 }, { rating: 1000, games: 50 }], [1, 0])[0].delta).toBe(RANKED_K_PROVISIONAL / 2);
  });

  it("rewards an upset more than an expected win, and a draw moves ratings towards each other", () => {
    const upset = rateMatch([{ rating: 1000, games: 30 }, { rating: 1400, games: 30 }], [1, 0]);
    const expected = rateMatch([{ rating: 1400, games: 30 }, { rating: 1000, games: 30 }], [1, 0]);
    expect(upset[0].delta).toBeGreaterThan(expected[0].delta);
    expect(upset[0].delta).toBe(22);
    expect(expected[0].delta).toBe(2);
    const draw = rateMatch([{ rating: 1000, games: 30 }, { rating: 1400, games: 30 }], [0.5, 0.5]);
    expect(draw[0].delta).toBeGreaterThan(0);
    expect(draw[1].delta).toBeLessThan(0);
  });

  it("never drops a rating below the floor", () => {
    const [low] = rateMatch([{ rating: RANKED_FLOOR, games: 3 }, { rating: 100, games: 3 }], [0, 1]);
    expect(low.after).toBe(RANKED_FLOOR);
  });

  it("scores forfeits and walk-outs as losses", () => {
    expect(matchScores("played", 0)).toEqual([1, 0]);
    expect(matchScores("played", null)).toEqual([0.5, 0.5]);
    expect(matchScores("left", 1)).toEqual([0, 1]);
    expect(matchScores("idle", 0)).toEqual([1, 0]);
    // Both walked away with no winner: both lose.
    expect(matchScores("idle", null)).toEqual([0, 0]);
    expect(matchScores("left", null)).toEqual([0, 0]);
  });

  it("names tiers and divisions, with progress to the next", () => {
    expect(tierOf(1000)).toMatchObject({ label: "Poké Ball II", progress: 0, next: { label: "Poké Ball I", at: 1100 } });
    expect(tierOf(950)).toMatchObject({ label: "Poké Ball III", progress: 0.5 });
    expect(tierOf(400)).toMatchObject({ label: "Poké Ball III", progress: 0 });
    expect(tierOf(1199)).toMatchObject({ label: "Poké Ball I", next: { label: "Great Ball III", at: 1200 } });
    expect(tierOf(1200).label).toBe("Great Ball III");
    expect(tierOf(1450)).toMatchObject({ label: "Great Ball I", progress: 0.5 });
    expect(tierOf(1799)).toMatchObject({ label: "Ultra Ball I", next: { label: "Master Ball", at: 1800 } });
    expect(tierOf(2300)).toMatchObject({ label: "Master Ball", division: null, next: null, progress: 1 });
    // Every division is a step up from the last.
    const steps = [950, 1050, 1150, 1250, 1350, 1450, 1550, 1650, 1750, 1850].map((r) => tierOf(r).step);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("anonymous ranked ids", () => {
  it("only accepts ids the server signed", () => {
    const id = newAnonId();
    expect(readAnonId(id)).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(readAnonId(`${id.slice(0, -2)}xx`)).toBeNull();
    expect(readAnonId("not-a-token")).toBeNull();
    // Stored only as an HMAC, the same every time.
    expect(rankedKey("a:abc")).toBe(rankedKey("a:abc"));
    expect(rankedKey("a:abc")).not.toContain("abc");
  });
});

describe("rating updates", () => {
  const match = (code: string, winner: number | null = 0) => ({
    code,
    keys: [rankedKey("u:red"), rankedKey("u:blue")] as [string, string],
    names: ["Red", "Blue"] as [string, string],
    reason: "played" as const,
    winner,
  });

  it("counts a duel exactly once, however often it's settled", async () => {
    const store = memoryRankedStore();
    const first = await settleRanked(match("aaaa1111"), store);
    expect(first).toEqual({ before: [1000, 1000], after: [1024, 976] });
    const again = await settleRanked(match("aaaa1111"), store);
    expect(again).toEqual(first);
    expect(await store.rating(rankedKey("u:red"))).toEqual({ rating: 1024, games: 1 });
    expect(await store.rating(rankedKey("u:blue"))).toEqual({ rating: 976, games: 1 });
    // Asked with the seats the other way round, the same numbers come back in that order.
    const flipped = await settleRanked({ ...match("aaaa1111"), keys: [rankedKey("u:blue"), rankedKey("u:red")] }, store);
    expect(flipped).toEqual({ before: [1000, 1000], after: [976, 1024] });
  });

  it("settled at the same moment, still counts once", async () => {
    const store = memoryRankedStore();
    const [a, b] = await Promise.all([settleRanked(match("bbbb2222"), store), settleRanked(match("bbbb2222"), store)]);
    expect(a).toEqual(b);
    expect((await store.standing(rankedKey("u:red")))!).toMatchObject({ games: 1, wins: 1, streak: 1, position: 1, players: 2 });
  });

  it("refuses a change computed from a stale rating, and recomputes", async () => {
    const store = memoryRankedStore();
    await settleRanked(match("cccc3333"), store);
    const stale = await store.apply({
      code: "dddd4444",
      keys: match("x").keys,
      names: ["Red", "Blue"],
      expect: [
        { rating: 1000, games: 0 },
        { rating: 1000, games: 0 },
      ],
      after: [1024, 976],
      scores: [1, 0],
    });
    expect(stale).toEqual({
      status: "stale",
      current: [
        { rating: 1024, games: 1 },
        { rating: 976, games: 1 },
      ],
    });
    // settleRanked reads afresh: the second game starts from 1,024 and 976.
    const second = await settleRanked(match("dddd4444", 1), store);
    expect(second.before).toEqual([1024, 976]);
    expect((await store.standing(rankedKey("u:red")))!).toMatchObject({ games: 2, wins: 1, losses: 1, streak: 0, bestStreak: 1 });
  });
});

describe("the ranked queue", () => {
  const me = (ticket: string, player: string) => ({ ticket, name: player, player });
  const rowWith = (...waiters: [string, number, number][]): RankedQueueRow =>
    waiters.reduce((row, [player, rating, since]) => withRankedWaiter(row, me(`t-${player}`, player), { rating, games: 5 }, since), emptyRankedQueue());

  it("widens the allowed gap the longer someone waits, up to a cap", () => {
    expect(allowedGap(0)).toBe(RANKED_GAP_BASE);
    expect(allowedGap(10 * SECOND)).toBe(RANKED_GAP_BASE + 150);
    expect(allowedGap(30 * SECOND)).toBeGreaterThan(allowedGap(10 * SECOND));
    expect(allowedGap(10 * 60 * SECOND)).toBe(RANKED_GAP_MAX);
  });

  it("pairs close ratings at once, distant ones only after waiting", () => {
    // Ash (1,400) has just started waiting: Brock at 1,000 is too far off...
    const row = rowWith(["ash", 1400, T0]);
    expect(planRanked(row, me("t-brock", "brock"), 1000, T0 + SECOND).kind).toBe("wait");
    // ...Misty at 1,350 isn't.
    expect(planRanked(row, me("t-misty", "misty"), 1350, T0 + SECOND)).toMatchObject({ kind: "pair", opponent: { player: "ash" } });
    // Twenty seconds on (Ash still polling), 400 points is close enough.
    const later = withRankedWaiter(row, me("t-ash", "ash"), { rating: 1400, games: 5 }, T0 + 20 * SECOND);
    expect(planRanked(later, me("t-brock", "brock"), 1000, T0 + 20 * SECOND)).toMatchObject({ kind: "pair", opponent: { player: "ash" } });
  });

  it("picks the closest rating, and never the same trainer or a stale one", () => {
    const row = rowWith(["ash", 1100, T0], ["gary", 1040, T0], ["oak", 1000, T0 - 60 * SECOND]);
    // Oak stopped polling long ago; Gary is closer than Ash.
    expect(planRanked(row, me("t-new", "new"), 1010, T0 + SECOND)).toMatchObject({ kind: "pair", opponent: { player: "gary" } });
    // Gary in a second tab is never paired with Gary.
    expect(planRanked(row, me("t-gary2", "gary"), 1040, T0 + SECOND)).toMatchObject({ kind: "pair", opponent: { player: "ash" } });
  });

  it("opens a ranked duel with both ratings, the keys kept server-side", async () => {
    const red = newTicket();
    const rating = async () => ({ rating: 1000, games: 0 });
    waiting(await searchRankedMatch("Red", red, rankedKey("a:red"), rating));
    at(T0 + 2 * SECOND);
    const blue = matched(await searchRankedMatch("Blue", newTicket(), rankedKey("a:blue"), rating));
    const redSeat = matched(await searchRankedMatch("Red", red, rankedKey("a:red"), rating));
    expect(redSeat.code).toBe(blue.code);
    const duel = (await pvpStore.load(blue.code))!.duel as PokedleDuel;
    expect(duel).toMatchObject({ queue: "ranked", status: "playing", ranked: { ratings: [1000, 1000], games: [0, 0] } });
    const view = duelView(duel, readPvpToken(blue.token, blue.code), T0 + 3 * SECOND, 1) as DleDuelView;
    expect(view.ranked).toEqual({ ratings: [1000, 1000], provisional: [true, true], result: undefined });
    expect(JSON.stringify(view)).not.toContain(rankedKey("a:red"));
    // A rematch is casual.
    const rematch = rematchOf(duel, "zzzz9999", T0) as PokedleDuel;
    expect(rematch.ranked).toBeUndefined();
    expect(rematch.queue).toBeUndefined();
  });

  it("keeps ranked and casual searchers apart", async () => {
    waiting(await searchRankedMatch("Red", newTicket(), rankedKey("a:red"), async () => ({ rating: 1000, games: 0 })));
    waiting(await searchMatch({ game: "pokedle" }, "Blue", newTicket()));
  });
});

describe("forfeits", () => {
  async function rankedDuel(): Promise<{ duel: PokedleDuel; ids: [string, string] }> {
    const rating = async () => ({ rating: 1000, games: 0 });
    const red = newTicket();
    waiting(await searchRankedMatch("Red", red, rankedKey("a:red"), rating));
    const blue = matched(await searchRankedMatch("Blue", newTicket(), rankedKey("a:blue"), rating));
    const redSeat = matched(await searchRankedMatch("Red", red, rankedKey("a:red"), rating));
    const duel = (await pvpStore.load(blue.code))!.duel as PokedleDuel;
    return { duel, ids: [readPvpToken(redSeat.token, blue.code)!, readPvpToken(blue.token, blue.code)!] };
  }

  it("doesn't count a duel still being played", async () => {
    const { duel } = await rankedDuel();
    expect(rankedMatchOf(duel)).toBeNull();
    const out = await settleRankedDuel(duel as PvpDuel, 0);
    expect((out.duel as PokedleDuel).ranked!.result).toBeUndefined();
  });

  it("counts leaving as a loss, and records the change on the duel once", async () => {
    const { duel, ids } = await rankedDuel();
    const left = leaveDuel(duel, ids[0], T0 + 5 * SECOND);
    if (!left.ok) throw new Error(left.error);
    expect(left.duel.end).toMatchObject({ reason: "left", winner: 1 });
    const stored = await pvpStore.load(duel.code);
    expect(await pvpStore.save(left.duel, stored!.version)).toBe(true);

    const settled = await settleRankedDuel(left.duel as PvpDuel, stored!.version + 1);
    const result = (settled.duel as PokedleDuel).ranked!.result!;
    expect(result.after[0]).toBeLessThan(1000);
    expect(result.after[1]).toBeGreaterThan(1000);
    // Settling again (another poll) changes nothing.
    const again = await settleRankedDuel(settled.duel, settled.rev);
    expect(again.rev).toBe(settled.rev);
    const store = memoryRankedStore();
    expect(await store.rating(rankedKey("a:blue"))).toEqual({ rating: result.after[1], games: 1 });
    const view = duelView(settled.duel, ids[1], T0, settled.rev) as DleDuelView;
    expect(view.ranked?.result).toEqual(result);
  });

  it("gives the win to the trainer who stayed when the other goes quiet", async () => {
    const { duel, ids } = await rankedDuel();
    // Blue keeps polling; Red's tab is gone.
    let d: PvpDuel = duel;
    for (let t = 5; t * SECOND <= PVP_AWAY_MS + 10 * SECOND; t += 5) d = touchDuel(d, ids[1], T0 + t * SECOND);
    expect(d.status).toBe("finished");
    expect(d.end).toMatchObject({ reason: "left", winner: 1 });
    const m = rankedMatchOf(d as PokedleDuel)!;
    const result = await settleRanked(m, memoryRankedStore());
    expect(result.after[1]).toBeGreaterThan(result.after[0]);
  });

  it("never counts a casual duel", async () => {
    const red = newTicket();
    waiting(await searchMatch({ game: "pokedle" }, "Red", red));
    const blue = matched(await searchMatch({ game: "pokedle" }, "Blue", newTicket()));
    const duel = (await pvpStore.load(blue.code))!.duel as PokedleDuel;
    expect(duel.queue).toBe("casual");
    const left = leaveDuel(duel, readPvpToken(blue.token, blue.code)!, T0 + SECOND);
    if (!left.ok) throw new Error(left.error);
    expect(rankedMatchOf(left.duel as PokedleDuel)).toBeNull();
  });
});

describe("reactions", () => {
  async function liveDuel() {
    const red = newTicket();
    waiting(await searchMatch({ game: "pokedle" }, "Red", red));
    const blue = matched(await searchMatch({ game: "pokedle" }, "Blue", newTicket()));
    const duel = (await pvpStore.load(blue.code))!.duel as PvpDuel;
    return { duel, blue: readPvpToken(blue.token, blue.code)! };
  }

  it("allows a few at a time, spaced out", async () => {
    const { duel, blue } = await liveDuel();
    let d = duel;
    const send = (t: number, emote: "gg" | "fire" = "fire") => emoteDuel(d, blue, emote, T0 + t);
    const ok = (t: number) => {
      const out = send(t);
      if (!out.ok) throw new Error(`refused at ${t}: ${out.error}`);
      d = out.duel;
    };
    ok(0);
    // Too soon after the last one.
    expect(send(EMOTE_GAP_MS - 1)).toMatchObject({ ok: false, status: 429 });
    ok(EMOTE_GAP_MS);
    ok(2 * EMOTE_GAP_MS);
    expect(EMOTE_BURST).toBe(3);
    // A fourth inside the window is too many...
    expect(send(3 * EMOTE_GAP_MS)).toMatchObject({ ok: false, status: 429 });
    // ...until the first has left it.
    ok(EMOTE_WINDOW_MS + 1);
    // Older ones are dropped once they can no longer count or show.
    expect(d.emotes!.map((e) => e.n)).toEqual([2, 3, 4]);
    const view = duelView(d, null, T0 + EMOTE_WINDOW_MS + 2, 1);
    expect(view.emotes!.map((e) => Object.keys(e).sort())).toEqual([["at", "emote", "n", "seat"]]);
  });

  it("counts each trainer separately", () => {
    const emotes = [{ n: 1, seat: 0, emote: "gg" as const, at: T0 }];
    expect(emoteBlocked(emotes, 0, T0 + 10)).not.toBeNull();
    expect(emoteBlocked(emotes, 1, T0 + 10)).toBeNull();
  });
});
