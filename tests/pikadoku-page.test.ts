import { describe, expect, it } from "vitest";
import { dailyGrid, gridView, publicDailies } from "@/lib/server/pikadoku";
import { archiveMonths, monthGrid } from "@/lib/pikadoku/archive";

describe("Pikadoku's page-baked grids", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const pub = publicDailies(now);

  it("covers yesterday, today and tomorrow (UTC) at every difficulty", () => {
    expect(pub.serverDate).toBe("2026-10-29");
    expect(Object.keys(pub.days).sort()).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
    for (const day of Object.values(pub.days)) expect(Object.keys(day).sort()).toEqual(["easy", "expert", "normal"]);
  });

  it("matches the API's grid and carries categories only, never answers", () => {
    expect(pub.days["2026-10-29"].normal.grid).toEqual(gridView(dailyGrid("2026-10-29", "normal")));
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/answers|members/);
    for (const day of Object.values(pub.days))
      for (const { grid } of Object.values(day)) for (const c of [...grid.rows, ...grid.cols]) expect(Object.keys(c).sort()).toEqual(["family", "id", "label"]);
  });
});

describe("Pikadoku's archive calendar", () => {
  it("lists the months from launch to today", () => {
    expect(archiveMonths("2026-10-29")).toEqual(["2026-10"]);
    expect(archiveMonths("2027-01-03")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
  });

  it("lays a month out in whole Monday-first weeks", () => {
    const cells = monthGrid("2026-10");
    expect(cells.length % 7).toBe(0);
    // 1 October 2026 is a Thursday.
    expect(cells.indexOf("2026-10-01")).toBe(3);
    expect(cells.filter(Boolean)).toHaveLength(31);
    expect(monthGrid("2027-02").filter(Boolean)).toHaveLength(28);
  });
});
