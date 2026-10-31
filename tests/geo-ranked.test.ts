import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEO_BOT_SIGMA,
  GEO_DIVISIONS,
  GEO_ELO_START,
  GEO_RANKED_BOT_K_SCALE,
  GEO_RANKED_QUEUE_KEY,
  GEO_RANKED_SHOCK_K_SCALE,
  botPin,
  geoAllowedDiff,
  geoBotName,
  geoDecayedElo,
  geoDivisionFloor,
  geoDivisionOf,
  geoEloUpdate,
  geoMatchScores,
  geoPairable,
  geoRateDuel,
  gymLeaderOf,
  utcDay,
} from "@/lib/geo-ranked";
import { eloExpected, eloK } from "@/lib/rating/elo";
import { Rng } from "@/lib/rng";
import { clearMemoryGeoRanked, geoRankedConfig, geoRankedKey, memoryGeoRankedStore, settleGeoRanked, type GeoRankedStore } from "@/lib/server/geo-ranked";
import { settleGeoRankedDuel } from "@/lib/server/geo-ranked-duels";
import { geoBotMatch, newTicket, searchGeoRanked, type SearchResult } from "@/lib/server/matchmaking";
import { claimRankedWaiter } from "@/lib/server/ranked-queue";
import { rankedQueueStore, loadDuel, updateDuel } from "@/lib/server/duel-store";
import { advanceDuel, botSeat, duelView, geoRankedMatchOf, guessDuel, leaveDuel, readDuelToken, roundAnswer, skipReveal, touchDuel, type Duel } from "@/lib/server/duel";
import type { PvpFailure } from "@/lib/server/duel-core";
import { GEO_MAX_ROUND_SCORE, WORLD_REGION } from "@/lib/geo-types";
import { DUEL_LEAD_MS, DUEL_ROUND_MS } from "@/lib/duel-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);
const SECOND = 1000;
const DAY = 86_400_000;
const at = (t: number) => vi.setSystemTime(t);

type Matched = Extract<SearchResult, { status: "matched" }>;
type Waiting = Extract<SearchResult, { status: "waiting" }>;
function matched(out: SearchResult | PvpFailure): Matched {
  if (!out.ok || out.status !== "matched") throw new Error(`expected a match, got ${JSON.stringify(out)}`);
  return out;
}
function waiting(out: SearchResult | PvpFailure): Waiting {
  if (!out.ok || out.status !== "waiting") throw new Error(`expected to wait, got ${JSON.stringify(out)}`);
  return out;
}

const RULES = { shockDiff: 350 };
const config = () => geoRankedConfig();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(T0);
  clearMemoryGeoRanked();
  await rankedQueueStore.remove(GEO_RANKED_QUEUE_KEY);
  delete process.env.POKEIQ_GEO_RANKED_SHOCK_DIFF;
  delete process.env.POKEIQ_GEO_RANKED_MAX_DIFF;
  delete process.env.POKEIQ_GEO_RANKED_BOT_AFTER_S;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("divisions", () => {
  it("maps Elo to Poké, Great, Ultra, Master and Beast Ball", () => {
    expect(GEO_DIVISIONS.map((d) => [d.id, d.from])).toEqual([
      ["poke", 1000],
      ["great", 1100],
      ["ultra", 1200],
      ["master", 1350],
      ["beast", 1500],
    ]);
    expect(geoDivisionOf(1000).id).toBe("poke");
    expect(geoDivisionOf(1099).id).toBe("poke");
    expect(geoDivisionOf(1100).id).toBe("great");
    expect(geoDivisionOf(1199).id).toBe("great");
    expect(geoDivisionOf(1200).id).toBe("ultra");
    expect(geoDivisionOf(1349).id).toBe("ultra");
    expect(geoDivisionOf(1350).id).toBe("master");
    expect(geoDivisionOf(1499).id).toBe("master");
    expect(geoDivisionOf(1500).id).toBe("beast");
    expect(geoDivisionOf(2400).id).toBe("beast");
    // Nothing sits below the floor, but a stray value still has a division.
    expect(geoDivisionOf(900).id).toBe("poke");
  });

  it("hides the number in Poké and Great Ball and shows it from Ultra Ball up", () => {
    expect(geoDivisionOf(1050).showElo).toBe(false);
    expect(geoDivisionOf(1150).showElo).toBe(false);
    expect(geoDivisionOf(1200).showElo).toBe(true);
    expect(geoDivisionOf(1400).showElo).toBe(true);
    expect(geoDivisionOf(1600).showElo).toBe(true);
  });

  it("measures progress to the next division", () => {
    const d = geoDivisionOf(1050);
    expect(d).toMatchObject({ index: 0, from: 1000, to: 1100, progress: 0.5, next: "Great Ball" });
    expect(geoDivisionOf(1275)).toMatchObject({ id: "ultra", progress: 0.5, next: "Master Ball" });
    expect(geoDivisionOf(1500)).toMatchObject({ id: "beast", to: null, progress: 0, next: null });
    expect(geoDivisionOf(1700).progress).toBe(1);
    expect(geoDivisionFloor("master")).toBe(1350);
  });
});

describe("rating rules", () => {
  it("scores a win 1, a loss 0 and a draw ½ each (a duel nobody won is a draw)", () => {
    expect(geoMatchScores(0)).toEqual([1, 0]);
    expect(geoMatchScores(1)).toEqual([0, 1]);
    expect(geoMatchScores(null)).toEqual([0.5, 0.5]);
  });

  it("rates with Showdown's curve, in whole points, never below the floor", () => {
    expect(geoEloUpdate(1000, 1000, 1, RULES)).toBe(1045);
    expect(geoEloUpdate(1000, 1000, 0, RULES)).toBe(1000);
    expect(geoEloUpdate(1500, 1500, 0, RULES)).toBe(1480);
    const [a, b] = geoRateDuel([1000, 1000], [1, 0], RULES);
    expect(a).toEqual({ before: 1000, after: 1045, delta: 45 });
    expect(b).toEqual({ before: 1000, after: 1000, delta: 0 });
  });

  it("softens K for both trainers when the gap is wider than the shock line", () => {
    // 1600 vs 1000: a 600-point gap, over the line.
    const [high, low] = geoRateDuel([1600, 1000], [0, 1], RULES);
    const kHigh = eloK(1600, 0) * GEO_RANKED_SHOCK_K_SCALE;
    const kLow = eloK(1000, 1) * GEO_RANKED_SHOCK_K_SCALE;
    expect(high.after).toBe(Math.round(1600 + kHigh * (0 - eloExpected(1600, 1000))));
    expect(low.after).toBe(Math.round(1000 + kLow * (1 - eloExpected(1000, 1600))));
    // The same upset without the absorber moves much more.
    const [plainHigh] = geoRateDuel([1600, 1000], [0, 1], { shockDiff: 0 });
    expect(1600 - plainHigh.after).toBeGreaterThan((1600 - high.after) * 2);
    // Just inside the line: no absorber.
    const [inside] = geoRateDuel([1350, 1000], [0, 1], RULES);
    const [plainInside] = geoRateDuel([1350, 1000], [0, 1], { shockDiff: 0 });
    expect(inside.after).toBe(plainInside.after);
    // And a line of 0 disables it.
    const [off] = geoRateDuel([1600, 1000], [0, 1], { shockDiff: 0 });
    expect(off.after).toBe(plainHigh.after);
  });

  it("reads the shock line and the bot's delay from the environment", () => {
    expect(config()).toMatchObject({ shockDiff: 350, maxDiff: 0, botAfterS: 90 });
    process.env.POKEIQ_GEO_RANKED_SHOCK_DIFF = "0";
    process.env.POKEIQ_GEO_RANKED_MAX_DIFF = "200";
    process.env.POKEIQ_GEO_RANKED_BOT_AFTER_S = "5";
    expect(config()).toMatchObject({ shockDiff: 0, maxDiff: 200, botAfterS: 5 });
    process.env.POKEIQ_GEO_RANKED_BOT_AFTER_S = "nonsense";
    expect(config().botAfterS).toBe(90);
  });
});

describe("matchmaking bracket", () => {
  it("widens with time in the queue: ±50, ±150, ±300, then anyone", () => {
    expect(geoAllowedDiff(0)).toBe(50);
    expect(geoAllowedDiff(14_999)).toBe(50);
    expect(geoAllowedDiff(15_000)).toBe(150);
    expect(geoAllowedDiff(29_999)).toBe(150);
    expect(geoAllowedDiff(30_000)).toBe(300);
    expect(geoAllowedDiff(44_999)).toBe(300);
    expect(geoAllowedDiff(45_000)).toBe(Infinity);
    // The cap from the environment.
    expect(geoAllowedDiff(60_000, 400)).toBe(400);
    expect(geoAllowedDiff(0, 400)).toBe(50);
  });

  it("checks the bracket from both sides", () => {
    // A 200 gap: fine for someone who has waited 30 s, not for a newcomer.
    expect(geoPairable(200, [30_000, 30_000])).toBe(true);
    expect(geoPairable(200, [30_000, 0])).toBe(false);
    expect(geoPairable(200, [0, 30_000])).toBe(false);
    expect(geoPairable(50, [0, 0])).toBe(true);
    expect(geoPairable(51, [0, 0])).toBe(false);
    expect(geoPairable(5000, [45_000, 45_000])).toBe(true);
    expect(geoPairable(5000, [45_000, 45_000], 1000)).toBe(false);
  });

  it("pairs two searchers only once both their waits allow the gap", async () => {
    const red = newTicket();
    const blue = newTicket();
    // Red (1000) has been waiting 30 s: ±300 from Red's side. Blue (1200) just arrived: ±50 from Blue's side.
    const redPolls = async () => waiting(await searchGeoRanked("Red", red, "key-red", async () => ({ rating: 1000, games: 3 }), config()));
    await redPolls();
    at(T0 + 30 * SECOND);
    await redPolls();
    waiting(await searchGeoRanked("Blue", blue, "key-blue", async () => ({ rating: 1200, games: 3 }), config()));
    // Both keep polling. 14 s later Blue still can't: 200 > 50, though from Red's side alone it would have been fine.
    // At 15 s Blue's own bracket reaches ±150: still short of 200.
    for (const s of [37, 44, 50, 56]) {
      at(T0 + s * SECOND);
      await redPolls();
      waiting(await searchGeoRanked("Blue", blue, "key-blue", async () => ({ rating: 1200, games: 3 }), config()));
    }
    // At 30 s, ±300: paired, by whichever of them polls first (Red here: Blue was the one waiting, so Blue takes seat 0).
    at(T0 + 60 * SECOND);
    const redSeat = matched(await searchGeoRanked("Red", red, "key-red", async () => ({ rating: 1000, games: 3 }), config()));
    expect(redSeat.href).toBe(`/guessr/duel/${redSeat.code}`);
    const out = matched(await searchGeoRanked("Blue", blue, "key-blue", async () => ({ rating: 1200, games: 3 }), config()));
    expect(out.code).toBe(redSeat.code);
    const stored = await loadDuel(out.code);
    expect(stored?.duel.ranked).toEqual({ keys: ["key-blue", "key-red"], elos: [1200, 1000], games: [3, 3] });
    expect(stored?.duel.region).toBe(WORLD_REGION);
    expect(stored?.duel.status).toBe("playing");
  });

  it("tells a waiting trainer when the Gym Leader may be called, and not when the bot is off", async () => {
    const out = waiting(await searchGeoRanked("Red", newTicket(), "key-red", async () => ({ rating: 1000, games: 0 }), config()));
    expect(out.botAfterMs).toBe(90_000);
    process.env.POKEIQ_GEO_RANKED_BOT_AFTER_S = "0";
    const off = waiting(await searchGeoRanked("Red", out.ticket, "key-red", async () => ({ rating: 1000, games: 0 }), config()));
    expect(off.botAfterMs).toBeUndefined();
  });
});

describe("the Gym Leader bot", () => {
  it("is named as a Gym Leader, never as a trainer", () => {
    expect(geoBotName("Brock")).toBe("Gym Leader Brock");
    expect(gymLeaderOf("Gym Leader Brock")).toEqual({ name: "Brock", type: "Rock" });
    expect(gymLeaderOf("Brock")).toBeNull();
    expect(gymLeaderOf("Red")).toBeNull();
  });

  it("aims tighter in higher divisions: a seeded Gaussian miss scaled to the map", () => {
    const map = { width: 2000, height: 1000 };
    const diag = Math.hypot(map.width, map.height);
    const score = (d: number) => Math.min(GEO_MAX_ROUND_SCORE, Math.round(GEO_MAX_ROUND_SCORE * Math.exp((-10 * d) / diag)));
    const averages: Record<string, number> = {};
    for (const division of GEO_DIVISIONS) {
      const rng = new Rng(`bot:${division.id}`);
      const sigma = GEO_BOT_SIGMA[division.id];
      let total = 0;
      const N = 4000;
      let sumDx2 = 0;
      for (let i = 0; i < N; i++) {
        const pin = botPin([0.5, 0.5], map, sigma, () => rng.next());
        expect(pin.x).toBeGreaterThanOrEqual(0);
        expect(pin.x).toBeLessThanOrEqual(1);
        const dx = (pin.x - 0.5) * map.width;
        const dy = (pin.y - 0.5) * map.height;
        sumDx2 += dx * dx;
        total += score(Math.hypot(dx, dy));
      }
      averages[division.id] = total / N;
      // The miss along x has the sigma asked for (as a fraction of the diagonal), within sampling noise.
      expect(Math.sqrt(sumDx2 / N) / diag).toBeCloseTo(sigma, 2);
    }
    // Poké Ball plays like a first-timer, Beast Ball like a strong trainer, and every step up is tighter.
    expect(averages.poke).toBeGreaterThan(1700);
    expect(averages.poke).toBeLessThan(2300);
    expect(averages.beast).toBeGreaterThan(3700);
    expect(averages.beast).toBeLessThan(4200);
    expect(averages.great).toBeGreaterThan(averages.poke);
    expect(averages.ultra).toBeGreaterThan(averages.great);
    expect(averages.master).toBeGreaterThan(averages.ultra);
    expect(averages.beast).toBeGreaterThan(averages.master);
    // Seeded: the same seed gives the same pins.
    const a = new Rng("same");
    const b = new Rng("same");
    expect(botPin([0.3, 0.7], map, 0.05, () => a.next())).toEqual(botPin([0.3, 0.7], map, 0.05, () => b.next()));
  });

  it("is rated at half the K, against the division's floor, and moves only the trainer", async () => {
    const store = memoryGeoRankedStore();
    // A Great Ball trainer beats the bot (which plays at 1,100).
    await seed(store, "key-red", "Red", 1150, 4);
    const out = await settleGeoRanked({ code: "botduel1", keys: ["key-red", null], names: ["Red", "Gym Leader Brock"], winner: 0, at: T0, points: [12_000, 9_000], botElo: 1100 }, store, RULES);
    const k = eloK(1150, 1) * GEO_RANKED_BOT_K_SCALE;
    const expected = Math.round(1150 + k * (1 - eloExpected(1150, 1100)));
    expect(out).toEqual({ before: [1150, 1100], after: [expected, 1100] });
    expect(expected - 1150).toBeLessThan(geoEloUpdate(1150, 1100, 1, RULES) - 1150);
    const red = await store.standing("key-red", utcDay(T0));
    expect(red).toMatchObject({ elo: expected, games: 5, wins: 1, bestScore: 12_000 });
    // The bot has no row: the ladder is humans only.
    expect((await store.top(100, utcDay(T0))).map((r) => r.name)).toEqual(["Red"]);
    // Counted once: a second call returns the first result.
    expect(await settleGeoRanked({ code: "botduel1", keys: ["key-red", null], names: ["Red", "Gym Leader Brock"], winner: 1, at: T0, points: [0, 0], botElo: 1100 }, store, RULES)).toEqual(out);
    expect((await store.standing("key-red", utcDay(T0)))?.games).toBe(5);
  });
});

describe("decay", () => {
  it("catches up lazily on the days since the last duel, and reads the same way twice", () => {
    expect(geoDecayedElo({ elo: 1800, day: null, gamesToday: 0 }, "2026-10-27")).toBe(1800);
    expect(geoDecayedElo({ elo: 1800, day: "2026-10-27", gamesToday: 2 }, "2026-10-27")).toBe(1800);
    // One day with two games: 3 points. The next day with none: 1 per 50 above 1400.
    expect(geoDecayedElo({ elo: 1800, day: "2026-10-27", gamesToday: 2 }, "2026-10-28")).toBe(1797);
    expect(geoDecayedElo({ elo: 1800, day: "2026-10-27", gamesToday: 2 }, "2026-10-29")).toBe(1797 - 7);
    // Six games that day: nothing that day, then the plain decay.
    expect(geoDecayedElo({ elo: 1800, day: "2026-10-27", gamesToday: 6 }, "2026-10-28")).toBe(1800);
    expect(geoDecayedElo({ elo: 1800, day: "2026-10-27", gamesToday: 6 }, "2026-10-29")).toBe(1792);
    // Below 1400 nothing moves.
    expect(geoDecayedElo({ elo: 1380, day: "2026-01-01", gamesToday: 0 }, "2026-10-29")).toBe(1380);
  });

  it("applies in the store on read, writes it back once, and settles from the decayed rating", async () => {
    const store = memoryGeoRankedStore();
    await seed(store, "key-red", "Red", 1800, 10, utcDay(T0));
    await seed(store, "key-blue", "Blue", 1800, 10, utcDay(T0));
    const later = T0 + 3 * DAY;
    // Three days away with one game on the last day played: 3, then 8, then 7 (per 50 above 1400).
    const expected = 1800 - 3 - 7 - 7;
    expect(await store.rating("key-red", utcDay(later))).toEqual({ elo: expected, games: 10 });
    const standing = await store.standing("key-red", utcDay(later));
    expect(standing?.elo).toBe(expected);
    // Written back: reading again the same day changes nothing.
    expect((await store.standing("key-red", utcDay(later)))?.elo).toBe(expected);
    expect(await store.rating("key-red", utcDay(later))).toEqual({ elo: expected, games: 10 });
    // A duel on that day starts from the decayed ratings (K is 32 up here).
    const out = await settleGeoRanked({ code: "decayed1", keys: ["key-red", "key-blue"], names: ["Red", "Blue"], winner: 0, at: later, points: [1, 1] }, store, RULES);
    expect(out.before).toEqual([expected, expected]);
    expect(out.after).toEqual([expected + 16, expected - 16]);
    // And that day's game count starts again, so tomorrow's decay knows one game was played.
    expect(await store.rating("key-red", utcDay(later + DAY))).toEqual({ elo: expected + 16 - Math.floor((expected + 16 - 1500) / 100), games: 11 });
  });
});

describe("settling", () => {
  it("moves both trainers once, whoever asks first, and reports by seat", async () => {
    const store = memoryGeoRankedStore();
    const match = { code: "duel0001", keys: ["key-red", "key-blue"] as [string, string], names: ["Red", "Blue"] as [string, string], winner: 1, at: T0, points: [8_000, 15_000] as [number, number] };
    const first = await settleGeoRanked(match, store, RULES);
    expect(first).toEqual({ before: [1000, 1000], after: [1000, 1045] });
    // Asked again (a racing poll, or the other seat's order): the same numbers.
    expect(await settleGeoRanked(match, store, RULES)).toEqual(first);
    const red = await store.standing("key-red", utcDay(T0));
    const blue = await store.standing("key-blue", utcDay(T0));
    expect(red).toMatchObject({ elo: 1000, games: 1, wins: 0, losses: 1, bestScore: 8_000, position: 2, players: 2 });
    expect(blue).toMatchObject({ elo: 1045, games: 1, wins: 1, losses: 0, bestScore: 15_000, position: 1, players: 2 });
    // The ladder hides the number in the lower divisions.
    const top = await store.top(10, utcDay(T0));
    expect(top).toEqual([
      { position: 1, name: "Blue", elo: null, division: "poke", games: 1, wins: 1, losses: 0 },
      { position: 2, name: "Red", elo: null, division: "poke", games: 1, wins: 0, losses: 1 },
    ]);
  });

  it("computes again when a rating moved in between", async () => {
    const store = memoryGeoRankedStore();
    await seed(store, "key-red", "Red", 1300, 5);
    await seed(store, "key-blue", "Blue", 1300, 5);
    // Red's other duel is counted first, from stale expectations: the store says so and the settle recomputes.
    const original = store.apply;
    const spy = vi.spyOn(store, "apply");
    let interrupted = false;
    spy.mockImplementation(async (input) => {
      if (!interrupted) {
        interrupted = true;
        await original({ ...input, code: "other001", keys: ["key-red", "key-green"], names: ["Red", "Green"], expect: [input.expect[0], { elo: 1000, games: 0 }], after: [1316, 1000], scores: [1, 0], points: [1, 1] });
      }
      return original(input);
    });
    const out = await settleGeoRanked({ code: "duel0002", keys: ["key-red", "key-blue"], names: ["Red", "Blue"], winner: 0, at: T0, points: [1, 1] }, store, RULES);
    expect(out.before[0]).toBe(1316);
    expect(out.after[0]).toBe(geoEloUpdate(1316, 1300, 1, RULES));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("the ranked flow", () => {
  const rating = (elo: number) => async () => ({ rating: elo, games: 0 });

  it("matches two trainers, plays the duel, and counts it once it's over", async () => {
    const red = newTicket();
    // Blue has a rating already (the queue reads it from the store; so does the settle).
    await seed(memoryGeoRankedStore(), geoRankedKey("a:blue"), "Blue", 1030, 2);
    const [redChange, blueChange] = geoRateDuel([1000, 1030], [1, 0], RULES);
    waiting(await searchGeoRanked("Red", red, geoRankedKey("a:red"), rating(1000), config()));
    at(T0 + SECOND);
    const blueSeat = matched(await searchGeoRanked("Blue", newTicket(), geoRankedKey("a:blue"), rating(1030), config()));
    const redSeat = matched(await searchGeoRanked("Red", red, geoRankedKey("a:red"), rating(1000), config()));
    const code = blueSeat.code;
    const ids = [readDuelToken(redSeat.token, code)!, readDuelToken(blueSeat.token, code)!];
    let duel = (await loadDuel(code))!.duel;
    expect(duel.players.map((p) => p.name)).toEqual(["Red", "Blue"]);
    expect(duelView(duel, ids[0], T0 + SECOND, 0).ranked).toEqual({ elos: [1000, 1030], bot: false });
    // Blue leaves mid-duel: Red wins.
    const t = duel.rounds[0].startsAt + 2 * SECOND;
    duel = touchDuel(duel, ids[0], t);
    const left = leaveDuel(duel, ids[1], t);
    if (!left.ok) throw new Error(left.error);
    await updateDuel(code, () => ({ ok: true as const, duel: left.duel }));
    expect(left.duel.status).toBe("finished");
    expect(geoRankedMatchOf(left.duel)).toMatchObject({ code, keys: [geoRankedKey("a:red"), geoRankedKey("a:blue")], winner: 0, at: t });

    const settled = await settleGeoRankedDuel(left.duel, 1);
    expect(settled.duel.ranked?.result).toEqual({ before: [1000, 1030], after: [redChange.after, blueChange.after] });
    expect(redChange.after).toBeGreaterThan(1045);
    expect(blueChange.after).toBeLessThan(1030);
    const view = duelView(settled.duel, ids[1], t, settled.rev);
    expect(view.ranked).toEqual({ elos: [1000, 1030], bot: false, result: { before: [1000, 1030], after: [redChange.after, blueChange.after] } });
    expect(JSON.stringify(view)).not.toContain(geoRankedKey("a:red"));
    // Settling again changes nothing.
    const again = await settleGeoRankedDuel(settled.duel, settled.rev);
    expect(again.duel.ranked?.result).toEqual(settled.duel.ranked?.result);
    const store = memoryGeoRankedStore();
    expect((await store.standing(geoRankedKey("a:red"), utcDay(t)))?.games).toBe(1);
    expect((await store.standing(geoRankedKey("a:blue"), utcDay(t)))?.games).toBe(3);
  });

  it("offers the Gym Leader after the wait, which plays every round server-side and is rated at half K", async () => {
    process.env.POKEIQ_GEO_RANKED_BOT_AFTER_S = "10";
    const ticket = newTicket();
    const key = geoRankedKey("a:red");
    const out = waiting(await searchGeoRanked("Red", ticket, key, rating(1000), config()));
    expect(out.botAfterMs).toBe(10_000);
    // Too soon: still in the queue.
    at(T0 + 5 * SECOND);
    const early = await geoBotMatch(ticket, config());
    expect(early).toMatchObject({ ok: false, status: 409 });
    waiting(await searchGeoRanked("Red", ticket, key, rating(1000), config()));
    // After the wait: out of the queue, into a duel with a Gym Leader at the division's floor.
    at(T0 + 9 * SECOND);
    const seat = matched(await geoBotMatch(ticket, config()));
    expect(await claimRankedWaiter(ticket, GEO_RANKED_QUEUE_KEY, 0)).toBeNull();
    const code = seat.code;
    const me = readDuelToken(seat.token, code)!;
    let duel: Duel = (await loadDuel(code))!.duel;
    expect(duel.status).toBe("playing");
    expect(duel.players[1].name).toMatch(/^Gym Leader /);
    expect(duel.players[1].bot).toEqual({ division: "poke" });
    expect(duel.ranked).toEqual({ keys: [key, null], elos: [1000, 1000], games: [0, 0] });
    const view = duelView(duel, me, Date.now(), 0);
    expect(view.players[1]).toMatchObject({ bot: true, ready: true, quiet: false });
    expect(view.ranked).toEqual({ elos: [1000, 1000], bot: true });

    // Red guesses the exact place every round; the bot guesses on its own, a human-like while in, and never times out.
    const bot = botSeat(duel);
    expect(bot).toBe(1);
    for (let i = 0; i < 12 && duel.status === "playing"; i++) {
      const index = duel.rounds.length - 1;
      const round = duel.rounds[index];
      const { spot, pin } = roundAnswer(duel, index);
      const [x, y] = spot ?? pin;
      // The bot's guess lands a human-like while in, without Red doing anything; then Red has the usual 15 s.
      duel = touchDuel(duel, me, round.startsAt + 21 * SECOND);
      const botAt = duel.rounds[index].guesses[bot]?.at;
      expect(botAt).toBeDefined();
      expect(botAt!).toBeGreaterThan(round.startsAt + 7 * SECOND);
      expect(botAt!).toBeLessThan(round.startsAt + 21 * SECOND);
      expect(duel.rounds[index].result).toBeUndefined();
      expect(duel.rounds[index].guesses[bot]!.x).toBeGreaterThanOrEqual(0);
      expect(duel.rounds[index].guesses[bot]!.x).toBeLessThanOrEqual(1);
      expect(DUEL_ROUND_MS).toBeGreaterThan(21 * SECOND);
      const guessed = guessDuel(duel, me, index, { x, y }, botAt! + 2 * SECOND);
      if (!guessed.ok) throw new Error(guessed.error);
      duel = guessed.duel;
      expect(duel.rounds[index].result).toBeDefined();
      // The bot has already pressed Next: Red's press ends the reveal at once.
      expect(duel.rounds[index].skip[bot]).toBe(true);
      if (duel.status === "playing") {
        const next = skipReveal(duel, me, index, duel.rounds[index].result!.at + SECOND);
        if (!next.ok) throw new Error(next.error);
        duel = advanceDuel(next.duel, duel.rounds[index].result!.at + SECOND + DUEL_LEAD_MS);
      }
    }
    expect(duel.status).toBe("finished");
    expect(duel.end?.winner).toBe(0);
    // The bot's pins are the same whenever the duel is replayed from its seed.
    const replay = touchDuel((await loadDuel(code))!.duel, me, duel.rounds[0].startsAt + 21 * SECOND);
    expect(replay.rounds[0].guesses[bot]).toEqual(duel.rounds[0].guesses[bot]);

    await updateDuel(code, () => ({ ok: true as const, duel }));
    const settled = await settleGeoRankedDuel(duel, 1);
    const k = eloK(1000, 1) * GEO_RANKED_BOT_K_SCALE;
    expect(settled.duel.ranked?.result).toEqual({ before: [1000, 1000], after: [Math.round(1000 + k * 0.5), 1000] });
    const standing = await memoryGeoRankedStore().standing(key, utcDay(Date.now()));
    expect(standing).toMatchObject({ games: 1, wins: 1, elo: Math.round(1000 + k * 0.5) });
    expect(standing!.bestScore).toBeGreaterThan(0);
  });

  it("gives the bot a Gym Leader at the trainer's division floor, and keeps it out of a casual rematch's rating", async () => {
    process.env.POKEIQ_GEO_RANKED_BOT_AFTER_S = "1";
    const ticket = newTicket();
    waiting(await searchGeoRanked("Red", ticket, "key-red", rating(1420), config()));
    at(T0 + 2 * SECOND);
    const seat = matched(await geoBotMatch(ticket, config()));
    const duel = (await loadDuel(seat.code))!.duel;
    expect(duel.players[1].bot).toEqual({ division: "master" });
    expect(duel.ranked?.elos).toEqual([1420, 1350]);
  });
});

/** Puts a trainer on the ladder at `elo` after `games` duels (by counting duels against the bot). */
async function seed(store: GeoRankedStore, key: string, name: string, elo: number, games: number, day = utcDay(T0)) {
  const db = (globalThis as unknown as { __pokeiqGeoRanked?: { players: Map<string, Record<string, unknown>> } }).__pokeiqGeoRanked;
  if (!db) throw new Error("memory store not open");
  db.players.set(key, { name, elo, games, wins: 0, losses: games, draws: 0, bestScore: 0, day, gamesToday: 1 });
  expect((await store.rating(key, day))?.elo).toBe(elo);
  expect(GEO_ELO_START).toBe(1000);
}
