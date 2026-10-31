/**
 * PokéGuessr exact spots: the alignment gate. A spot found on a game's own
 * map of a place (a full-area map rip, or a top-down view of a 3D area) has
 * to be carried onto our atlas, which is our own drawing of the world: a
 * route is a thin cream path between towns, a town or cave a small block.
 * Each area is fitted on its own:
 *
 * - `fitArea`: the game map's content box onto the area's drawn path (a
 *   route) or its mask (anything else), per axis (an affine map with no
 *   rotation, since every map is drawn north-up). The fit passes the gate
 *   only when the shapes agree (the long axis, the path covered by the game
 *   map and the game map lying on the path) and the control points land
 *   right: the route's two ends (its entrances) on our area next to a
 *   neighbouring place, plus any control points the caller knows (a Pokémon
 *   Center, a bridge, a cave mouth) within tolerance of where our map has them.
 * - `fitControls`: a least-squares affine map from three or more control
 *   points with known spots on both maps (for areas whose outline can't be
 *   read from the game map), with its residuals.
 *
 * An area that fails keeps all its shots area-scored. Everything here is in
 * world-map pixels (src/data/geo.json's world.map: 5850 × 2565).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export type Px = [number, number];

export interface AtlasLocation {
  name: string;
  region: string;
  parent?: string;
  pin: [number, number];
  mask: [number, number][];
}

export interface Atlas {
  width: number;
  height: number;
  squarePx: number;
  /** The world map's pixels, RGB. */
  rgb: Buffer;
  locations: AtlasLocation[];
}

/** Loads the world map and its places (pinned ones: buildings share their parent's area). */
export async function loadAtlas(root = process.cwd()): Promise<Atlas> {
  const geo = JSON.parse(readFileSync(path.join(root, "src/data/geo.json"), "utf8")) as {
    world: { map: { src: string; width: number; height: number; squarePx: number }; locations: (AtlasLocation & { pin?: [number, number]; mask?: [number, number][] })[] };
  };
  const { map } = geo.world;
  const { data, info } = await sharp(path.join(root, "public", map.src)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== map.width || info.height !== map.height) throw new Error(`world map is ${info.width}×${info.height}, data says ${map.width}×${map.height}`);
  const locations = geo.world.locations.filter((l): l is AtlasLocation => !!l.pin && !!l.mask && !l.parent);
  return { width: map.width, height: map.height, squarePx: map.squarePx, rgb: data, locations };
}

const rgbAt = (atlas: Atlas, x: number, y: number): [number, number, number] => {
  const i = (y * atlas.width + x) * 3;
  return [atlas.rgb[i], atlas.rgb[i + 1], atlas.rgb[i + 2]];
};
/** The cream fill of a drawn route (sand is the same colour: the outline tells them apart). */
const isCream = ([r, g, b]: [number, number, number]) => r >= 215 && g >= 195 && b >= 135 && b <= 200 && r - b >= 35 && r - b <= 110 && r - g <= 45;
const luma = ([r, g, b]: [number, number, number]) => 0.3 * r + 0.59 * g + 0.11 * b;
/** Widest a drawn path is between its two outlines. */
const STROKE = 6;

/**
 * A pixel of a drawn route: cream, with the path's darker outline on both
 * sides within a few pixels, across or down (sand is cream too, but wide).
 */
export function isPathPixel(atlas: Atlas, x: number, y: number): boolean {
  x = Math.round(x);
  y = Math.round(y);
  if (x < STROKE || y < STROKE || x >= atlas.width - STROKE || y >= atlas.height - STROKE) return false;
  const c = rgbAt(atlas, x, y);
  if (!isCream(c)) return false;
  const dark = luma(c) * 0.8;
  const edge = (dx: number, dy: number) => {
    for (let k = 1; k <= STROKE; k++) {
      const p = rgbAt(atlas, x + dx * k, y + dy * k);
      if (luma(p) < dark) return k;
      if (!isCream(p)) return 0;
    }
    return 0;
  };
  const across = (a: number, b: number) => a > 0 && b > 0 && a + b - 1 <= STROKE;
  return across(edge(-1, 0), edge(1, 0)) || across(edge(0, -1), edge(0, 1));
}

export interface AreaGeometry {
  name: string;
  region: string;
  /** The area's mask points in world pixels. */
  mask: Px[];
  /** The mask's box: left, top, right, bottom (each point stands for a cell half the grid spacing around it). */
  maskBox: [number, number, number, number];
  /**
   * A straight route's drawn path: its main line (the pixels within a few px
   * of the path's middle across its long axis) and that line's box. Empty for
   * a town or cave block, and for a route that bends (it needs a piecewise
   * fit, which this gate doesn't do: its shots stay area-scored).
   */
  path: Px[];
  pathBox: [number, number, number, number] | null;
  /** Why there's no path (a town, too few path pixels, a bend). */
  pathNote?: string;
  /** The other places with mask points within two squares of this one's, nearest first. */
  neighbours: { name: string; region: string; px: number }[];
}

const key = (l: Pick<AtlasLocation, "region" | "name">) => `${l.region}|${l.name}`;
const boxOf = (pts: Px[], pad = 0): [number, number, number, number] => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
};

/** Every place's mask points in world pixels, bucketed for nearest-place lookups. */
class MaskIndex {
  private cells = new Map<string, { key: string; p: Px }[]>();
  constructor(
    atlas: Atlas,
    private size = 32
  ) {
    for (const l of atlas.locations)
      for (const [mx, my] of l.mask) {
        const p: Px = [mx * atlas.width, my * atlas.height];
        const k = `${Math.floor(p[0] / size)},${Math.floor(p[1] / size)}`;
        const list = this.cells.get(k) ?? [];
        list.push({ key: key(l), p });
        this.cells.set(k, list);
      }
  }
  /** Mask points within `r` pixels of (x, y). */
  near(x: number, y: number, r: number): { key: string; d: number }[] {
    const out: { key: string; d: number }[] = [];
    const s = this.size;
    for (let cy = Math.floor((y - r) / s); cy <= Math.floor((y + r) / s); cy++)
      for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++)
        for (const m of this.cells.get(`${cx},${cy}`) ?? []) {
          const d = Math.hypot(m.p[0] - x, m.p[1] - y);
          if (d <= r) out.push({ key: m.key, d });
        }
    return out;
  }
}

const INDEX = new WeakMap<Atlas, MaskIndex>();
const indexOf = (atlas: Atlas) => {
  let index = INDEX.get(atlas);
  if (!index) INDEX.set(atlas, (index = new MaskIndex(atlas)));
  return index;
};

/** Distance from (x, y) to the nearest mask point of a place (Infinity beyond `r`). */
export function distToArea(atlas: Atlas, area: Pick<AtlasLocation, "region" | "name">, x: number, y: number, r = 200): number {
  const k = key(area);
  return indexOf(atlas)
    .near(x, y, r)
    .filter((m) => m.key === k)
    .reduce((best, m) => Math.min(best, m.d), Infinity);
}

/** An area's shape on our atlas: its mask, its own stretch of drawn path, and its neighbours. */
export function areaGeometry(atlas: Atlas, region: string, name: string): AreaGeometry | null {
  const loc = atlas.locations.find((l) => l.region === region && l.name === name);
  if (!loc) return null;
  const k = key(loc);
  const index = indexOf(atlas);
  const mask: Px[] = loc.mask.map(([x, y]) => [x * atlas.width, y * atlas.height]);
  const box = boxOf(mask);
  const path: Px[] = [];
  for (let y = Math.floor(box[1] - 6); y <= box[3] + 6; y++)
    for (let x = Math.floor(box[0] - 6); x <= box[2] + 6; x++) {
      if (!isPathPixel(atlas, x, y)) continue;
      const near = index.near(x, y, 14);
      if (!near.length) continue;
      const best = near.reduce((a, b) => (b.d < a.d ? b : a));
      if (best.key === k) path.push([x, y]);
    }
  const neighbours = new Map<string, number>();
  for (const [x, y] of mask)
    for (const m of index.near(x, y, atlas.squarePx * 2))
      if (m.key !== k) neighbours.set(m.key, Math.min(neighbours.get(m.key) ?? Infinity, m.d));
  const spacing = gridSpacing(mask);
  const line = mainLine(path);
  return {
    name,
    region,
    mask,
    maskBox: boxOf(mask, spacing / 2),
    path: line.pts,
    pathBox: line.pts.length ? boxOf(line.pts, 0.5) : null,
    ...(line.note ? { pathNote: line.note } : {}),
    neighbours: [...neighbours]
      .map(([k2, px]) => ({ region: k2.split("|")[0], name: k2.split("|").slice(1).join("|"), px: Math.round(px * 10) / 10 }))
      .sort((a, b) => a.px - b.px),
  };
}

const quantile = (vs: number[], q: number) => {
  const s = [...vs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/** Half the width of a drawn path's main line (the atlas draws routes about 4 px wide). */
export const LINE_HALF = 2.5;

/**
 * A straight route's main line: the path pixels within LINE_HALF of the
 * path's middle across its long axis (side stubs where other routes join are
 * left out). A path whose middle wanders more than that is a bend.
 */
function mainLine(path: Px[]): { pts: Px[]; note?: string } {
  if (path.length < 12) return { pts: [], note: "no drawn path" };
  const spanX = quantile(path.map((p) => p[0]), 0.98) - quantile(path.map((p) => p[0]), 0.02);
  const spanY = quantile(path.map((p) => p[1]), 0.98) - quantile(path.map((p) => p[1]), 0.02);
  const tall = spanY >= spanX;
  const along = (p: Px) => (tall ? p[1] : p[0]);
  const across = (p: Px) => (tall ? p[0] : p[1]);
  const lo = quantile(path.map(along), 0.02);
  const hi = quantile(path.map(along), 0.98);
  if (hi - lo < 10) return { pts: [], note: "path too short" };
  // The middle across, in each tenth along: a straight route's stays put.
  const mids: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = lo + ((hi - lo) * i) / 10;
    const b = lo + ((hi - lo) * (i + 1)) / 10;
    const slice = path.filter((p) => along(p) >= a && along(p) <= b).map(across);
    if (slice.length) mids.push(quantile(slice, 0.5));
  }
  const mid = quantile(mids, 0.5);
  const wander = Math.max(...mids.map((m) => Math.abs(m - mid)));
  if (wander > LINE_HALF + 1.5) return { pts: [], note: `path bends (${Math.round(wander)}px off its line)` };
  const pts = path.filter((p) => Math.abs(across(p) - mid) <= LINE_HALF);
  return pts.length >= 10 ? { pts } : { pts: [], note: "path too thin" };
}

/** The mask's grid spacing (the smallest gap between two of its points). */
function gridSpacing(mask: Px[]): number {
  let best = Infinity;
  for (let i = 0; i < mask.length; i++)
    for (let j = i + 1; j < mask.length; j++) {
      const d = Math.hypot(mask[i][0] - mask[j][0], mask[i][1] - mask[j][1]);
      if (d > 0.5 && d < best) best = d;
    }
  return Number.isFinite(best) ? best : 7;
}

/** A game's map of a place, as the gate reads it: its size and which of its cells hold map (not void around an irregular map). */
export interface GameMapShape {
  width: number;
  height: number;
  /** Cell size of `occupied`, in game-map pixels. */
  cell: number;
  /** One byte per cell (row-major, ceil(width / cell) across): 1 where the map has content. */
  occupied: Uint8Array;
}

/** A game map's shape from its RGBA pixels: a cell holds map unless it's all transparent or all one void colour (black, white). */
export function shapeOf(rgba: Buffer, width: number, height: number, cell = 16): GameMapShape {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const occupied = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let filled = 0;
      let first = -1;
      let uniform = true;
      for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y++)
        for (let x = cx * cell; x < Math.min(width, (cx + 1) * cell); x++) {
          const i = (y * width + x) * 4;
          if (rgba[i + 3] < 128) continue;
          filled++;
          const v = rgba.readUInt32LE(i);
          if (first < 0) first = v;
          else if (v !== first) uniform = false;
        }
      const voidColour = first >= 0 && uniform && [0, 0xffffff].includes(first & 0xffffff);
      occupied[cy * cols + cx] = filled > (cell * cell) / 3 && !voidColour ? 1 : 0;
    }
  return { width, height, cell, occupied };
}

const occupiedAt = (shape: GameMapShape, x: number, y: number) => {
  const cols = Math.ceil(shape.width / shape.cell);
  const cx = Math.floor(x / shape.cell);
  const cy = Math.floor(y / shape.cell);
  if (cx < 0 || cy < 0 || cx >= cols || cy * cols >= shape.occupied.length) return false;
  return shape.occupied[cy * cols + cx] === 1;
};

/** The box of a game map's content (cells with map), in game-map pixels. */
export function contentBox(shape: GameMapShape): [number, number, number, number] | null {
  const cols = Math.ceil(shape.width / shape.cell);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  shape.occupied.forEach((v, i) => {
    if (!v) return;
    const [cx, cy] = [i % cols, Math.floor(i / cols)];
    [x0, y0, x1, y1] = [Math.min(x0, cx), Math.min(y0, cy), Math.max(x1, cx + 1), Math.max(y1, cy + 1)];
  });
  if (!Number.isFinite(x0)) return null;
  return [x0 * shape.cell, y0 * shape.cell, Math.min(shape.width, x1 * shape.cell), Math.min(shape.height, y1 * shape.cell)];
}

/** A control point: somewhere on the game map, and where it must land on ours. */
export interface ControlPoint {
  label: string;
  /** Game-map pixels. */
  at: Px;
  /** On the area within `tolerance` px (an entrance, a bridge on the route), and optionally next to a named neighbour, or at a known world pixel. */
  expect: { onArea: true; nextTo?: "any-neighbour" | string; tolerance?: number } | { world: Px; tolerance: number };
}

export interface ControlResult {
  label: string;
  world: Px;
  ok: boolean;
  /** How far it landed from where it should (px). */
  errPx: number;
  detail?: string;
}

export interface AreaFit {
  area: string;
  region: string;
  ok: boolean;
  /** Why the gate turned it down (empty when it passed). */
  reasons: string[];
  kind: "affine" | "controls";
  /** Where the game map's content box lands (world px). */
  target: [number, number, number, number];
  checks: { gameAspect: number; targetAspect: number; recall?: number; precision?: number; residualPx?: number };
  controls: ControlResult[];
  /** Game-map pixels → world pixels (on the area: snapped to its drawn path for a route). */
  toWorld: (x: number, y: number) => Px;
}

/** Gate thresholds. */
export const GATE = {
  /** A route whose drawn path is this elongated has a long axis the game map must share. */
  ELONGATED: 2,
  /** ...and the game map must be at least this elongated the same way. */
  GAME_ELONGATED: 1.25,
  /** Share of our drawn path the game map's content covers (after the fit). */
  MIN_RECALL: 0.85,
  /** Share of the game map's content that lands on (near) our drawn path. */
  MIN_PRECISION: 0.85,
  /** Near the path: within this many px. */
  PATH_TOL: 4,
  /** An entrance lands within this many px of our area's mask. */
  ON_AREA_PX: 9,
  /** ...and within this many squares of a neighbouring place. */
  NEIGHBOUR_SQUARES: 1.25,
  /** Control-point fits: largest residual allowed (px). */
  MAX_RESIDUAL_PX: 4,
};

const nearestOf = (pts: Px[], x: number, y: number): { p: Px; d: number } => {
  let best: Px = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < bd) [bd, best] = [d, p];
  }
  return { p: best, d: bd };
};

function checkControl(atlas: Atlas, area: AreaGeometry, cp: ControlPoint, world: Px): ControlResult {
  const e = cp.expect;
  if ("world" in e) {
    const errPx = Math.hypot(world[0] - e.world[0], world[1] - e.world[1]);
    return { label: cp.label, world, ok: errPx <= e.tolerance, errPx: round1(errPx) };
  }
  const onArea = nearestOf(area.mask, world[0], world[1]).d;
  const tol = e.tolerance ?? GATE.ON_AREA_PX;
  if (onArea > tol) return { label: cp.label, world, ok: false, errPx: round1(onArea), detail: "off our area" };
  if (!e.nextTo) return { label: cp.label, world, ok: true, errPx: round1(onArea) };
  const reach = atlas.squarePx * GATE.NEIGHBOUR_SQUARES;
  const near = indexOf(atlas)
    .near(world[0], world[1], reach)
    .filter((m) => m.key !== key(area) && (e.nextTo === "any-neighbour" || m.key.endsWith(`|${e.nextTo}`)));
  if (!near.length) return { label: cp.label, world, ok: false, errPx: round1(onArea), detail: `no ${e.nextTo === "any-neighbour" ? "neighbouring place" : e.nextTo} within ${reach}px` };
  const n = near.reduce((a, b) => (b.d < a.d ? b : a));
  return { label: cp.label, world, ok: true, errPx: round1(onArea), detail: `next to ${n.key.split("|")[1]} (${round1(n.d)}px)` };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The route's entrances on the game map: the middle of its content at both
 * ends of its long axis (where a route meets the towns it joins).
 */
export function routeEnds(shape: GameMapShape): { label: string; at: Px }[] {
  const box = contentBox(shape);
  if (!box) return [];
  const [x0, y0, x1, y1] = box;
  const tall = y1 - y0 >= x1 - x0;
  const strip = Math.max(shape.cell, Math.round((tall ? y1 - y0 : x1 - x0) * 0.04));
  const mid = (from: number, to: number): Px | null => {
    let [sx, sy, n] = [0, 0, 0];
    for (let y = tall ? from : y0; y < (tall ? to : y1); y += shape.cell / 2)
      for (let x = tall ? x0 : from; x < (tall ? x1 : to); x += shape.cell / 2)
        if (occupiedAt(shape, x, y)) [sx, sy, n] = [sx + x, sy + y, n + 1];
    return n ? [sx / n, sy / n] : null;
  };
  const a = tall ? mid(y0, y0 + strip) : mid(x0, x0 + strip);
  const b = tall ? mid(y1 - strip, y1) : mid(x1 - strip, x1);
  return [
    ...(a ? [{ label: tall ? "north entrance" : "west entrance", at: a }] : []),
    ...(b ? [{ label: tall ? "south entrance" : "east entrance", at: b }] : []),
  ];
}

/**
 * Fits a game map onto an area of our atlas (see the top of the file). For a
 * route (an area with a drawn path), the route's two ends are checked as
 * entrances unless `entrances: false`; `controls` adds known points.
 */
export function fitArea(atlas: Atlas, area: AreaGeometry, shape: GameMapShape, opts: { controls?: ControlPoint[]; entrances?: boolean } = {}): AreaFit {
  const reasons: string[] = [];
  const content = contentBox(shape) ?? [0, 0, shape.width, shape.height];
  const route = !!area.pathBox;
  const target = route ? area.pathBox! : area.maskBox;
  const [gx0, gy0, gx1, gy1] = content;
  const [tx0, ty0, tx1, ty1] = target;
  const raw = (x: number, y: number): Px => [tx0 + ((x - gx0) / (gx1 - gx0)) * (tx1 - tx0), ty0 + ((y - gy0) / (gy1 - gy0)) * (ty1 - ty0)];
  const inv = (x: number, y: number): Px => [gx0 + ((x - tx0) / (tx1 - tx0)) * (gx1 - gx0), gy0 + ((y - ty0) / (ty1 - ty0)) * (gy1 - gy0)];
  const toWorld = (x: number, y: number): Px => {
    const p = raw(x, y);
    if (route) return nearestOf(area.path, p[0], p[1]).p;
    const m = nearestOf(area.mask, p[0], p[1]);
    return m.d <= 6 ? p : m.p;
  };
  const gameAspect = (gx1 - gx0) / (gy1 - gy0);
  const targetAspect = (tx1 - tx0) / (ty1 - ty0);
  const checks: AreaFit["checks"] = { gameAspect: round1(gameAspect * 100) / 100, targetAspect: round1(targetAspect * 100) / 100 };

  // The long axis: a tall route on our map is a tall map in the game.
  const elong = (a: number) => (a >= 1 ? a : 1 / a);
  if (elong(targetAspect) >= GATE.ELONGATED) {
    const same = Math.sign(Math.log(targetAspect)) === Math.sign(Math.log(gameAspect));
    if (!same || elong(gameAspect) < GATE.GAME_ELONGATED) reasons.push(`long axis differs (game ${checks.gameAspect}, ours ${checks.targetAspect})`);
  } else if (!route && Math.abs(Math.log(gameAspect / targetAspect)) > Math.log(2.2)) {
    reasons.push(`proportions differ (game ${checks.gameAspect}, ours ${checks.targetAspect})`);
  }

  if (route) {
    // Our path, read back onto the game map, lies on its content; its content, carried over, lies on our path.
    let hit = 0;
    for (const [x, y] of area.path) {
      const [gx, gy] = inv(x, y);
      const r = shape.cell;
      if (occupiedAt(shape, gx, gy) || occupiedAt(shape, gx - r, gy) || occupiedAt(shape, gx + r, gy) || occupiedAt(shape, gx, gy - r) || occupiedAt(shape, gx, gy + r)) hit++;
    }
    checks.recall = round1((hit / area.path.length) * 100) / 100;
    let on = 0;
    let all = 0;
    const cols = Math.ceil(shape.width / shape.cell);
    shape.occupied.forEach((v, i) => {
      if (!v) return;
      all++;
      const [wx, wy] = raw(((i % cols) + 0.5) * shape.cell, (Math.floor(i / cols) + 0.5) * shape.cell);
      if (nearestOf(area.path, wx, wy).d <= GATE.PATH_TOL) on++;
    });
    checks.precision = all ? round1((on / all) * 100) / 100 : 0;
    if (checks.recall < GATE.MIN_RECALL) reasons.push(`game map covers ${Math.round(checks.recall * 100)}% of our path`);
    if (checks.precision < GATE.MIN_PRECISION) reasons.push(`${Math.round(checks.precision * 100)}% of the game map lands on our path`);
  }

  const cps: ControlPoint[] = [
    ...(route && opts.entrances !== false ? routeEnds(shape).map((e) => ({ label: e.label, at: e.at, expect: { onArea: true as const, nextTo: "any-neighbour" } })) : []),
    ...(opts.controls ?? []),
  ];
  const controls = cps.map((cp) => checkControl(atlas, area, cp, raw(cp.at[0], cp.at[1])));
  for (const c of controls) if (!c.ok) reasons.push(`${c.label}: ${c.detail ?? `${c.errPx}px off`}`);
  if (!cps.length) reasons.push("no control points");

  return { area: area.name, region: area.region, ok: reasons.length === 0, reasons, kind: "affine", target, checks, controls, toWorld };
}

/**
 * A least-squares affine map from control points known on both maps (three or
 * more, not on one line). Passes when every residual is within
 * GATE.MAX_RESIDUAL_PX and the fit is leave-one-out stable (each point
 * predicted from the others lands within twice that).
 */
export function fitControls(atlas: Atlas, area: AreaGeometry, pairs: { label: string; game: Px; world: Px }[]): AreaFit {
  const reasons: string[] = [];
  const solve = (ps: typeof pairs) => {
    // Normal equations for x' = a·x + b·y + c (and y' alike).
    const m = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const vx = [0, 0, 0];
    const vy = [0, 0, 0];
    for (const p of ps) {
      const r = [p.game[0], p.game[1], 1];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) m[i][j] += r[i] * r[j];
        vx[i] += r[i] * p.world[0];
        vy[i] += r[i] * p.world[1];
      }
    }
    const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    const d = det(m);
    if (Math.abs(d) < 1e-9) return null;
    const cramer = (v: number[]) => [0, 1, 2].map((c) => det(m.map((row, i) => row.map((x, j) => (j === c ? v[i] : x)))) / d);
    const ax = cramer(vx);
    const ay = cramer(vy);
    return (x: number, y: number): Px => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]];
  };
  const f = pairs.length >= 3 ? solve(pairs) : null;
  if (!f) reasons.push("needs three control points not on one line");
  const controls: ControlResult[] = pairs.map((p) => {
    const w = f ? f(p.game[0], p.game[1]) : p.world;
    const errPx = Math.hypot(w[0] - p.world[0], w[1] - p.world[1]);
    return { label: p.label, world: w, ok: errPx <= GATE.MAX_RESIDUAL_PX, errPx: round1(errPx) };
  });
  let residualPx = Math.max(0, ...controls.map((c) => c.errPx));
  if (f && pairs.length >= 4) {
    for (let i = 0; i < pairs.length; i++) {
      const g = solve(pairs.filter((_, j) => j !== i));
      if (!g) continue;
      const w = g(pairs[i].game[0], pairs[i].game[1]);
      const e = Math.hypot(w[0] - pairs[i].world[0], w[1] - pairs[i].world[1]);
      if (e > GATE.MAX_RESIDUAL_PX * 2) reasons.push(`${pairs[i].label}: ${round1(e)}px off when left out`);
      residualPx = Math.max(residualPx, e / 2);
    }
  }
  for (const c of controls) if (!c.ok) reasons.push(`${c.label}: ${c.errPx}px off`);
  const route = !!area.pathBox;
  const toWorld = (x: number, y: number): Px => {
    const p = f ? f(x, y) : [NaN, NaN];
    if (route) return nearestOf(area.path, p[0], p[1]).p;
    const m = nearestOf(area.mask, p[0], p[1]);
    return m.d <= 6 ? (p as Px) : m.p;
  };
  return {
    area: area.name,
    region: area.region,
    ok: reasons.length === 0,
    reasons,
    kind: "controls",
    target: area.pathBox ?? area.maskBox,
    checks: { gameAspect: NaN, targetAspect: NaN, residualPx: round1(residualPx) },
    controls,
    toWorld,
  };
}

/** World pixels → the 0–1 coordinates the data stores (5 decimals, like geo.json). */
export const normalised = (atlas: Pick<Atlas, "width" | "height">, [x, y]: Px): [number, number] => [
  Math.round((x / atlas.width) * 100000) / 100000,
  Math.round((y / atlas.height) * 100000) / 100000,
];
