import { describe, expect, it } from "vitest";
import {
  confident,
  features,
  flatten,
  groundToScreen,
  maskTextBox,
  nccMap,
  screenToGround,
  shrink,
  topTwo,
  type Camera,
  type Raster,
} from "../scripts/geo/spots3d-lib";

const CAM: Camera = { width: 1280, height: 720, a: 65, b: 60, c: 0.015, v0: 408 };

/** A deterministic pseudo-random tile map (16 px per tile): blocks of grass, water, path and trees, like a route. */
function tileMap(cols: number, rows: number, seed = 1): Raster {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const palette = [
    [90, 200, 110],
    [60, 110, 220],
    [210, 190, 140],
    [40, 110, 50],
    [150, 120, 100],
  ];
  const tiles: number[] = [];
  for (let i = 0; i < cols * rows; i++) tiles.push(Math.floor(rnd() * palette.length));
  // Grow blobs so the map has shapes several tiles across.
  for (let pass = 0; pass < 2; pass++)
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) if (rnd() < 0.5) tiles[y * cols + x] = tiles[(y + (rnd() < 0.5 ? -1 : 1)) * cols + x];
  const w = cols * 16;
  const h = rows * 16;
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = palette[tiles[Math.floor(y / 16) * cols + Math.floor(x / 16)]];
      for (let k = 0; k < 3; k++) data[(y * w + x) * 3 + k] = c[k];
    }
  return { w, h, ch: 3, data };
}

/** Renders the camera's view of the map with the player at tile centre (px, py), in another art style (shifted colours, noise). */
function render(map: Raster, cam: Camera, px: number, py: number): Raster {
  const data = new Float32Array(cam.width * cam.height * 3);
  for (let v = 0; v < cam.height; v++)
    for (let u = 0; u < cam.width; u++) {
      const [X, Y] = screenToGround(cam, u + 0.5, v + 0.5);
      const mx = Math.floor((px + X) * 16);
      const my = Math.floor((py + Y) * 16);
      const o = (v * cam.width + u) * 3;
      if (mx < 0 || my < 0 || mx >= map.w || my >= map.h) {
        data.set([30, 30, 30], o);
        continue;
      }
      const i = (my * map.w + mx) * 3;
      const n = ((u * 7919 + v * 104729) % 23) - 11;
      data[o] = map.data[i] * 0.9 + 15 + n;
      data[o + 1] = map.data[i + 1] * 0.85 + 20 + n;
      data[o + 2] = map.data[i + 2] * 0.95 + n;
    }
  return { w: cam.width, h: cam.height, ch: 3, data };
}

describe("PokéGuessr 3D spots: the camera model", () => {
  it("screenToGround undoes groundToScreen", () => {
    for (const [X, Y] of [
      [0, 0],
      [-7.5, -6],
      [9, 4.5],
      [3.25, -2.75],
    ]) {
      const [u, v] = groundToScreen(CAM, X, Y);
      const [x2, y2] = screenToGround(CAM, u, v);
      expect(x2).toBeCloseTo(X, 6);
      expect(y2).toBeCloseTo(Y, 6);
    }
  });

  it("puts the player's tile at the screen's centre column and nearer tiles wider", () => {
    expect(groundToScreen(CAM, 0, 0)).toEqual([640, 408]);
    const width = (Y: number) => groundToScreen(CAM, 0.5, Y)[0] - groundToScreen(CAM, -0.5, Y)[0];
    expect(width(4)).toBeGreaterThan(width(0));
    expect(width(0)).toBeGreaterThan(width(-6));
  });
});

describe("PokéGuessr 3D spots: flatten and match (synthetic known answers)", () => {
  const map = tileMap(60, 40, 7);
  const mapFeat = features(shrink(map, 8));
  for (const [px, py] of [
    [20.5, 15.5],
    [41.5, 22.5],
    [12.5, 30.5],
  ]) {
    it(`finds the player at tile (${px}, ${py}) within half a tile, confidently`, () => {
      const shot = render(map, CAM, px, py);
      const t = flatten(shot, CAM, 2, { up: 7, down: 6, side: 12 });
      const [best, second] = topTwo(nccMap(mapFeat, features(t.flat), t.origin), 8);
      expect(best).not.toBeNull();
      const at = [(best!.x + 0.5) / 2, (best!.y + 0.5) / 2];
      expect(Math.hypot(at[0] - px, at[1] - py)).toBeLessThanOrEqual(0.5);
      expect(confident(best, second, { min: 0.6, margin: 0.12 })).toBe(true);
    });
  }

  it("turns down a shot of somewhere the map doesn't have", () => {
    const other = tileMap(60, 40, 99);
    const shot = render(other, CAM, 30.5, 20.5);
    const t = flatten(shot, CAM, 2, { up: 7, down: 6, side: 12 });
    const [best, second] = topTwo(nccMap(mapFeat, features(t.flat), t.origin), 8);
    expect(confident(best, second, { min: 0.6, margin: 0.12 })).toBe(false);
  });
});

describe("PokéGuessr 3D spots: message boxes", () => {
  it("hides a white message box and leaves a plain shot alone", () => {
    const w = 320;
    const h = 180;
    const plain: Raster = { w, h, ch: 3, data: new Float32Array(w * h * 3).fill(100) };
    expect(maskTextBox(plain, { x0: 0.17, x1: 0.83, y0: 0.74, y1: 0.97 })).toBe(false);
    const boxed: Raster = { w, h, ch: 3, data: new Float32Array(w * h * 3).fill(100) };
    for (let y = Math.floor(0.74 * h); y < Math.floor(0.97 * h); y++) for (let x = Math.floor(0.17 * w); x < Math.floor(0.83 * w); x++) boxed.data.fill(250, (y * w + x) * 3, (y * w + x) * 3 + 3);
    expect(maskTextBox(boxed, { x0: 0.17, x1: 0.83, y0: 0.74, y1: 0.97 })).toBe(true);
    expect(boxed.valid![Math.floor(0.85 * h) * w + w / 2]).toBe(0);
    expect(boxed.valid![10 * w + 10]).toBe(1);
  });
});
