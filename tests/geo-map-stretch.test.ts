import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_STRETCH, drawMatrix, screenOf, stretchFor, stretchOf, verticalScale, worldOf, zoomedAbout, type AtlasView, type Stretch } from "@/components/atlas/atlas-engine";
import { DOCK_WORLD, dockHome } from "@/components/geo/dock-size";

/** The open dock's canvas in a 1000×578 window (GeoGuessr's hovered size, inside its 2 px border), and in a 1440×900 one. */
const SMALL = { W: 296, H: 206.39 };
const LAPTOP = { W: 428, H: 323.59 };

/** A view with its stretch, as the engine reports it: the vertical scale over s. */
const viewAt = (s: number, tx: number, ty: number, st: Stretch | null): AtlasView => ({ s, tx, ty, k: verticalScale(s, st) / s });

describe("the guess map's open dock: the whole world drawn taller to fill the box", () => {
  it("fills GeoGuessr's box with the land and a little sea, about 1.6 times taller in a 1000×578 window", () => {
    const st = stretchFor(SMALL.W, SMALL.H, DOCK_WORLD)!;
    expect(Math.exp(st.L)).toBeCloseTo(1.6, 1);
    expect(Math.exp(stretchFor(LAPTOP.W, LAPTOP.H, DOCK_WORLD)!.L)).toBeCloseTo(1.74, 1);
    // Zoomed right out and centred, the canvas's corners are the box's corners: no empty sea bands, nothing cut.
    const [x0, y0, x1, y1] = DOCK_WORLD;
    const vs = verticalScale(st.s0, st);
    const v = viewAt(st.s0, SMALL.W / 2 - ((x0 + x1) / 2) * st.s0, SMALL.H / 2 - ((y0 + y1) / 2) * vs, st);
    const [ax, ay] = worldOf(v, 0, 0);
    const [bx, by] = worldOf(v, SMALL.W, SMALL.H);
    for (const [got, want] of [[ax, x0], [ay, y0], [bx, x1], [by, y1]]) expect(got).toBeCloseTo(want, 6);
    // The land (its outermost coasts) sits inside with a few px of sea on every side.
    const [lx, ly] = screenOf(v, 138, 144);
    const [rx, ry] = screenOf(v, 5662, 2470);
    for (const m of [lx, ly, SMALL.W - rx, SMALL.H - ry]) {
      expect(m).toBeGreaterThan(5);
      expect(m).toBeLessThan(15);
    }
  });

  it("draws the world as it is where the box would need too much or too little stretch", () => {
    expect(stretchFor(300, 400, DOCK_WORLD)).toBeNull();
    expect(stretchFor(900, 200, DOCK_WORLD)).toBeNull();
    expect(stretchFor(0, 0, DOCK_WORLD)).toBeNull();
    const w = 400;
    const h = (w * MAX_STRETCH * (DOCK_WORLD[3] - DOCK_WORLD[1])) / (DOCK_WORLD[2] - DOCK_WORLD[0]);
    expect(stretchFor(w, h * 0.999, DOCK_WORLD)).not.toBeNull();
    expect(stretchFor(w, h * 1.01, DOCK_WORLD)).toBeNull();
  });

  it("eases off smoothly as you zoom in, gone by twice the whole world's zoom, and the map never gets shorter", () => {
    for (const size of [SMALL, LAPTOP, { W: 400, H: 330 }]) {
      const st = stretchFor(size.W, size.H, DOCK_WORLD)!;
      expect(verticalScale(st.s0, st) / st.s0).toBeCloseTo(Math.exp(st.L), 9);
      expect(verticalScale(st.s0 * Math.exp(st.X), st)).toBeCloseTo(st.s0 * Math.exp(st.X), 9);
      expect(Math.exp(st.X)).toBeGreaterThanOrEqual(2);
      expect(verticalScale(st.s0 * 6, st)).toBe(st.s0 * 6);
      let prevV = 0;
      let prevK = Infinity;
      for (let i = 0; i <= 400; i++) {
        const s = st.s0 * Math.exp((st.X * 1.2 * i) / 400);
        const v = verticalScale(s, st);
        expect(v).toBeGreaterThanOrEqual(prevV);
        expect(v / s).toBeLessThanOrEqual(prevK + 1e-12);
        // No jumps between neighbouring zooms (0.3% apart here).
        if (prevV) expect(Math.abs(Math.log(v / prevV))).toBeLessThan(0.004);
        prevV = v;
        prevK = v / s;
      }
    }
  });

  it("puts a click on the world point drawn under it, at any stretch and zoom", () => {
    const st = stretchFor(SMALL.W, SMALL.H, DOCK_WORLD)!;
    for (const f of [1, 1.3, 1.6, 2.2, 3, 8]) {
      const s = st.s0 * f;
      const v = viewAt(s, 40 - 3000 * s, 90 - 1300 * verticalScale(s, st), st);
      const [a, , , d, e, g] = drawMatrix(v);
      for (const [wx, wy] of [[0, 0], [4114, 1328], [3463, 1335], [5076, 2039], [5850, 2565]]) {
        // Where the canvas draws a world point is where a click there lands back.
        const drawn: [number, number] = [wx * a + e, wy * d + g];
        expect(screenOf(v, wx, wy)[0]).toBeCloseTo(drawn[0], 9);
        expect(screenOf(v, wx, wy)[1]).toBeCloseTo(drawn[1], 9);
        const [bx, by] = worldOf(v, ...drawn);
        expect(bx).toBeCloseTo(wx, 6);
        expect(by).toBeCloseTo(wy, 6);
      }
      // And the other way round: screen → world → screen.
      for (const [px, py] of [[0, 0], [148, 103], [295.5, 206], [12.25, 190.75]]) {
        const [qx, qy] = screenOf(v, ...worldOf(v, px, py));
        expect(qx).toBeCloseTo(px, 9);
        expect(qy).toBeCloseTo(py, 9);
      }
    }
  });

  it("zooms about the pointer: the world point under it stays under it while the stretch changes", () => {
    const st = stretchFor(LAPTOP.W, LAPTOP.H, DOCK_WORLD)!;
    let v = viewAt(st.s0, LAPTOP.W / 2 - 2900 * st.s0, LAPTOP.H / 2 - 1307 * verticalScale(st.s0, st), st);
    const cursor: [number, number] = [301, 77];
    const under = worldOf(v, ...cursor);
    for (const step of [1.6, 1.6, 1.6, 1 / 1.6, 1 / 1.6, 1 / 1.6]) {
      v = zoomedAbout(v, v.s * step, ...cursor, st);
      const [x, y] = screenOf(v, ...under);
      expect(x).toBeCloseTo(cursor[0], 9);
      expect(y).toBeCloseTo(cursor[1], 9);
    }
    expect(v.k).toBeCloseTo(Math.exp(st.L), 9);
  });

  describe("only the desktop dock, open, is stretched", () => {
    const g = globalThis as { window?: unknown };
    let had: unknown;
    beforeAll(() => {
      had = g.window;
      g.window = { innerWidth: 1000 };
    });
    afterAll(() => {
      g.window = had;
    });
    const land: [number, number, number, number] = [66, 68, 5734, 2546];

    it("the dock open (hovered, pinned or a bigger size): stretched", () => {
      expect(stretchOf(dockHome(land, true), SMALL.W, SMALL.H)).not.toBeNull();
      expect(stretchOf(dockHome(land, true), 396, 276)).not.toBeNull();
    });

    it("the dock at rest, the phone's card and every other map: drawn as they are", () => {
      expect(stretchOf(dockHome(land, true), 156, 94.26)).toBeNull();
      expect(stretchOf(dockHome(land, false), 358, 600)).toBeNull();
      expect(stretchOf(dockHome(land, false), SMALL.W, SMALL.H)).toBeNull();
      expect(stretchOf(undefined, SMALL.W, SMALL.H)).toBeNull();
      expect(stretchOf({ box: land, cover: true }, SMALL.W, SMALL.H)).toBeNull();
      // With no stretch the vertical scale is the scale: screen and world as before.
      expect(verticalScale(0.137, null)).toBe(0.137);
      const v: AtlasView = { s: 0.2, tx: -30, ty: 12 };
      expect(screenOf(v, 100, 50)).toEqual([-10, 22]);
      expect(worldOf(v, -10, 22)).toEqual([100, 50]);
    });
  });
});
