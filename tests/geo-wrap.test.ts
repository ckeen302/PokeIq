import { describe, expect, it } from "vitest";
import { measureGuess } from "@/lib/server/geo";
import { GEO_WORLD_PERIOD, wrapDelta, wrapDistance, wrapGap, wrapNear } from "@/lib/geo-wrap";
import { scorePin, type ScoreMap } from "@/lib/hunt/score";
import { huntRegionAt } from "@/lib/server/hunt";
import { GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import type { GeoSpec } from "@/lib/geo-types";
import geo from "@/data/geo.json";

type WorldLoc = { name: string; region?: string; parent?: string; pin?: [number, number]; mask?: [number, number][]; shots: { id: string }[] };
const WORLD = (geo as unknown as { world: { map: { width: number; height: number; squarePx: number }; locations: WorldLoc[] } }).world;
const placed = WORLD.locations.filter((l) => l.pin && l.mask && !l.parent);
const place = (region: string, name: string) => placed.find((l) => l.region === region && l.name === name)!;
const roundAt = (l: WorldLoc) => ({ location: l.name, region: l.region, shot: l.shots[0].id });
const world: Pick<GeoSpec, "region"> = { region: "world" };

describe("the whole world's map wraps (lib/geo-wrap)", () => {
  it("measures across the join the short way", () => {
    expect(wrapGap(0.98 - 0.02, 1)).toBeCloseTo(0.04);
    expect(wrapGap(0.3, 1)).toBeCloseTo(0.3);
    expect(wrapDelta(0.98 - 0.02, 1)).toBeCloseTo(-0.04);
    expect(wrapNear(0.98, 0.02, 1)).toBeCloseTo(-0.02);
    expect(wrapNear(0.98, 0.02)).toBe(0.98);
    expect(wrapDistance(0.01, 0, 0.99, 0, 1, 5850)).toBeCloseTo(117);
    // A region's map doesn't wrap.
    expect(wrapDistance(0.01, 0, 0.99, 0, undefined, 5850)).toBeCloseTo(5733);
  });

  it("scores a guess just across the join as close (the far west of Unova, a pin just past the east edge by Alola)", () => {
    const west = [...placed].filter((l) => l.region === "Unova").sort((a, b) => a.pin![0] - b.pin![0])[0];
    const [x, y] = west.pin!;
    const across = x - 0.04 + GEO_WORLD_PERIOD;
    const m = measureGuess(world, roundAt(west), across, y);
    // The same as a pin 0.04 of the map west of the place (off the map's left edge), measured straight.
    expect(m).toEqual(measureGuess(world, roundAt(west), x - 0.04, y));
    expect(m.squares).toBeLessThan(10);
    expect(m.score).toBeGreaterThan(3000);
  });

  it("scores the earlier phone test (a pin by Alola, the answer Humilau City) the short way", () => {
    const humilau = place("Unova", "Humilau City");
    const m = measureGuess(world, roundAt(humilau), 0.938, 0.525);
    // Was 165.2 squares and 4 points the long way round.
    expect(m.squares).toBeLessThan(50);
    expect(m.score).toBeGreaterThan(500);
  });

  it("leaves a region's own map as it was", () => {
    const pallet = place("Kanto", "Pallet Town");
    const kanto = measureGuess({ region: "kanto" }, roundAt(pallet), 0, 0);
    const far = measureGuess({ region: "kanto" }, roundAt(pallet), 1, 0);
    expect(kanto.score).toBeLessThan(GEO_MAX_ROUND_SCORE);
    expect(kanto.squares).not.toEqual(far.squares);
  });

  it("Hunt: scores and matches spots the short way on the world map", () => {
    const W = WORLD.map.width;
    const map: ScoreMap = { diagonal: () => 6000, perfectPx: 14, squarePx: 28 };
    const spots = [{ region: "unova" as const, area: [[50, 500]] as [number, number][] }, { region: "alola" as const, area: [[5000, 500]] as [number, number][] }];
    // 100 px west of the join: the Unova spot (150 px away across it) is nearer than Alola's (750 px).
    const pin: [number, number] = [W - 100, 500];
    expect(scorePin({ ...map, period: W }, pin, spots)).toMatchObject({ spot: 0, distancePx: 150 });
    expect(scorePin(map, pin, spots).spot).toBe(1);
    // The region a pin is in: the nearest place's, the short way round.
    const anville = place("Unova", "Anville Town");
    const ax = anville.pin![0] * W - 30 + W;
    expect(huntRegionAt([ax, anville.pin![1] * WORLD.map.height], W)).toBe("unova");
  });
});
