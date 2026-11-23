/**
 * Measured difficulty: how much of a map scores well for a Pokémon.
 *
 * A pin earns PokéGuessr's curve, share · e^(−10 · d / D), against the nearest spot's area
 * (D the map's diagonal, full points within half a town-map square). "Scores well" is at least
 * 60% of the pin's share, so within D · ln(1/0.6) / 10 of a spot's area.
 *
 * The map's land is every map square (PokéGuessr's 28 px grid) within two squares of any
 * place's area. For one region r of a Pokémon, s_r is the share of the land within that
 * distance of one of its spots in r. A round has p pins (huntPinsFor) and every pin has to
 * find its own region, so on the world map the measure is the mean of the p largest s_r, and
 * difficulty = 1 − that. On a region's own map it's 1 − s for that region, one pin.
 */
export type Pt = [number, number];

export interface MapGrid {
  /** The map's box in world pixels. */
  box: [number, number, number, number];
  diagonal: number;
  step: number;
  cols: number;
  rows: number;
  /** Cell index → is land. */
  land: Uint8Array;
  landCount: number;
}

const GOOD = 0.6;
const LAND_SQUARES = 2;

/** `areas`: every place's area on this map, in world pixels. */
export function buildGrid(box: [number, number, number, number], step: number, areas: Pt[][]): MapGrid {
  const [x0, y0, x1, y1] = box;
  const cols = Math.ceil((x1 - x0) / step);
  const rows = Math.ceil((y1 - y0) / step);
  const land = new Uint8Array(cols * rows);
  const g: MapGrid = { box, diagonal: Math.hypot(x1 - x0, y1 - y0), step, cols, rows, land, landCount: 0 };
  for (const a of areas) mark(g, a, LAND_SQUARES * step, land);
  g.landCount = land.reduce((n, v) => n + v, 0);
  return g;
}

/** Sets every cell whose centre is within `r` world px of a point of `area`. */
function mark(g: MapGrid, area: Pt[], r: number, out: Uint8Array) {
  const [x0, y0] = g.box;
  const reach = Math.ceil(r / g.step);
  for (const [px, py] of area) {
    const cx = Math.floor((px - x0) / g.step);
    const cy = Math.floor((py - y0) / g.step);
    for (let j = cy - reach; j <= cy + reach; j++) {
      if (j < 0 || j >= g.rows) continue;
      for (let i = cx - reach; i <= cx + reach; i++) {
        if (i < 0 || i >= g.cols) continue;
        const mx = x0 + (i + 0.5) * g.step;
        const my = y0 + (j + 0.5) * g.step;
        if (Math.hypot(mx - px, my - py) <= r) out[j * g.cols + i] = 1;
      }
    }
  }
}

/** The share of the map's land where a pin scores at least 60% against one of these spots' areas. */
export function goodShare(g: MapGrid, spots: Pt[][]): number {
  if (!spots.length || !g.landCount) return 0;
  const r = (g.diagonal * Math.log(1 / GOOD)) / 10;
  const hit = new Uint8Array(g.cols * g.rows);
  for (const a of spots) mark(g, a, r, hit);
  let n = 0;
  for (let k = 0; k < hit.length; k++) if (hit[k] && g.land[k]) n++;
  return n / g.landCount;
}

/** 1 − the mean of the `pins` largest per-region shares. */
export function worldDifficulty(shares: number[], pins: number): number {
  const top = [...shares].sort((a, b) => b - a).slice(0, Math.max(1, pins));
  const mean = top.reduce((s, v) => s + v, 0) / top.length;
  return round3(1 - mean);
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;
