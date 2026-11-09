import { beforeEach, describe, expect, it } from "vitest";
import { BOARD_SLOTS_PER_ADDRESS, CONN_MIN_MS, claimBoardSlot, plausibleMs } from "@/lib/server/board-guard";
import { clearMemoryConnBoard, memoryConnBoard, startToken } from "@/lib/server/connections-board";
import { clearMemoryConnResults, memoryConnStore, recordConnResult } from "@/lib/server/connections-results";
import { dailyConnPuzzle } from "@/lib/server/connections";
import { solveGrid } from "@/lib/pikadoku/solve";
import { dailyGrid, parseSettings } from "@/lib/server/pikadoku";
import { clearMemoryPdk, memoryPdkStore, pdkStartToken } from "@/lib/server/pikadoku-board";
import { finishGame } from "@/lib/server/pikadoku-result";

let n = 0;
/** A fresh address per test: slots are single-use claims that outlive a test. */
const freshIp = () => `203.0.113.${++n}-${Date.now()}`;

describe("board slots per address", () => {
  it("gives an address a few new entries per board and period, then refuses", async () => {
    const ip = freshIp();
    for (let i = 0; i < BOARD_SLOTS_PER_ADDRESS; i++) expect(await claimBoardSlot(ip, "t", "2026-11-09")).toBe(true);
    expect(await claimBoardSlot(ip, "t", "2026-11-09")).toBe(false);
    // Another address, board or day is untouched.
    expect(await claimBoardSlot(freshIp(), "t", "2026-11-09")).toBe(true);
    expect(await claimBoardSlot(ip, "t2", "2026-11-09")).toBe(true);
    expect(await claimBoardSlot(ip, "t", "2026-11-10")).toBe(true);
  });

  it("only counts believable times", () => {
    expect(plausibleMs(null, 1000)).toBe(false);
    expect(plausibleMs(999, 1000)).toBe(false);
    expect(plausibleMs(1000, 1000)).toBe(true);
  });
});

describe("PokéConnections daily board", () => {
  const DATE = "2026-10-25";
  const T = Date.parse(`${DATE}T12:00:00Z`);
  const solve = () => dailyConnPuzzle(DATE).groups.map((g) => g.members);
  const finish = (who: string, ms: number, ip: string) =>
    recordConnResult({ date: DATE, identity: `d:${who}`, guesses: solve(), start: startToken(DATE, T - ms), name: who, ip }, memoryConnStore(), T, memoryConnBoard());

  beforeEach(() => {
    clearMemoryConnBoard();
    clearMemoryConnResults();
  });

  it("ranks an honest solve and refuses one faster than anyone can play", async () => {
    const ip = freshIp();
    const honest = await finish("honest", 45_000, ip);
    expect(honest.ok && honest.board).toMatchObject({ position: 1 });
    const scripted = await finish("scripted", CONN_MIN_MS - 1, ip);
    expect(scripted.ok && scripted.board).toEqual({ unranked: "untimed" });
    expect((await memoryConnBoard().top(DATE, 10))?.map((r) => r.name)).toEqual(["honest"]);
  });

  it("won't let one address fill the board under new names", async () => {
    const ip = freshIp();
    for (let i = 0; i < BOARD_SLOTS_PER_ADDRESS; i++) expect((await finish(`alt${i}`, 30_000, ip)).ok).toBe(true);
    const extra = await finish("alt-extra", 30_000, ip);
    expect(extra.ok && extra.board).toEqual({ unranked: "limited" });
    // A reload by someone already on the board still shows their place.
    const reload = await finish("alt0", 30_000, ip);
    expect(reload.ok && reload.board).toMatchObject({ position: expect.any(Number) });
    // Another household is unaffected.
    const neighbour = await finish("neighbour", 30_000, freshIp());
    expect(neighbour.ok && neighbour.board).toMatchObject({ position: expect.any(Number) });
  });
});

describe("Pikadoku daily board", () => {
  const date = new Date().toISOString().slice(0, 10);
  beforeEach(() => clearMemoryPdk());

  const play = async (who: string, ms: number, ip: string) => {
    const g = dailyGrid(date, "normal");
    const guesses = [...solveGrid(g.answers)!].map(([cell, id]) => ({ cell, id }));
    const store = memoryPdkStore();
    const out = await finishGame(
      { date, difficulty: "normal", settings: parseSettings({}), guesses, identity: `d:${who}`, name: who, start: pdkStartToken(`${date}:normal`, Date.now() - ms), ip },
      store
    );
    return { out, board: (await store.board(date, "normal")) ?? [] };
  };

  it("ranks an honest grid and leaves an instant one off the board", async () => {
    const ip = freshIp();
    const fast = await play("scripted", 200, ip);
    expect(fast.out.ok).toBe(true);
    expect(fast.board.map((r) => r.name)).toEqual([]);
    const honest = await play("honest", 90_000, ip);
    expect(honest.board.map((r) => r.name)).toEqual(["honest"]);
  });

  it("caps new entries from one address", async () => {
    const ip = freshIp();
    for (let i = 0; i <= BOARD_SLOTS_PER_ADDRESS; i++) await play(`alt${i}`, 60_000, ip);
    const { board } = await play("other-house", 60_000, freshIp());
    expect(board.length).toBe(BOARD_SLOTS_PER_ADDRESS + 1);
    expect(board.some((r) => r.name === `alt${BOARD_SLOTS_PER_ADDRESS}`)).toBe(false);
  });
});
