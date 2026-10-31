import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GEO_SPOT_FALL_PX, GEO_SPOT_FLOOR, GEO_SPOT_PERFECT_PX, geoSpotScore } from "@/lib/geo-spot-score";
import { GEO_MAX_ROUND_SCORE, WORLD_REGION, type GeoSpec } from "@/lib/geo-types";
import { answerFor, gradeGeo, measureGuess, planRounds, readGeo, scoredSpotCount, startGeo } from "@/lib/server/geo";
import geo from "@/data/geo.json";
import spots2d from "@/data/geo-shot-spots.json";
import spots3d from "@/data/geo-shot-spots-3d.json";
import { matchShot, nativeScale, shrink, type Gray } from "../scripts/geo/spot-match";

/**
 * PokéGuessr exact spots: the scoring curve, spots never reaching the
 * browser before the guess, and the 2D matcher being deterministic.
 */

type Row = [number, number, number, string, boolean];
const ROWS = { ...(spots3d as unknown as Record<string, Row>), ...(spots2d as unknown as Record<string, Row>) };
const world = (geo as unknown as { world: { map: { width: number; height: number }; locations: { name: string; region: string; parent?: string; pin?: [number, number]; mask?: [number, number][]; shots: { id: string; game: string }[] }[] } }).world;

describe("exact-spot scoring curve", () => {
  it("is perfect only within a few map pixels, then falls fast", () => {
    expect(geoSpotScore(0, GEO_MAX_ROUND_SCORE)).toBe(GEO_MAX_ROUND_SCORE);
    expect(geoSpotScore(GEO_SPOT_PERFECT_PX, GEO_MAX_ROUND_SCORE)).toBe(GEO_MAX_ROUND_SCORE);
    expect(GEO_SPOT_PERFECT_PX).toBeLessThanOrEqual(4);
    expect(geoSpotScore(GEO_SPOT_PERFECT_PX + 1, GEO_MAX_ROUND_SCORE)).toBeLessThan(GEO_MAX_ROUND_SCORE);
    // One fall length past the perfect radius keeps about 37%.
    expect(geoSpotScore(GEO_SPOT_PERFECT_PX + GEO_SPOT_FALL_PX, 0)).toBe(Math.round(GEO_MAX_ROUND_SCORE / Math.E));
    let last = Infinity;
    for (let d = 0; d <= 200; d += 0.5) {
      const s = geoSpotScore(d, 0);
      expect(s).toBeLessThanOrEqual(last);
      expect(s).toBeGreaterThanOrEqual(0);
      last = s;
    }
  });

  it("keeps the area's distance score as a floor, capped so the area itself is no longer perfect", () => {
    // In the right area (area score 5000) but far from the spot: the floor.
    expect(geoSpotScore(500, GEO_MAX_ROUND_SCORE)).toBe(GEO_SPOT_FLOOR);
    // Far away: exactly what any other shot would score there.
    expect(geoSpotScore(5000, 1234)).toBe(1234);
    expect(geoSpotScore(5000, 0)).toBe(0);
    // Never above the maximum.
    for (const a of [0, 1000, GEO_SPOT_FLOOR, 4999, GEO_MAX_ROUND_SCORE]) for (const d of [0, 2, 5, 20]) expect(geoSpotScore(d, a)).toBeLessThanOrEqual(GEO_MAX_ROUND_SCORE);
  });
});

describe("spot data", () => {
  it("rows are [x, y, confidence, method, scored] on the world map, for known shots", () => {
    const ids = new Set(world.locations.flatMap((l) => l.shots.map((s) => s.id)));
    for (const [id, row] of Object.entries(ROWS)) {
      expect(ids.has(id)).toBe(true);
      expect(row).toHaveLength(5);
      const [x, y, c, m, scored] = row;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(typeof m).toBe("string");
      expect(typeof scored).toBe("boolean");
    }
  });

  it("only scored rows score, and every scored spot lies on (or right next to) its place's area", () => {
    const scored = Object.entries(ROWS).filter(([, r]) => r[4]);
    expect(scoredSpotCount()).toBe(scored.length);
    const { width: W, height: H } = world.map;
    for (const [id, [x, y]] of scored) {
      const loc = world.locations.find((l) => l.shots.some((s) => s.id === id))!;
      const home = loc.mask ? loc : world.locations.find((l) => l.region === loc.region && l.name === loc.parent)!;
      const d = Math.min(...home.mask!.map(([mx, my]) => Math.hypot((mx - x) * W, (my - y) * H)));
      expect(d, `${id} on ${loc.name}`).toBeLessThan(12);
    }
  });
});

describe("spots stay server-side until the guess", () => {
  const scored = Object.entries(ROWS).find(([, r]) => r[4]);
  it("no round payload carries a spot", () => {
    for (const spec of [{ region: "kanto", kind: "game" } as GeoSpec, { region: WORLD_REGION, kind: "game" } as GeoSpec, { region: WORLD_REGION, kind: "streak" } as GeoSpec]) {
      for (let i = 0; i < 20; i++) {
        const start = startGeo(spec);
        const text = JSON.stringify(start.round);
        expect(text).not.toMatch(/spot/i);
        for (const [, [x]] of Object.entries(ROWS)) expect(text).not.toContain(String(x));
      }
    }
  });

  it("no client code imports the spot data", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(f)) {
          const text = readFileSync(p, "utf8");
          if (/from "@\/data\/geo-shot-spots/.test(text) && !/^import "server-only";/m.test(text)) offenders.push(p);
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it.runIf(!!scored)("the graded answer reveals the spot, and the pin is scored against it", () => {
    const [id, [sx, sy]] = scored!;
    const loc = world.locations.find((l) => l.shots.some((s) => s.id === id))!;
    const round = { location: loc.name, region: loc.region, shot: id, game: loc.shots.find((s) => s.id === id)!.game };
    const spec = { region: WORLD_REGION };
    const answer = answerFor(spec, round);
    expect(answer.spot).toEqual([sx, sy]);
    expect(measureGuess(spec, round, sx, sy).score).toBe(GEO_MAX_ROUND_SCORE);
    // A pin on the place's own pin, if that's away from the spot, isn't perfect any more.
    const { width: W, height: H } = world.map;
    const off = Math.hypot((answer.pin[0] - sx) * W, (answer.pin[1] - sy) * H);
    if (off > GEO_SPOT_PERFECT_PX + 1) expect(measureGuess(spec, round, answer.pin[0], answer.pin[1]).score).toBeLessThan(GEO_MAX_ROUND_SCORE);
    // On a region's map the spot is in that map's coordinates, and still perfect.
    const crops = (geo as unknown as { world: { crops: Record<string, { regions: string[]; box: [number, number, number, number] }> } }).world.crops;
    const crop = Object.entries(crops).find(([, c]) => c.regions.includes(loc.region));
    if (crop) {
      const [x0, y0, x1, y1] = crop[1].box;
      const rx = (sx * W - x0) / (x1 - x0);
      const ry = (sy * H - y0) / (y1 - y0);
      const a = answerFor({ region: crop[0] }, round);
      expect(a.spot![0]).toBeCloseTo(rx, 4);
      expect(a.spot![1]).toBeCloseTo(ry, 4);
      expect(measureGuess({ region: crop[0] }, round, rx, ry).score).toBe(GEO_MAX_ROUND_SCORE);
    }
  });

  it("a graded guess carries the pin for the log, on the world map", () => {
    const spec: GeoSpec = { region: "kanto", kind: "game" };
    const start = startGeo(spec);
    const state = readGeo(start.token)!;
    const out = gradeGeo(state, { x: 0.5, y: 0.5 });
    if (!out.ok) throw new Error(out.error);
    const [px, py] = out.played.pin!;
    expect(px).toBeGreaterThan(0.6);
    expect(px).toBeLessThan(0.8);
    expect(py).toBeGreaterThan(0.4);
    expect(py).toBeLessThan(0.6);
    // The pin is never part of what the player is sent.
    expect(JSON.stringify(out.body)).not.toContain(String(px));
    void planRounds;
  });
});

describe("2D spot matcher", () => {
  // A deterministic "map": smooth noise with landmarks, 400 × 300.
  const map: Gray = { w: 400, h: 300, px: new Float32Array(400 * 300) };
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  // Value noise: a random level every 8 px, blended, plus grain.
  const grid = Array.from({ length: 52 * 40 }, () => rand() * 200);
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const [gx, gy] = [x / 8, y / 8];
      const [ix, iy] = [Math.floor(gx), Math.floor(gy)];
      const [fx, fy] = [gx - ix, gy - iy];
      const at = (a: number, b: number) => grid[b * 52 + a];
      const v = at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
      map.px[y * map.w + x] = v + 30 * rand();
    }
  const crop = (x0: number, y0: number, w: number, h: number): Gray => {
    const px = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = map.px[(y0 + y) * map.w + x0 + x];
    return { w, h, px };
  };

  it("finds a window cut from the map, the same way every time", () => {
    const shot = crop(123, 77, 160, 144);
    const a = matchShot(shot, map);
    const b = matchShot(shot, map);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect([a.best.x, a.best.y]).toEqual([123, 77]);
  });

  it("turns down a view that fits two places equally", () => {
    // A map made of one tile repeated: every place looks the same.
    const tiled: Gray = { w: 320, h: 288, px: new Float32Array(320 * 288) };
    for (let y = 0; y < tiled.h; y++) for (let x = 0; x < tiled.w; x++) tiled.px[y * tiled.w + x] = map.px[(y % 32) * map.w + (x % 32)];
    const shot: Gray = { w: 96, h: 96, px: new Float32Array(96 * 96) };
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) shot.px[y * 96 + x] = tiled.px[(y + 40) * tiled.w + x + 40];
    const m = matchShot(shot, tiled);
    expect(m.ok).toBe(false);
  });

  it("reads a nearest-neighbour enlargement back to its native pixels", () => {
    const w = 20;
    const h = 12;
    const k = 5;
    const data = new Uint8Array(w * k * h * k * 3);
    for (let y = 0; y < h * k; y++)
      for (let x = 0; x < w * k; x++) {
        const v = ((Math.floor(x / k) * 37 + Math.floor(y / k) * 91) % 251) | 0;
        data.set([v, 255 - v, (v * 3) % 256], (y * w * k + x) * 3);
      }
    const img = { w: w * k, h: h * k, data };
    expect(nativeScale(img)).toBe(k);
    const native = shrink(img, k);
    expect([native.w, native.h]).toEqual([w, h]);
  });
});
