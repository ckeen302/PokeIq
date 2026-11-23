import { describe, expect, it } from "vitest";
import atlas from "../public/atlas/atlas.json";
import { DOT_SPACING_PX, dotRadius, dotShows, nearestDistances, type AtlasData } from "@/components/atlas/atlas-engine";

const data = atlas as unknown as AtlasData;

describe("the guess map's location dots", () => {
  it("works out each dot's nearest neighbour once", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 300, y: 0 },
    ].map((p) => ({ ...p, w: 1, h: 1, kind: "town" as const, name: "", region: "" }));
    const d = nearestDistances(pts);
    expect([...d].slice(0, 2)).toEqual([50, 50]);
    expect(d[2]).toBeCloseTo(Math.hypot(270, 40));
    expect(nearestDistances(pts)).toBe(d);
  });

  it("shows a dot once its neighbour is 16 px away on screen: sparse places first", () => {
    expect(DOT_SPACING_PX).toBe(16);
    expect(dotShows(100, 0.16)).toBe(true);
    expect(dotShows(100, 0.159)).toBe(false);
    const d = nearestDistances(data.markers);
    expect(d.length).toBe(data.markers.length);
    const shownAt = (s: number) => [...d].filter((n) => dotShows(n, s)).length;
    // The whole world in a 280 px corner map: hardly any have room; zoomed in, all of them.
    expect(shownAt(280 / data.W)).toBeLessThan(data.markers.length * 0.1);
    expect(shownAt(1)).toBe(data.markers.length);
    expect(shownAt(0.15)).toBeGreaterThan(shownAt(0.08));
  });

  it("grows gently from 3 px to 5 px as you zoom in", () => {
    expect(dotRadius(0.05)).toBe(3);
    expect(dotRadius(0.2)).toBe(3);
    expect(dotRadius(0.8)).toBeCloseTo(3 + 4 / 3);
    expect(dotRadius(1.6)).toBe(5);
    expect(dotRadius(9)).toBe(5);
  });
});
