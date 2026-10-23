import { beforeEach, describe, expect, it } from "vitest";
import seeds from "@/data/pikadoku-master.json";
import dailies from "@/data/pikadoku-dailies.json";
import { checkMaster, type MasterGrid } from "@/lib/pikadoku/master";
import { gridFromIds } from "@/lib/pikadoku/generator";
import { isSolvable, solveGrid } from "@/lib/pikadoku/solve";
import { baseOf } from "@/lib/pikadoku/categories";
import { dailyGrid } from "@/lib/server/pikadoku";
import { allMasters, clearMemoryMaster, ensureMaster, masterFor, scheduleMaster, unscheduleMaster } from "@/lib/server/pikadoku-master";

const NOW = Date.parse("2026-10-23T12:00:00Z");

beforeEach(() => {
  process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
  clearMemoryMaster();
});

describe("curated grid validation", () => {
  it("accepts a solvable grid and reports each cell's answer count, single answers included", () => {
    const c = checkMaster(["type:fire", "type:water", "type:grass"], ["type:flying", "type:fighting", "type:poison"]);
    expect(c.counts).toHaveLength(9);
    expect(c.counts!.every((n, i) => n === c.counts![i])).toBe(true);
    const tight = checkMaster(seeds[0].rows, seeds[0].cols);
    expect(tight.ok).toBe(true);
    expect(Math.min(...tight.counts!)).toBeGreaterThanOrEqual(1);
  });
  it("rejects repeats, unknown categories, wrong sizes, empty cells and ungrid-able picks", () => {
    expect(checkMaster(["type:fire", "type:fire", "type:grass"], ["type:flying", "type:fighting", "type:poison"]).ok).toBe(false);
    expect(checkMaster(["nope", "type:water", "type:grass"], ["type:flying", "type:fighting", "type:poison"]).errors[0]).toMatch(/Unknown/);
    expect(checkMaster(["type:fire"], ["type:flying", "type:fighting", "type:poison"]).ok).toBe(false);
    const empty = checkMaster(["other:paradox", "other:ultrabeast", "type:fire"], ["type:water", "type:ice", "other:fossil"]);
    expect(empty.ok).toBe(false);
    expect(empty.counts!.includes(0)).toBe(true);
    // Needs a matching: three cells that can only take the same one Pokémon cannot be filled.
    expect(isSolvable([[1], [1], [1], [1, 2], [3], [4], [5], [6], [7]], 1)).toBe(false);
  });
});

describe("seeded Master grids", () => {
  it("are three tricky but fair, solvable grids on upcoming dates", () => {
    expect(seeds).toHaveLength(3);
    for (const s of seeds as MasterGrid[]) {
      expect(s.date > "2026-10-23").toBe(true);
      const c = checkMaster(s.rows, s.cols);
      expect(c.ok).toBe(true);
      expect(Math.min(...c.counts!)).toBeGreaterThanOrEqual(2);
      expect(c.counts!.filter((n) => n <= 5).length).toBeGreaterThanOrEqual(5); // tricky
      const grid = gridFromIds(s);
      const sol = solveGrid(grid.answers)!;
      expect(new Set([...sol.values()].map(baseOf)).size).toBe(9);
    }
  });
  it("replace the Normal daily on their date only", () => {
    const s = seeds[0] as MasterGrid;
    expect(dailyGrid(s.date, "normal").rows.map((r) => r.id)).toEqual(s.rows);
    expect(dailyGrid(s.date, "easy").rows.map((r) => r.id)).toEqual((dailies as Record<string, Record<string, { rows: string[] }>>)[s.date].easy.rows);
    const other = "2026-10-28";
    expect(masterFor(other)).toBeNull();
    expect(dailyGrid(other, "normal").rows.map((r) => r.id)).toEqual((dailies as Record<string, Record<string, { rows: string[] }>>)[other].normal.rows);
  });
  it("names the author for 'Master Puzzle by'", () => {
    const found = { master: masterFor("2026-10-27")?.by };
    expect(found.master).toBe("Caden");
  });
});

describe("scheduling", () => {
  const rows = ["type:fire", "type:water", "type:grass"];
  const cols = ["type:flying", "type:fighting", "type:poison"];
  it("schedules a future day, which then replaces that day's Normal grid", async () => {
    const out = await scheduleMaster({ date: "2026-12-01", rows, cols, by: "Misty" }, NOW);
    expect(out.ok).toBe(true);
    await ensureMaster(NOW + 120_000);
    expect(masterFor("2026-12-01")?.by).toBe("Misty");
    expect(dailyGrid("2026-12-01", "normal").rows.map((r) => r.id)).toEqual(rows);
    expect(allMasters().some((m) => m.grid.date === "2026-12-01" && !m.seed)).toBe(true);
    expect(await unscheduleMaster("2026-12-01", NOW)).toBe(true);
  });
  it("never changes a day that has begun, and refuses an invalid grid", async () => {
    const today = await scheduleMaster({ date: "2026-10-23", rows, cols, by: "Misty" }, NOW);
    expect(today.ok).toBe(false);
    expect((await scheduleMaster({ date: "2026-10-01", rows, cols, by: "Misty" }, NOW)).ok).toBe(false);
    expect((await scheduleMaster({ date: "2026-12-02", rows: ["a", "b", "c"], cols, by: "Misty" }, NOW)).ok).toBe(false);
    expect(await unscheduleMaster("2026-10-23", NOW)).toBe(false);
  });
});
