import { beforeEach, describe, expect, it } from "vitest";
import { archiveDates, archiveKey } from "@/lib/pikadoku/archive";
import { solveGrid } from "@/lib/pikadoku/solve";
import { getProgress, pdkBlock, savePdk, savePdkArchive } from "@/lib/progress";
import { dailyGrid } from "@/lib/server/pikadoku";
import { clearMemoryPdk, memoryPdkStore } from "@/lib/server/pikadoku-board";
import { finishGame } from "@/lib/server/pikadoku-result";
import { DEFAULT_PDK_SETTINGS } from "@/lib/pikadoku/types";

const DAY = "2026-10-22";
const NOW = Date.parse("2026-10-22T12:00:00Z");

describe("archive list", () => {
  it("lists every past daily, newest first, from yesterday back to launch", () => {
    expect(archiveDates("2026-10-22")).toEqual([]);
    expect(archiveDates("2026-10-25")).toEqual(["2026-10-24", "2026-10-23", "2026-10-22"]);
    expect(archiveKey("2026-10-22", "expert")).toBe("2026-10-22:expert");
  });
});

describe("archive games never touch the streak", () => {
  const record = { guesses: [], won: true, over: true, solved: 9, score: 120 };
  it("leaves the streak, last day and daily results alone, but counts the game", () => {
    const before = pdkBlock(getProgress());
    const played = getProgress().pdkPlay?.games ?? 0;
    savePdkArchive(record);
    const after = pdkBlock(getProgress());
    expect(after.streak).toBe(before.streak);
    expect(after.last).toBe(before.last);
    expect(after.results).toEqual(before.results);
    expect(getProgress().pdkPlay?.games).toBe(played + 1);
    // An unfinished archive game counts for nothing.
    savePdkArchive({ ...record, over: false });
    expect(getProgress().pdkPlay?.games).toBe(played + 1);
    // A real daily does move the streak.
    savePdk("2026-10-22", record);
    expect(pdkBlock(getProgress()).streak).toBe(before.streak + 1);
  });
});

describe("archive games on the server", () => {
  beforeEach(() => clearMemoryPdk());
  const winning = () => [...solveGrid(dailyGrid(DAY, "easy").answers)!].map(([cell, id]) => ({ cell, id }));
  const input = { date: DAY, difficulty: "easy" as const, settings: DEFAULT_PDK_SETTINGS, guesses: winning(), identity: "d:aaaaaaaaaaaaaaaaaaaa", name: "Ash", start: undefined };

  it("is not recorded for the board or the day's rarity, even on a day that is current", async () => {
    const store = memoryPdkStore();
    const archived = await finishGame({ ...input, archive: true }, store, NOW);
    expect(archived.ok && archived.result.counted).toBe(false);
    expect(await store.board(DAY, "easy")).toEqual([]);
    expect((await store.counts(DAY, "easy"))!.totals.every((t) => t === 0)).toBe(true);
  });
  it("is recorded when played as the daily", async () => {
    const store = memoryPdkStore();
    const daily = await finishGame(input, store, NOW);
    expect(daily.ok && daily.result.counted).toBe(true);
    expect((await store.counts(DAY, "easy"))!.totals.some((t) => t > 0)).toBe(true);
  });
});
