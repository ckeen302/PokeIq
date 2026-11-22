import { describe, expect, it, vi } from "vitest";
import raw from "@/data/pokemon-timeline.json";
import type { TimelineRaw } from "@/lib/timeline/types";

vi.mock("server-only", () => ({}));

const { TIMELINE } = await import("@/lib/timeline/data");
const { TIMELINE_CONTENT, localTimeline, localPlatform } = await import("@/lib/timeline/localize");

const RAW = raw as unknown as TimelineRaw[];
const LOCALES = ["ja", "es", "fr", "de", "it"] as const;

describe("the timeline's content in every language", () => {
  for (const l of LOCALES) {
    const c = TIMELINE_CONTENT[l];
    it(`${l}: has exactly the English entries, with every text field the English has`, () => {
      expect(Object.keys(c.entries).sort()).toEqual(RAW.map((e) => e.id).sort());
      for (const e of RAW) {
        const own = c.entries[e.id];
        expect(own.title, e.id).toBeTruthy();
        expect(!!own.note, `${e.id} note`).toBe(!!e.note);
        expect(!!own.series, `${e.id} series`).toBe(!!e.series);
      }
    });
    it(`${l}: covers every platform and card game series`, () => {
      for (const e of RAW) {
        if (e.platform.startsWith("Trading Card Game · ")) expect(c.tcg.series[e.platform.slice(20)], e.platform).toBeTruthy();
        else expect(c.platforms[e.platform], e.platform).toBeTruthy();
      }
      expect(Object.keys(c.platforms).sort()).toEqual([...new Set(RAW.map((e) => e.platform).filter((p) => !p.startsWith("Trading Card Game · ")))].sort());
    });
    it(`${l}: localizes the list without changing its order, ids, dates or links`, () => {
      const list = localTimeline(l);
      expect(list.map((e) => e.id)).toEqual(TIMELINE.map((e) => e.id));
      list.forEach((e, i) => {
        const en = TIMELINE[i];
        expect([e.date_jp, e.date_na, e.date_eu, e.t, e.regionHref, e.setHref, e.sources]).toEqual([en.date_jp, en.date_na, en.date_eu, en.t, en.regionHref, en.setHref, en.sources]);
        expect(e.starters.map((s) => s.id)).toEqual(en.starters.map((s) => s.id));
        expect(e.title).toBe(c.entries[e.id].title);
      });
    });
  }

  it("leaves English untouched", () => {
    expect(localTimeline("en")).toBe(TIMELINE);
    expect(TIMELINE.some((e) => "platformShort" in e)).toBe(false);
  });

  it("names regions and species officially", () => {
    const ja = localTimeline("ja").find((e) => e.id === "red-green")!;
    expect(ja.region).toBe("カントー");
    expect(ja.starters.map((s) => s.name)).toEqual(["フシギダネ", "ヒトカゲ", "ゼニガメ"]);
    expect(localTimeline("fr").find((e) => e.id === "teal-mask")!.region).toBe("Septentria");
  });

  it("splits a card game series line for the compact rows", () => {
    expect(localPlatform(TIMELINE_CONTENT.fr, "Trading Card Game · XY series")).toEqual({ full: "JCC · série XY", short: "série XY" });
    expect(localPlatform(TIMELINE_CONTENT.de, "TV series")).toEqual({ full: "Fernsehserie" });
  });
});
