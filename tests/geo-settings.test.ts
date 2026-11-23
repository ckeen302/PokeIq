import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEO_SETTINGS,
  GEO_TIMERS,
  clockText,
  geoSettingsBadge,
  timerLabel,
  parseGeoSettings,
  secondsLeft,
  visibleViews,
  zoomOrigin,
} from "@/lib/geo-settings";
import { answerFor, gradeGeo, planRounds, readGeo, startGeo } from "@/lib/server/geo";
import type { GeoSpec } from "@/lib/geo-types";

describe("play settings", () => {
  it("parses stored settings, leaving anything unknown at its default", () => {
    expect(parseGeoSettings(null)).toEqual(DEFAULT_GEO_SETTINGS);
    expect(parseGeoSettings({ noMove: true, zoomed: true, timer: 60 })).toEqual({ noMove: true, zoomed: true, timer: 60 });
    expect(parseGeoSettings({ noMove: "yes", zoomed: 1, timer: 45 })).toEqual(DEFAULT_GEO_SETTINGS);
    for (const t of GEO_TIMERS) expect(parseGeoSettings({ timer: t }).timer).toBe(t);
  });

  it("sums the settings up for the button, or nothing when all are off", () => {
    expect(geoSettingsBadge(DEFAULT_GEO_SETTINGS)).toBeNull();
    expect(geoSettingsBadge({ noMove: false, zoomed: true, timer: 0 })).toBe("Zoomed");
    // The timer has its own picker in the setup, so it isn't summed up on the button.
    expect(geoSettingsBadge({ noMove: false, zoomed: false, timer: 180 })).toBeNull();
  });

  it("defaults to GeoGuessr's 1:30 and writes clocks as 01:30", () => {
    expect(DEFAULT_GEO_SETTINGS.timer).toBe(90);
    expect(GEO_TIMERS).toEqual([0, 60, 90, 180]);
    expect(parseGeoSettings({}).timer).toBe(90);
    expect(clockText(90)).toBe("01:30");
    expect(clockText(9.2)).toBe("00:10");
    expect(clockText(180)).toBe("03:00");
    expect(clockText(-3)).toBe("00:00");
    expect(GEO_TIMERS.filter(Boolean).map(timerLabel)).toEqual(["1:00", "1:30", "3:00"]);
  });

  it("No move shows only the dealt screenshot", () => {
    const views = ["/a", "/b", "/c"];
    expect(visibleViews(views, { noMove: false })).toEqual(views);
    expect(visibleViews(views, { noMove: true })).toEqual(["/a"]);
    expect(visibleViews(["/a"], { noMove: true })).toEqual(["/a"]);
  });

  it("zooms each screenshot on the same spot every time, away from the edges", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const src = `/api/geo/shot/shot${i}`;
      const [x, y] = zoomOrigin(src);
      expect(zoomOrigin(src)).toEqual([x, y]);
      for (const v of [x, y]) {
        expect(v).toBeGreaterThanOrEqual(25);
        expect(v).toBeLessThanOrEqual(75);
      }
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it("counts a round's clock down in whole seconds, never below zero", () => {
    expect(secondsLeft(1000, 1000, 30)).toBe(30);
    expect(secondsLeft(1000, 1001, 30)).toBe(30);
    expect(secondsLeft(1000, 29_500, 30)).toBe(2);
    expect(secondsLeft(1000, 30_000, 30)).toBe(1);
    expect(secondsLeft(1000, 31_000, 30)).toBe(0);
    expect(secondsLeft(1000, 99_000, 30)).toBe(0);
  });
});

describe("the timer running out", () => {
  const near = (spec: GeoSpec, seed: string) => {
    const [round] = planRounds(spec, seed);
    return answerFor(spec, round).pin;
  };

  it("scores nothing, even with the pin right on the place, and says so", () => {
    const spec: GeoSpec = { region: "kanto", kind: "game" };
    const { token } = startGeo(spec, { seed: "timer-out" });
    const [x, y] = near(spec, "timer-out");
    const out = gradeGeo(readGeo(token)!, { x, y, timeout: true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.body.score).toBe(0);
    expect(out.body.timedOut).toBe(true);
    expect(out.body.next).toBeDefined();

    const inTime = gradeGeo(readGeo(startGeo(spec, { seed: "timer-out" }).token)!, { x, y });
    expect(inTime.ok && inTime.body.score).toBeGreaterThan(0);
    expect(inTime.ok && inTime.body.timedOut).toBeUndefined();
  });

  it("the Daily and the Weekly always play 1:30 a round; a streak is never timed", () => {
    expect(readGeo(startGeo({ region: "kanto", kind: "game", daily: "2026-10-20" }).token)!.timer).toBe(90);
    expect(readGeo(startGeo({ region: "kanto", kind: "game", daily: "2026-10-20" }, { timer: 180 }).token)!.timer).toBe(90);
    expect(readGeo(startGeo({ region: "kanto", kind: "streak" }, { timer: 60 }).token)!.timer).toBeUndefined();
    expect(readGeo(startGeo({ region: "kanto", kind: "game" }, { timer: 180 }).token)!.timer).toBe(180);
    expect(readGeo(startGeo({ region: "kanto", kind: "game" }).token)!.timer).toBeUndefined();
  });

  it("ends a streak", () => {
    const spec: GeoSpec = { region: "kanto", kind: "streak" };
    const { token } = startGeo(spec, { seed: "timer-streak" });
    const [x, y] = near(spec, "timer-streak");
    const out = gradeGeo(readGeo(token)!, { x, y, timeout: true });
    expect(out.ok && out.body.hit).toBe(false);
    expect(out.ok && out.body.done).toBe(true);
  });
});
