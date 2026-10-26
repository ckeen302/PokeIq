import { describe, expect, it, vi } from "vitest";
import { cachedCounts, supabasePdkStore, tally, type PdkStore } from "@/lib/server/pikadoku-board";

type Sb = Parameters<typeof supabasePdkStore>[0];

/** A stand-in for the Supabase client: the counting function's answer, and the raw rows for the fallback. */
function fakeSb(rpc: { data: unknown; error: { code: string; message: string } | null }, rows: { cell: number; pokemon_id: number }[]) {
  const query = { select: () => query, eq: () => query, limit: async () => ({ data: rows, error: null }) };
  return { rpc: vi.fn(async () => rpc), from: vi.fn(() => query) } as unknown as Sb & { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };
}

describe("Pikadoku pick counts", () => {
  it("tallies raw rows and pre-added rows the same way", () => {
    const a = tally([{ cell: 0, id: 6 }, { cell: 0, id: 6 }, { cell: 0, id: 25 }, { cell: 4, id: 1 }]);
    const b = tally([{ cell: 0, id: 6, n: 2 }, { cell: 0, id: 25, n: 1 }, { cell: 4, id: 1, n: 1 }]);
    expect(b).toEqual(a);
    expect(a.totals[0]).toBe(3);
    expect(a.picks[0].get(6)).toBe(2);
    expect(tally([{ cell: 9, id: 1 }, { cell: -1, id: 1 }]).totals.every((t) => t === 0)).toBe(true);
  });
  it("reads the database's sums (migration 0038), with no row limit to cut a busy day short", async () => {
    const sb = fakeSb({ data: [{ cell: 0, pokemon_id: 6, n: "120000" }, { cell: 0, pokemon_id: 25, n: 3 }], error: null }, []);
    const c = await supabasePdkStore(sb).counts("2026-10-26", "normal");
    expect(c!.totals[0]).toBe(120003);
    expect(c!.picks[0].get(6)).toBe(120000);
    expect(sb.from).not.toHaveBeenCalled();
  });
  it("falls back to the rows until the function exists", async () => {
    const sb = fakeSb({ data: null, error: { code: "PGRST202", message: "no function" } }, [{ cell: 2, pokemon_id: 9 }]);
    const c = await supabasePdkStore(sb).counts("2026-10-26", "normal");
    expect(c!.totals[2]).toBe(1);
    expect(sb.from).toHaveBeenCalled();
  });
  it("shares live counts for a few seconds, per day and difficulty", async () => {
    const counts = vi.fn(async () => tally([{ cell: 0, id: 1 }]));
    const store = { counts } as unknown as PdkStore;
    const t = 1_000_000;
    await cachedCounts(store, "2026-10-26", "normal", t);
    await cachedCounts(store, "2026-10-26", "normal", t + 5_000);
    expect(counts).toHaveBeenCalledTimes(1);
    await cachedCounts(store, "2026-10-26", "expert", t + 5_000);
    await cachedCounts(store, "2026-10-26", "normal", t + 20_000);
    expect(counts).toHaveBeenCalledTimes(3);
  });
});
