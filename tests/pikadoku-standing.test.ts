import { afterEach, describe, expect, it } from "vitest";
import { betterResult } from "@/lib/pikadoku/score";
import { clearMemoryPdk, memoryPdkStore, supabasePdkStore } from "@/lib/server/pikadoku-board";

const DAY = "2026-11-12";
const e = (player: string, solved: number, score: number, ms: number) => ({ player, name: player, solved, score, ms });

afterEach(() => clearMemoryPdk());

describe("Pikadoku standing without reading the whole board", () => {
  it("matches the position in the sorted board, stored or not", async () => {
    const store = memoryPdkStore();
    const board = [e("a", 9, 120, 90_000), e("b", 9, 120, 60_000), e("c", 8, 50, 30_000), e("d", 9, 300, 10_000)];
    for (const x of board) await store.saveBoard(DAY, "normal", x);
    const sorted = [...board].sort(betterResult).map((x) => x.player);
    for (const x of board) expect(await store.standing(DAY, "normal", x, true)).toEqual({ position: sorted.indexOf(x.player) + 1, total: 4 });
    expect(await store.entry(DAY, "normal", "c")).toMatchObject({ solved: 8 });
    expect(await store.entry(DAY, "normal", "z")).toBeNull();
    // Not on the board (no name): ranked among the others, counted in the total.
    expect(await store.standing(DAY, "normal", e("z", 9, 200, 1000), false)).toEqual({ position: 3, total: 5 });
  });

  it("counts in the database with betterResult's order", async () => {
    const calls: string[][] = [];
    const chain = (log: string[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or"]) q[m] = (...args: unknown[]) => (log.push(`${m}:${JSON.stringify(args)}`), q);
      q.then = (ok: (v: unknown) => void) => ok({ count: log.some((l) => l.startsWith("or:")) ? 7 : 40, error: null });
      return q;
    };
    const sb = { from: () => chain(calls[calls.push([]) - 1]) } as never;
    const out = await supabasePdkStore(sb).standing(DAY, "normal", e("p", 8, 123.45, 61_000), false);
    expect(out).toEqual({ position: 8, total: 41 });
    const filter = calls.flat().find((l) => l.startsWith("or:"));
    expect(filter).toContain("solved.gt.8,and(solved.eq.8,score.lt.123.5),and(solved.eq.8,score.eq.123.5,duration_ms.lt.61000)");
    expect(calls.flat().filter((l) => l.startsWith("select:")).every((l) => l.includes('"head":true'))).toBe(true);
  });
});
