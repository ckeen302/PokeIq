import { describe, expect, it } from "vitest";
import { SIZE_ITEMS } from "@/lib/sizes/data";
import { PRESET_BY_ID, presetLineup } from "@/lib/sizes/presets";
import { layoutLine } from "@/lib/sizes/types";
import { CITY_IDS, DEFAULT_CITY, citySlug, parseCity, setCityInUrl, withCity } from "@/lib/sizes/cities";
import { PRISM_TOWER, TOWER_H, planWorld } from "@/lib/sizes/world";
import { FINALE_MARGIN, finalePose, pitchFor } from "@/lib/sizes/camera";

/** The Nimbasa wheel's finale size (scene/nimbasa/wheel.ts: radius 84 on a hub at 98, its top and half-width with a margin). */
const WHEEL = { h: 98 + 84 + 6, half: 84 + 6 };

describe("cities", () => {
  it("reads the city from the address, Lumiose by default", () => {
    expect(DEFAULT_CITY).toBe("lumiose");
    expect(CITY_IDS).toEqual(["lumiose", "nimbasa"]);
    expect(parseCity("nimbasa")).toBe("nimbasa");
    expect(parseCity(" Nimbasa ")).toBe("nimbasa");
    expect(parseCity("lumiose")).toBe("lumiose");
    expect(parseCity(null)).toBe("lumiose");
    expect(parseCity("")).toBe("lumiose");
    expect(parseCity("castelia")).toBe("lumiose");
  });

  it("carries a city other than Lumiose on links", () => {
    expect(withCity("/pokedex/sizes", "lumiose")).toBe("/pokedex/sizes");
    expect(withCity("/pokedex/sizes", "nimbasa")).toBe("/pokedex/sizes?city=nimbasa");
    expect(withCity("/pokedex/sizes/compare?vs=wailord,eternatus", "nimbasa")).toBe("/pokedex/sizes/compare?vs=wailord,eternatus&city=nimbasa");
    expect(withCity("/pokedex/sizes?by=speed#top", "nimbasa")).toBe("/pokedex/sizes?by=speed&city=nimbasa#top");
  });

  it("sets or clears the city on the current address, keeping the rest", () => {
    expect(setCityInUrl("https://playpokeiq.com/pokedex/sizes?by=speed", "nimbasa")).toBe("https://playpokeiq.com/pokedex/sizes?by=speed&city=nimbasa");
    expect(setCityInUrl("https://playpokeiq.com/pokedex/sizes?city=nimbasa&by=speed", "lumiose")).toBe("https://playpokeiq.com/pokedex/sizes?by=speed");
    expect(setCityInUrl("/ja/pokedex/sizes/pikachu?city=nimbasa", "nimbasa")).toBe("/ja/pokedex/sizes/pikachu?city=nimbasa");
  });

  it("names videos made outside Lumiose by their city", () => {
    expect(citySlug("starters", "lumiose")).toBe("starters");
    expect(citySlug("starters", "nimbasa")).toBe("starters-nimbasa");
  });
});

describe("a city's landmark in the finale", () => {
  it("Lumiose's plan carries Prism Tower, unchanged", () => {
    const plan = planWorld(layoutLine(presetLineup(PRESET_BY_ID.get("legendaries")!, SIZE_ITEMS)));
    expect(PRISM_TOWER.h).toBe(TOWER_H);
    expect(plan.path.tower).toMatchObject({ x: plan.tower.x, z: plan.tower.z, h: TOWER_H, half: 30 });
  });

  it("the finale frames the whole Ferris wheel behind the last giant, on a phone and on a wide screen", () => {
    const placed = layoutLine(presetLineup(PRESET_BY_ID.get("legendaries")!, SIZE_ITEMS));
    const plan = planWorld(placed, "first-big", WHEEL);
    expect(plan.ring).not.toBeNull();
    const last = placed[placed.length - 1];
    for (const lens of [{ vfov: 46, aspect: 390 / 844 }, { vfov: 35, aspect: 16 / 9 }]) {
      const v = { x: last.x, d: last.h * 3, h: last.h, orbit: 0, pitch: pitchFor(last.h), rise: 1 };
      const f = finalePose(v, plan.path, lens);
      // Project the wheel's top (over its centre) into the camera's frame: it must sit inside the clear band.
      const [px, py, pz] = f.position, [tx, ty, tz] = f.target;
      const fwd = [tx - px, ty - py, tz - pz];
      const fl = Math.hypot(...fwd);
      const fn = fwd.map((c) => c / fl);
      const toTop = [plan.tower.x - px, WHEEL.h - py, plan.tower.z - pz];
      const ahead = toTop[0] * fn[0] + toTop[1] * fn[1] + toTop[2] * fn[2];
      expect(ahead).toBeGreaterThan(0);
      // The vertical angle of the top above the view's centre, against the frame's half-height.
      const horiz = Math.hypot(fn[0], fn[2]);
      const elTop = Math.atan2(toTop[1], Math.hypot(toTop[0], toTop[2]));
      const elAim = Math.atan2(fn[1], horiz);
      const tv = Math.tan((lens.vfov * Math.PI) / 360);
      expect(Math.tan(elTop - elAim)).toBeLessThan((1 - 2 * FINALE_MARGIN.top) * tv + 1e-6);
    }
  });
});
