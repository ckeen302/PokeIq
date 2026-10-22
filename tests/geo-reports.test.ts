import { afterEach, describe, expect, it } from "vitest";
import { GEO_HIDE_THRESHOLD, distinctReporters, groupShotReports, hiddenShotIds, type GeoShotReport } from "@/lib/geo-reports";
import { clearMemoryShotReports, memoryShotReportStore, reportShot, reviewShot, shotReviewQueue, syncHiddenShots } from "@/lib/server/geo-reports";
import { answerFor, geoRegions, hiddenShots, planRounds, setHiddenShots } from "@/lib/server/geo";
import type { GeoSpec } from "@/lib/geo-types";

const row = (shot: string, reporter: string, ipHash: string | null, status: GeoShotReport["status"] = "open") => ({ shot, reporter, ipHash, status });

afterEach(() => {
  clearMemoryShotReports();
  setHiddenShots([]);
});

describe("PokéGuessr screenshot reports", () => {
  it("hides a shot once three distinct reporters flag it", () => {
    expect(GEO_HIDE_THRESHOLD).toBe(3);
    const two = [row("a", "d:1", "n1"), row("a", "d:2", "n2")];
    expect(hiddenShotIds(two).has("a")).toBe(false);
    expect(hiddenShotIds([...two, row("a", "u:3", "n3")]).has("a")).toBe(true);
  });

  it("counts one reporter once, and one network once", () => {
    expect(distinctReporters([row("a", "d:1", "n1"), row("a", "d:1", "n1"), row("a", "d:1", "n2")])).toBe(1);
    // Three devices behind one address: one person clearing cookies can't take a shot down.
    expect(distinctReporters([row("a", "d:1", "n1"), row("a", "d:2", "n1"), row("a", "d:3", "n1")])).toBe(1);
    expect(hiddenShotIds([row("a", "d:1", "n1"), row("a", "d:2", "n1"), row("a", "d:3", "n1")]).size).toBe(0);
  });

  it("ignores reports a moderator cleared, and keeps a removed shot out", () => {
    const kept = [row("a", "d:1", "n1", "kept"), row("a", "d:2", "n2", "kept"), row("a", "d:3", "n3", "kept")];
    expect(hiddenShotIds(kept).size).toBe(0);
    expect(hiddenShotIds([row("b", "d:1", "n1", "removed")]).has("b")).toBe(true);
  });

  it("groups the review queue by shot, most-reported first", () => {
    const reports: GeoShotReport[] = [
      { id: 1, shot: "aaaaaaaaaaaa", reason: "wrong-place", note: "It's Route 2", mode: "solo", reporter: "d:1", ipHash: "n1", status: "open", at: 1, reviewedAt: null, reviewedBy: null },
      { id: 2, shot: "bbbbbbbbbbbb", reason: "gives-away", note: null, mode: "daily", reporter: "d:1", ipHash: "n1", status: "open", at: 2, reviewedAt: null, reviewedBy: null },
      { id: 3, shot: "bbbbbbbbbbbb", reason: "gives-away", note: null, mode: "duel", reporter: "d:2", ipHash: "n2", status: "open", at: 3, reviewedAt: null, reviewedBy: null },
    ];
    const queue = groupShotReports(reports);
    expect(queue.map((q) => q.shot)).toEqual(["bbbbbbbbbbbb", "aaaaaaaaaaaa"]);
    expect(queue[0]).toMatchObject({ reporters: 2, reasons: { "gives-away": 2 }, hidden: false, status: "open" });
    expect(queue[1].notes).toEqual(["It's Route 2"]);
  });

  it("takes the shot out of rotation on the third report, until a moderator keeps it", async () => {
    const store = memoryShotReportStore();
    const kanto: GeoSpec = { region: "kanto", kind: "streak" };
    const [first] = planRounds(kanto, "reports");
    const shot = first.shot;
    const report = (reporter: string, ipHash: string) => reportShot({ shot, reason: "wrong-place", note: null, mode: "solo", reporter, ipHash }, Date.now(), store);

    expect(await report("d:1", "n1")).toMatchObject({ ok: true, hidden: false });
    expect(await report("d:1", "n1")).toMatchObject({ ok: false, status: 409 });
    expect(await report("d:2", "n2")).toMatchObject({ ok: true, hidden: false });
    expect(await report("u:3", "n3")).toMatchObject({ ok: true, hidden: true });
    expect(hiddenShots().has(shot)).toBe(true);
    // Never dealt again while it's out (a whole streak visits every place).
    for (let i = 0; i < 20; i++) expect(planRounds(kanto, `after-${i}`).some((r) => r.shot === shot)).toBe(false);
    // A game already holding it still knows the answer.
    expect(answerFor(kanto, first).name).toBeTruthy();

    const queue = await shotReviewQueue("open", store);
    expect(queue?.[0]).toMatchObject({ shot, reporters: 3, hidden: true });

    expect(await reviewShot(shot, "keep", "mod", Date.now(), store)).toBe(3);
    expect(hiddenShots().has(shot)).toBe(false);
    expect(await shotReviewQueue("open", store)).toEqual([]);
    // Keep clears the reports: the same reporters can't flag it again.
    expect(await report("d:1", "n1")).toMatchObject({ ok: false, status: 409 });
  });

  it("keeps a removed shot out of rotation", async () => {
    const store = memoryShotReportStore();
    const [first] = planRounds({ region: "johto", kind: "game" }, "removed");
    await reportShot({ shot: first.shot, reason: "gives-away", note: "Town name on screen", mode: "daily", reporter: "d:9", ipHash: "n9" }, Date.now(), store);
    expect(hiddenShots().has(first.shot)).toBe(false);
    expect(await reviewShot(first.shot, "remove", "mod", Date.now(), store)).toBe(1);
    expect(hiddenShots().has(first.shot)).toBe(true);
    await syncHiddenShots(Date.now() + 120_000, store);
    expect(hiddenShots().has(first.shot)).toBe(true);
  });

  it("fails open: a store that isn't there hides nothing and still thanks the player", async () => {
    const broken = {
      insert: async () => {
        throw new Error("relation does not exist");
      },
      active: async () => {
        throw new Error("down");
      },
      list: async () => [],
      review: async () => 0,
    };
    expect(await reportShot({ shot: "aaaaaaaaaaaa", reason: "other", note: null, mode: "solo", reporter: "d:1", ipHash: null }, Date.now(), broken)).toMatchObject({ ok: true, stored: false });
    await syncHiddenShots(Date.now() + 10 * 60_000, broken);
    expect(hiddenShots().size).toBe(0);
    expect(geoRegions().find((r) => r.id === "kanto")!.locations).toBeGreaterThan(40);
  });
});
