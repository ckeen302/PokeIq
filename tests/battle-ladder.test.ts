import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rankedBattleQueueKey, searchRankedBattle, type BattleSearchResult } from "@/lib/server/battle-engine/matchmaking";
import { rankedQueueStore } from "@/lib/server/duel-store";
import { newTicket } from "@/lib/server/match-queue";
import { actOnBattle, pollBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { settleBattle } from "@/lib/server/battle-engine/settle";
import { NEW_BATTLE_RATING, catchUpElo, clearMemoryLadder, memoryLadderStore, pairingRating, rateBattle, settleRankedBattle, utcDay } from "@/lib/server/battle-engine/ladder";
import { battleProfile, clearMemoryRecords } from "@/lib/server/battle-engine/records";
import { clearMemoryReplays, memoryReplayStore } from "@/lib/server/battle-engine/replays";
import { LADDER_FORMATS, isPopularLadderFormat, ladderReason } from "@/lib/battle/ladder";
import { BATTLE_AWAY_MS, type StandardFormatId } from "@/lib/battle/play";
import { GLICKO_START, rateGlicko } from "@/lib/battle/glicko";
import { eloExpected, eloUpdate } from "@/lib/rating/elo";
import type { PvpFailure } from "@/lib/server/duel-core";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 86_400_000;
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const FORMAT = "gen9randombattle" as const;
const RED = "redredredredredredredred";
const BLUE = "blueblueblueblueblueblue";
const ladder = () => memoryLadderStore();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  clearMemoryLadder();
  clearMemoryRecords();
  clearMemoryReplays();
  for (const f of LADDER_FORMATS) await rankedQueueStore.remove(rankedBattleQueueKey(f));
});
afterEach(() => vi.useRealTimers());

const rating = (key: string) => async () => pairingRating(await ladder().rating(key, FORMAT));

function matched(out: BattleSearchResult | PvpFailure) {
  if (!out.ok || out.status !== "matched") throw new Error(`expected a match, got ${JSON.stringify(out)}`);
  return out;
}
function waiting(out: BattleSearchResult | PvpFailure) {
  if (!out.ok || out.status !== "waiting") throw new Error(`expected to wait, got ${JSON.stringify(out)}`);
  return out;
}

/** Red and Blue matched into a ranked Random Battle: [code, red's token, blue's token]. */
async function rankedBattle() {
  const red = newTicket();
  waiting(await searchRankedBattle(FORMAT, "Red", red, RED, rating(RED)));
  const blue = matched(await searchRankedBattle(FORMAT, "Blue", newTicket(), BLUE, rating(BLUE)));
  const redSeat = matched(await searchRankedBattle(FORMAT, "Red", red, RED, rating(RED)));
  expect(redSeat.code).toBe(blue.code);
  return { code: blue.code, red: redSeat.token, blue: blue.token };
}

/** Sets a trainer's Glicko-2 rating (and Elo) by counting a made-up battle against a sparring partner. */
async function seed(key: string, to: number, code: string, elo = 1000, format: StandardFormatId = FORMAT) {
  await ladder().apply(format, {
    code,
    keys: [key, `${key}-spar`],
    names: ["x", "y"],
    expect: [NEW_BATTLE_RATING, NEW_BATTLE_RATING],
    after: [
      { ...GLICKO_START, rating: to, elo },
      { ...GLICKO_START, rating: 1200, elo: 1000 },
    ],
    scores: [1, 0],
  });
}

describe("ranked battles", () => {
  it("open as ranked, public battles showing both ratings", async () => {
    const b = await rankedBattle();
    const meta = (await loadBattle(b.code))!.rec.meta;
    expect(meta).toMatchObject({ ranked: true, public: true, kind: "pvp", status: "playing" });
    expect(meta.seats.map((s) => s.player)).toEqual([RED, BLUE]);
    const view = await pollBattle(b.code, b.red, 0);
    if (!view.ok) throw new Error(view.error);
    expect(view.view.ranked).toBe(true);
    expect(view.view.players.map((p) => p.rating)).toEqual([1500, 1500]);
    expect(view.view.players.map((p) => p.elo)).toEqual([1000, 1000]);
    expect(JSON.stringify(view.view)).not.toContain(RED);
  });

  it("count a forfeit as a loss, exactly once however often they're settled, moving Elo and Glicko-2 together", async () => {
    const b = await rankedBattle();
    const blue = readBattleToken(b.blue, b.code)!;
    await actOnBattle(b.code, blue.playerId, { action: "forfeit" }, 0);
    await Promise.all([settleBattle(b.code), settleBattle(b.code)]);
    await settleBattle(b.code);
    const meta = (await loadBattle(b.code))!.rec.meta;
    // Glicko-2 from 1500 ± 350: a win between two new trainers moves each about 160 points.
    const [won, lost] = rateGlicko([GLICKO_START, GLICKO_START], [1, 0]);
    expect(won.rating).toBeGreaterThan(1600);
    expect(lost.rating).toBe(3000 - won.rating);
    const gain = won.rating - 1500;
    // Elo from 1000: the winner's K is 90 (+45 against an equal); the loser's would be 10 (−5), but the floor holds.
    expect(meta.settled?.ratings).toEqual([
      { before: 1500, after: 1500 + gain, elo: { before: 1000, after: 1045 } },
      { before: 1500, after: 1500 - gain, elo: { before: 1000, after: 1000 } },
    ]);
    // Settling the same battle again, even straight against the store, changes nothing.
    expect(await settleRankedBattle(meta, ladder())).toEqual(meta.settled?.ratings);
    expect(await ladder().standing(RED, FORMAT)).toMatchObject({ rating: 1500 + gain, rd: won.rd, elo: 1045, games: 1, wins: 1, losses: 0, position: 1, players: 2 });
    expect((await ladder().standing(RED, FORMAT))!.gxe).toBeGreaterThan(50);
    expect(await ladder().standing(BLUE, FORMAT)).toMatchObject({ rating: 1500 - gain, elo: 1000, games: 1, wins: 0, losses: 1, position: 2 });
    expect(await ladder().rating(RED, FORMAT)).toEqual({ rating: 1500 + gain, rd: won.rd, vol: won.vol, elo: 1045, games: 1 });
    // The ladder is ordered by Elo.
    expect((await ladder().top(FORMAT, 10)).map((r) => [r.position, r.name, r.elo, r.rating])).toEqual([
      [1, "Red", 1045, 1500 + gain],
      [2, "Blue", 1000, 1500 - gain],
    ]);
    // The view shows the change, the record keeps both, and the replay was saved with the ratings the trainers brought.
    const view = await pollBattle(b.code, b.red, 0);
    if (!view.ok) throw new Error(view.error);
    expect(view.view.ratings?.[0]).toEqual({ before: 1500, after: 1500 + gain, elo: { before: 1000, after: 1045 } });
    const profile = (await battleProfile(RED))!;
    expect(profile.formats[0]).toMatchObject({ format: FORMAT, rating: 1500 + gain, elo: 1045, ratedGames: 1, position: 1 });
    expect(profile.recent[0]).toMatchObject({ code: b.code, ratingBefore: 1500, ratingAfter: 1500 + gain, eloBefore: 1000, eloAfter: 1045 });
    const replay = await memoryReplayStore().get(b.code);
    expect(replay?.ratings).toEqual([1500, 1500]);
    expect(replay?.elos).toEqual([1000, 1000]);
  });

  it("count leaving (abandoning) as a loss", async () => {
    const b = await rankedBattle();
    // Blue stops polling; Red keeps going until Blue's disconnect timer runs out.
    for (let t = 5_000; t <= BATTLE_AWAY_MS + 10_000; t += 5_000) {
      at(t);
      await pollBattle(b.code, b.red, 0);
    }
    const meta = (await loadBattle(b.code))!.rec.meta;
    expect(meta.end).toMatchObject({ reason: "left", winner: 0 });
    await settleBattle(b.code);
    expect((await ladder().standing(BLUE, FORMAT))?.losses).toBe(1);
    expect((await ladder().standing(RED, FORMAT))?.elo).toBe(1045);
  });

  it("give the two trainers of one battle different Ks, from each one's own Elo", async () => {
    await seed(RED, 1500, "seedkkkk", 1500);
    const b = await rankedBattle();
    const meta0 = (await loadBattle(b.code))!.rec.meta;
    expect(meta0.seats.map((s) => s.rating)).toEqual([
      { rating: 1500, games: 1, elo: 1500 },
      { rating: 1500, games: 0, elo: 1000 },
    ]);
    const blue = readBattleToken(b.blue, b.code)!;
    await actOnBattle(b.code, blue.playerId, { action: "forfeit" }, 0);
    await settleBattle(b.code);
    const r = (await loadBattle(b.code))!.rec.meta.settled!.ratings!;
    // Red (1500, K 40) beats Blue (1000): Red gains 40 × (1 − E), Blue's loss (K 10) stops at the floor.
    const redAfter = 1500 + 40 * (1 - eloExpected(1500, 1000));
    expect(redAfter).toBeCloseTo(1502.13, 2);
    expect(r[0].elo).toEqual({ before: 1500, after: Math.round(redAfter) });
    expect(r[1].elo).toEqual({ before: 1000, after: 1000 });
    expect((await ladder().rating(RED, FORMAT))!.elo).toBeCloseTo(redAfter, 9);
    expect((await ladder().rating(BLUE, FORMAT))!.elo).toBe(1000);
    // Glicko-2 moved too, by its own rules.
    const [won] = rateGlicko([{ ...GLICKO_START, rating: 1500 }, GLICKO_START], [1, 0]);
    expect(r[0]).toMatchObject({ before: 1500, after: won.rating });
  });

  it("score a draw ½ each: no Elo moves between equals, and Glicko-2 only grows surer", async () => {
    const b = await rankedBattle();
    const meta = (await loadBattle(b.code))!.rec.meta;
    const drawn = { ...meta, code: "drawdraw", end: { reason: "normal" as const, winner: null, at: 0 } };
    expect(await settleRankedBattle(drawn, ladder())).toEqual([
      { before: 1500, after: 1500, elo: { before: 1000, after: 1000 } },
      { before: 1500, after: 1500, elo: { before: 1000, after: 1000 } },
    ]);
    expect(await ladder().standing(RED, FORMAT)).toMatchObject({ draws: 1, wins: 0, losses: 0, games: 1, elo: 1000 });
    expect((await ladder().standing(RED, FORMAT))!.rd).toBeLessThan(350);
    // 1100 draws 1300: K is 50 below 1200 and 32 from 1200, so the lower trainer gains more than the higher loses.
    expect(eloUpdate(1100, 1300, 0.5) - 1100).toBeCloseTo(50 * (0.5 - eloExpected(1100, 1300)), 10);
    expect(1300 - eloUpdate(1300, 1100, 0.5)).toBeCloseTo(32 * (eloExpected(1300, 1100) - 0.5), 10);
  });

  it("move a settled (low-RD) rating less than a new one, and a no contest counts for nothing", async () => {
    await seed(RED, 1500, "seedaaaa");
    for (let i = 0; i < 19; i++) {
      const before = (await ladder().rating(RED, FORMAT))!;
      const spar = { ...NEW_BATTLE_RATING, rating: 1500, rd: 60 };
      const [after] = rateBattle([before, spar], [0.5, 0.5]);
      await ladder().apply(FORMAT, { code: `seed${"bcdefghjkmnpqrstuvw"[i]}aaa`, keys: [RED, `spar-${i}-xxxxxxxxxxxxxxx`], names: ["x", "y"], expect: [before, NEW_BATTLE_RATING], after: [after, { ...GLICKO_START, elo: 1000 }], scores: [0.5, 0.5] });
    }
    const settled = (await ladder().rating(RED, FORMAT))!;
    expect(settled.games).toBe(20);
    expect(settled.rd).toBeLessThan(120);
    const b = await rankedBattle();
    const blue = readBattleToken(b.blue, b.code)!;
    await actOnBattle(b.code, blue.playerId, { action: "forfeit" }, 0);
    await settleBattle(b.code);
    const r = (await loadBattle(b.code))!.rec.meta.settled!.ratings!;
    expect(r[0].after - r[0].before).toBeGreaterThan(0);
    expect(r[0].after - r[0].before).toBeLessThan(r[1].before - r[1].after);
    expect(ladderReason({ reason: "nocontest", winner: null })).toBeNull();
    expect(await settleRankedBattle({ ...(await loadBattle(b.code))!.rec.meta, code: "nnnnnnnn", end: { reason: "nocontest", winner: null, at: 0 } }, ladder())).toBeNull();
  });

  it("a stale write is recomputed from the current ratings", async () => {
    const b = await rankedBattle();
    const blue = readBattleToken(b.blue, b.code)!;
    await actOnBattle(b.code, blue.playerId, { action: "forfeit" }, 0);
    // Red's Elo moves on under the settle's feet (another battle counted first).
    const stale = await ladder().apply(FORMAT, {
      code: b.code,
      keys: [RED, BLUE],
      names: ["Red", "Blue"],
      expect: [{ ...NEW_BATTLE_RATING, elo: 1200 }, NEW_BATTLE_RATING],
      after: rateBattle([{ ...NEW_BATTLE_RATING, elo: 1200 }, NEW_BATTLE_RATING], [1, 0]),
      scores: [1, 0],
    });
    expect(stale).toMatchObject({ status: "stale", current: [NEW_BATTLE_RATING, NEW_BATTLE_RATING] });
    await settleBattle(b.code);
    expect((await loadBattle(b.code))!.rec.meta.settled?.ratings?.[0].elo).toEqual({ before: 1000, after: 1045 });
  });
});

describe("Elo decay", () => {
  it("catches a row up on every finished UTC day since it last did, from the games it played that day", () => {
    const day = utcDay(T0);
    // One game on `day`; read the next day: 1–5 games lose a point per 100 above 1500.
    expect(catchUpElo({ elo: 1800, day, gamesToday: 1, decayedAt: day - 1 }, true, T0 + DAY)).toEqual({ elo: 1797, decayedAt: day });
    // Read later the same day (18:00 UTC): today isn't over, nothing yet.
    expect(catchUpElo({ elo: 1800, day, gamesToday: 1, decayedAt: day - 1 }, true, T0 + DAY / 4)).toEqual({ elo: 1800, decayedAt: day - 1 });
    // Four days on: the game day, then three quiet days (a point per 50 above 1400 each).
    expect(catchUpElo({ elo: 1800, day, gamesToday: 1, decayedAt: day - 1 }, true, T0 + 4 * DAY)).toEqual({ elo: 1776, decayedAt: day + 3 });
    // Six games that day: nothing that day, then the quiet days.
    expect(catchUpElo({ elo: 1800, day, gamesToday: 6, decayedAt: day - 1 }, true, T0 + 2 * DAY)).toEqual({ elo: 1792, decayedAt: day + 1 });
    // A less popular format: two points less each day.
    expect(catchUpElo({ elo: 1800, day, gamesToday: 1, decayedAt: day - 1 }, false, T0 + 2 * DAY)).toEqual({ elo: 1794, decayedAt: day + 1 });
    // The game day already caught up on (it's before `decayedAt`): only quiet days count.
    expect(catchUpElo({ elo: 1800, day, gamesToday: 1, decayedAt: day }, true, T0 + 2 * DAY)).toEqual({ elo: 1792, decayedAt: day + 1 });
    // Never played: nothing to decay from.
    expect(catchUpElo({ elo: 1800, day: null, gamesToday: 0, decayedAt: day - 1 }, true, T0 + 2 * DAY)).toEqual({ elo: 1785, decayedAt: day + 1 });
    // At or under 1400, never.
    expect(catchUpElo({ elo: 1400, day, gamesToday: 0, decayedAt: day - 1 }, true, T0 + 400 * DAY)).toEqual({ elo: 1400, decayedAt: day + 399 });
  });

  it("knows the popular formats", () => {
    expect(isPopularLadderFormat("gen9ou")).toBe(true);
    expect(isPopularLadderFormat("gen9randombattle")).toBe(true);
    expect(isPopularLadderFormat("gen9uu")).toBe(false);
    expect(isPopularLadderFormat("gen9randomdoublesbattle")).toBe(false);
  });

  it("applies lazily when a row is read, listed or settled, and only once per day", async () => {
    await seed(RED, 1700, "seeddddd", 1800);
    expect((await ladder().standing(RED, FORMAT))!.elo).toBe(1800);
    at(DAY);
    // The seed battle counted as one game yesterday: a point per 100 above 1500.
    expect((await ladder().rating(RED, FORMAT))!.elo).toBe(1797);
    expect((await ladder().rating(RED, FORMAT))!.elo).toBe(1797);
    expect((await ladder().standing(RED, FORMAT))!.elo).toBe(1797);
    at(4 * DAY);
    // Three quiet days: a point per 50 above 1400 each (7, 7, 7).
    expect((await ladder().top(FORMAT, 10))[0]).toMatchObject({ name: "x", elo: 1776 });
    expect((await ladder().standings(RED)).map((s) => [s.format, s.standing.elo])).toEqual([[FORMAT, 1776]]);
    // The sparring partner stayed at 1000: nothing to decay.
    expect((await ladder().rating(`${RED}-spar`, FORMAT))!.elo).toBe(1000);
  });

  it("decays before a battle counts, and a day's games stop that day's decay", async () => {
    // Glicko-2 stays at 1500 (the matchmaking window pairs by it); the Elo is 1800.
    await seed(RED, 1500, "seedeeee", 1800);
    at(DAY + 1000);
    // Settling the next day: Red's Elo has decayed to 1797 before the battle, and the battle moves it from there.
    const b = await rankedBattle();
    const blue = readBattleToken(b.blue, b.code)!;
    await actOnBattle(b.code, blue.playerId, { action: "forfeit" }, 0);
    await settleBattle(b.code);
    const r = (await loadBattle(b.code))!.rec.meta.settled!.ratings!;
    const after = eloUpdate(1797, 1000, 1);
    expect(r[0].elo).toEqual({ before: 1797, after: Math.round(after) });
    expect((await ladder().rating(RED, FORMAT))!.elo).toBeCloseTo(after, 9);
    // Five more wins the same day make six: no decay for that day; the day after is quiet.
    let elo = after;
    for (let i = 0; i < 5; i++) {
      const before = (await ladder().rating(RED, FORMAT))!;
      const [me] = rateBattle([before, NEW_BATTLE_RATING], [1, 0]);
      await ladder().apply(FORMAT, { code: `more${"abcde"[i]}aaa`, keys: [RED, `spar-${i}-xxxxxxxxxxxxxxx`], names: ["x", "y"], expect: [before, NEW_BATTLE_RATING], after: [me, { ...GLICKO_START, elo: 1000 }], scores: [1, 0] });
      elo = me.elo;
    }
    at(2 * DAY + 1000);
    expect((await ladder().rating(RED, FORMAT))!.elo).toBeCloseTo(elo, 9);
    at(3 * DAY + 1000);
    expect((await ladder().rating(RED, FORMAT))!.elo).toBeCloseTo(elo - Math.floor((elo - 1400) / 50), 9);
  });

  it("decays two points less a day in a less popular format", async () => {
    await seed(RED, 1700, "seedffff", 1800, "gen9uu");
    at(DAY);
    expect((await ladder().rating(RED, "gen9uu"))!.elo).toBe(1799);
    at(2 * DAY);
    expect((await ladder().rating(RED, "gen9uu"))!.elo).toBe(1799 - (Math.floor((1799 - 1400) / 50) - 2));
  });

  it("starts an unknown trainer at 1000 Elo and 1500 Glicko-2, paired by Glicko-2", async () => {
    expect(await ladder().rating(RED, FORMAT)).toBeNull();
    expect(await ladder().standing(RED, FORMAT)).toBeNull();
    expect(pairingRating(null)).toEqual({ rating: 1500, games: 0, elo: 1000 });
    expect(pairingRating({ ...NEW_BATTLE_RATING, rating: 1623.4, elo: 1234.6, games: 3 })).toEqual({ rating: 1623, games: 3, elo: 1235 });
  });
});

describe("ranked matchmaking", () => {
  it("pairs close ratings at once, and a wide gap only after the window widens", async () => {
    await seed(RED, 1900, "seedmmmm", 1300);
    const red = newTicket();
    const blue = newTicket();
    waiting(await searchRankedBattle(FORMAT, "Red", red, RED, rating(RED)));
    at(1_000);
    // 400 apart: too far for now (the window starts at 100 and widens 15 a second).
    waiting(await searchRankedBattle(FORMAT, "Blue", blue, BLUE, rating(BLUE)));
    at(7_000);
    waiting(await searchRankedBattle(FORMAT, "Red", red, RED, rating(RED)));
    at(14_000);
    waiting(await searchRankedBattle(FORMAT, "Blue", blue, BLUE, rating(BLUE)));
    at(20_000);
    const paired = matched(await searchRankedBattle(FORMAT, "Red", red, RED, rating(RED)));
    const other = matched(await searchRankedBattle(FORMAT, "Blue", blue, BLUE, rating(BLUE)));
    expect(other.code).toBe(paired.code);
    const meta = (await loadBattle(paired.code))!.rec.meta;
    expect(meta.seats.map((s) => s.rating?.rating).sort()).toEqual([1500, 1900]);
    // Each seat brings its Elo too, for the battle to show.
    expect(meta.seats.map((s) => s.rating?.elo).sort()).toEqual([1000, 1300]);
  });

  it("never pairs a trainer with themselves (two tabs)", async () => {
    waiting(await searchRankedBattle(FORMAT, "Red", newTicket(), RED, rating(RED)));
    waiting(await searchRankedBattle(FORMAT, "Red", newTicket(), RED, rating(RED)));
  });

  it("checks a brought team before queueing", async () => {
    const out = await searchRankedBattle("gen9ou", "Red", newTicket(), RED, rating(RED), "Pikachu @ Light Ball\n- Volt Tackle\n- Not A Move");
    expect(out.ok).toBe(false);
  });
});
