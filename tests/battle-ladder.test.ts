import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rankedBattleQueueKey, searchRankedBattle, type BattleSearchResult } from "@/lib/server/battle-engine/matchmaking";
import { rankedQueueStore } from "@/lib/server/duel-store";
import { newTicket } from "@/lib/server/match-queue";
import { actOnBattle, pollBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { settleBattle } from "@/lib/server/battle-engine/settle";
import { NEW_BATTLE_RATING, clearMemoryLadder, memoryLadderStore, pairingRating, settleRankedBattle } from "@/lib/server/battle-engine/ladder";
import { clearMemoryReplays, memoryReplayStore } from "@/lib/server/battle-engine/replays";
import { LADDER_FORMATS, ladderReason } from "@/lib/battle/ladder";
import { BATTLE_AWAY_MS } from "@/lib/battle/play";
import { GLICKO_START, rateGlicko } from "@/lib/battle/glicko";
import type { PvpFailure } from "@/lib/server/duel-core";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const FORMAT = "gen9randombattle" as const;
const RED = "redredredredredredredred";
const BLUE = "blueblueblueblueblueblue";
const ladder = () => memoryLadderStore();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  clearMemoryLadder();
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

/** Sets a trainer's rating by counting a made-up battle against a sparring partner. */
async function seed(key: string, to: number, code: string) {
  await ladder().apply(FORMAT, { code, keys: [key, `${key}-spar`], names: ["x", "y"], expect: [NEW_BATTLE_RATING, NEW_BATTLE_RATING], after: [{ ...GLICKO_START, rating: to }, { ...GLICKO_START, rating: 1200 }], scores: [1, 0] });
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
    expect(JSON.stringify(view.view)).not.toContain(RED);
  });

  it("count a forfeit as a loss, exactly once however often they're settled", async () => {
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
    expect(meta.settled?.ratings).toEqual([
      { before: 1500, after: 1500 + gain },
      { before: 1500, after: 1500 - gain },
    ]);
    // Settling the same battle again, even straight against the store, changes nothing.
    expect(await settleRankedBattle(meta, ladder())).toEqual(meta.settled?.ratings);
    expect(await ladder().standing(RED, FORMAT)).toMatchObject({ rating: 1500 + gain, rd: won.rd, games: 1, wins: 1, losses: 0, position: 1, players: 2 });
    expect((await ladder().standing(RED, FORMAT))!.gxe).toBeGreaterThan(50);
    expect(await ladder().standing(BLUE, FORMAT)).toMatchObject({ rating: 1500 - gain, games: 1, wins: 0, losses: 1 });
    // The view shows the change, and the replay was saved with the ratings the trainers brought.
    const view = await pollBattle(b.code, b.red, 0);
    if (!view.ok) throw new Error(view.error);
    expect(view.view.ratings?.[0].after).toBe(1500 + gain);
    expect((await memoryReplayStore().get(b.code))?.ratings).toEqual([1500, 1500]);
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
  });

  it("move a settled (low-RD) rating less than a new one, and a no contest counts for nothing", async () => {
    await seed(RED, 1500, "seedaaaa");
    for (let i = 0; i < 19; i++) {
      const before = (await ladder().rating(RED, FORMAT))!;
      const spar = { ...NEW_BATTLE_RATING, rating: 1500, rd: 60 };
      const [after] = rateGlicko([before, spar], [0.5, 0.5]);
      await ladder().apply(FORMAT, { code: `seed${"bcdefghjkmnpqrstuvw"[i]}aaa`, keys: [RED, `spar-${i}-xxxxxxxxxxxxxxx`], names: ["x", "y"], expect: [before, NEW_BATTLE_RATING], after: [after, GLICKO_START], scores: [0.5, 0.5] });
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
});

describe("ranked matchmaking", () => {
  it("pairs close ratings at once, and a wide gap only after the window widens", async () => {
    await seed(RED, 1900, "seedmmmm");
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
