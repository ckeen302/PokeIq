/**
 * The world atlas canvas, shared by the atlas page and PokéGuessr: the painted
 * world map (with pre-shrunk copies so zoomed-out frames stay cheap), crisp
 * town markers, and labels that appear as you zoom in and never overlap. Pan
 * with a drag, zoom with the wheel or a pinch. A game can lock the view to one
 * region's box (it starts there and the rest is dimmed) and take clicks as guesses.
 */

export interface AtlasPlace {
  name: string;
  region: string;
  x: number;
  y: number;
  kind: "town" | "route" | "landmark";
  exact?: boolean;
  source?: string;
  /** Buildings and spots inside the place. */
  inside?: string[];
}

export interface AtlasRegion {
  name: string;
  /** 1: main series region, 2: DLC or side area, 3: an island or area of a region. */
  tier: 1 | 2 | 3;
  x: number;
  y: number;
  chip?: boolean;
  parent?: string;
}

export interface AtlasMarker {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "city" | "town";
  name: string;
  region: string;
}

export interface AtlasData {
  W: number;
  H: number;
  regions: AtlasRegion[];
  markers: AtlasMarker[];
  places: AtlasPlace[];
}

/** World pixels: left, top, right, bottom. */
export type Box = [number, number, number, number];

/** The view: screen x = world x · s + tx, screen y = world y · s · k + ty. */
export interface AtlasView {
  s: number;
  tx: number;
  ty: number;
  /** How much taller than wide the map is drawn: 1, except on the guess map's open dock showing the whole world (see Stretch). */
  k?: number;
}

/**
 * The guess map's open dock draws the whole world taller than it is, so it
 * fills GeoGuessr's box with no empty sea above and below: the stretch box's
 * width fills the canvas at scale s0, and its height fills it too at that
 * zoom (k = e^L times taller). Zooming in, the stretch eases off smoothly and
 * is gone by e^X times s0 (2 at least), so up close the towns are their own
 * shape. Only the drawing changes: a click still lands on the world point
 * drawn under it.
 */
export interface Stretch {
  s0: number;
  L: number;
  X: number;
}
/** Beyond this the box is too tall for the world to fill it gracefully: it shows the world as it is instead. */
export const MAX_STRETCH = 1.9;

/** The stretch that makes `box` fill a W×H canvas, or null where it would be under 1 or over MAX_STRETCH. */
export function stretchFor(W: number, H: number, box: Box): Stretch | null {
  if (!(W > 0 && H > 0)) return null;
  const s0 = W / (box[2] - box[0]);
  const k = H / (box[3] - box[1]) / s0;
  if (!(k >= 1 && k <= MAX_STRETCH)) return null;
  const L = Math.log(k);
  // Gone by twice the whole world's zoom, or later for a bigger stretch, so the map never gets shorter as you zoom in.
  return { s0, L, X: Math.max(Math.LN2, 2 * L) };
}

/** A map's stretch: only a dock (home.stretch) while it's open; every other map is drawn as it is. */
export function stretchOf(home: AtlasOptions["home"], W: number, H: number): Stretch | null {
  return home?.stretch && home.open?.(W, H) ? stretchFor(W, H, home.stretch) : null;
}

/**
 * The vertical scale (CSS px per world px down the map) at horizontal scale s.
 * In log terms it runs from the full stretch at s0 to plain s at X along a
 * curve that meets s with no kink and never falls as s grows.
 */
export function verticalScale(s: number, st: Stretch | null): number {
  if (!st) return s;
  const x = Math.log(s / st.s0);
  if (x >= st.X) return s;
  if (x <= 0) return s * Math.exp(st.L);
  const a = st.L / (st.X * st.X);
  const c = 1 - (2 * st.L) / st.X;
  return st.s0 * Math.exp(st.L + c * x + a * x * x);
}

/** World pixels → CSS px on the canvas. */
export const screenOf = (v: AtlasView, wx: number, wy: number): [number, number] => [wx * v.s + v.tx, wy * v.s * (v.k ?? 1) + v.ty];
/** CSS px on the canvas → the world pixel drawn there. */
export const worldOf = (v: AtlasView, px: number, py: number): [number, number] => [(px - v.tx) / v.s, (py - v.ty) / (v.s * (v.k ?? 1))];
/** The canvas transform the map is drawn with (before the device pixel ratio): world pixels to CSS px. */
export const drawMatrix = (v: AtlasView): [number, number, number, number, number, number] => [v.s, 0, 0, v.s * (v.k ?? 1), v.tx, v.ty];
/** The view zoomed to scale s2 about screen point (cx, cy): the world point there stays there, the stretch changing with the zoom. */
export function zoomedAbout(v: AtlasView, s2: number, cx: number, cy: number, st: Stretch | null): AtlasView {
  const k = verticalScale(s2, st) / s2;
  return { s: s2, tx: cx - (cx - v.tx) * (s2 / v.s), ty: cy - (cy - v.ty) * ((s2 * k) / verticalScale(v.s, st)), k };
}

export interface AtlasOptions {
  /** A region's map: the view starts framed on it and the rest of the world is dimmed. Default: the whole world. */
  bounds?: Box;
  /** Atlas page: a click on a place, on a region's area, or on empty sea (null). */
  onPick?: (pick: { place: AtlasPlace } | { region: AtlasRegion } | null) => void;
  /** Games: a click (not a drag) at world pixels (x, y). */
  onTap?: (x: number, y: number) => void;
  /** Every frame drawn once the map has its size, for overlays that follow the map. */
  onView?: (view: AtlasView) => void;
  onZoom?: (label: string) => void;
  /**
   * Where the view starts (and stays until the viewer moves it): this box,
   * filling the canvas (`cover`: the box's shorter side fits, the rest is a
   * drag away) instead of the whole map. "Show the whole map" still shows it all.
   * `scale`: a fixed zoom centred on the box (or `at`) instead (the guess map's dock: the
   * same zoom when the box grows, so a bigger box shows more); `floor`: zooming
   * out stops once this box fills the canvas (times `floorZoom`: a little closer,
   * so less empty sea shows above and below a wide world), and the view never
   * pans off it. `open`: while it says the canvas is open (the dock hovered),
   * the view starts on the whole floor box instead (the whole world, as large
   * as the box allows) and goes back to `scale` once it's closed.
   * `stretch`: while open, the whole world shown is this box, drawn taller to fill the canvas (see Stretch);
   * where the canvas's shape needs too much (or too little) stretch, `floor` as it is instead.
   */
  home?: { box: Box; cover?: boolean; scale?: () => number; at?: [number, number]; floor?: Box; floorZoom?: number; open?: (W: number, H: number) => boolean; stretch?: Box };
  /** The guess map: small, thin region names (GeoGuessr's), so they label a region without covering it. */
  quietLabels?: boolean;
  /** A page in another language: the names the map writes, English → that language's (names not in it stay English). */
  names?: Record<string, string>;
  /** Called once, after the first frame drawn with as much of the map's detail as the view needs. */
  onSharp?: () => void;
  /**
   * The guess map: each town and city dot shows only once there's room for
   * it (see dotSpacing), fading in, and none on the whole world zoomed out.
   * Without it (the atlas page) every dot always shows.
   */
  spacedDots?: boolean;
  /**
   * The whole world's guess map (GeoGuessr's): the map repeats sideways, so it
   * drags left or right forever (up and down stay clamped). Copies of the same
   * map are drawn at x ± the map's width; the map itself never moves. A tap on
   * any copy lands on the world point it shows (x back in [0, W)), and camera
   * moves glide to the nearest copy of their target. Ignored on a region's
   * map (bounds).
   */
  wrapX?: boolean;
}

/** The copies of a map repeating sideways every `period` world px that lie across screen x 0 to `width` (plus `margin` px either side), as world-px shifts, left to right. */
export function wrapShifts(v: AtlasView, width: number, period: number, margin = 0): number[] {
  const step = period * v.s;
  const a = Math.floor((-margin - v.tx) / step);
  const b = Math.floor((width + margin - v.tx) / step);
  const out: number[] = [];
  for (let n = a; n <= b; n++) out.push(n * period);
  return out;
}
/** x in [0, period). */
export const wrapMod = (x: number, period: number) => ((x % period) + period) % period;

export interface AtlasEngine {
  flyTo: (x: number, y: number, zoom: "region" | "place" | "world") => Promise<void>;
  /** Zoom to show a box of the world, never closer than `min` world pixels across; `duration` (ms) eases out instead of the default glide. */
  /** `room`: how much bigger than the box the view is (1.5 by default; 1, the box fills it). */
  fitBox: (box: Box, min?: number, duration?: number, room?: number) => Promise<void>;
  /** Back to the whole map (the world, or the region's box). */
  reset: () => void;
  /** Back to where the map started, at once (a new round on the same map). */
  recenter: () => void;
  zoomBy: (factor: number) => void;
  setSelected: (place: AtlasPlace | null) => void;
  destroy: () => void;
}

const SEA = "#165c96";
/** A wrapping map's loop line (Google Maps' dashed boundaries): dark navy, faint, 6 px dashes with 5 px gaps. */
const SEAM_COLOR = "rgba(8, 20, 44, 0.4)";
const SEAM_DASH = [6, 5];
/** A moving map is redrawn at full quality this long (ms) after it stops. */
const MOTION_SETTLE_MS = 120;
/** Spaced dots: a dot shows once its nearest neighbour is at least this many CSS px away on screen. */
export const DOT_SPACING_PX = 16;
/** Spaced dots fade in (and out) over this long. */
const DOT_FADE_MS = 150;
/** Spaced dots on a map of the whole world: none until it's zoomed in this far past the whole world. */
const WORLD_DOTS_FROM = 2;
/** A dock zoomed in from the start (home.scale): dots come in once zoomed past that by this much (one zoom click is 1.6). */
const DOCK_DOTS_FROM = 1.5;

const nearestCache = new WeakMap<AtlasMarker[], Float64Array>();
/**
 * Each marker's distance to its nearest neighbour, in world pixels: worked
 * out once per atlas. A dot shows when that distance times the zoom reaches
 * DOT_SPACING_PX, so a dense area's dots come in later than a sparse one's
 * and they never smear together.
 */
export function nearestDistances(markers: AtlasMarker[]): Float64Array {
  let out = nearestCache.get(markers);
  if (out) return out;
  out = new Float64Array(markers.length).fill(Infinity);
  for (let i = 0; i < markers.length; i++)
    for (let j = i + 1; j < markers.length; j++) {
      const d = Math.hypot(markers[i].x - markers[j].x, markers[i].y - markers[j].y);
      if (d < out[i]) out[i] = d;
      if (d < out[j]) out[j] = d;
    }
  nearestCache.set(markers, out);
  return out;
}

/** Whether a spaced dot shows at scale `s` (CSS px per world px). */
export const dotShows = (nearest: number, s: number) => nearest * s >= DOT_SPACING_PX;
/** A spaced dot's radius in CSS px: 3 on a whole-world or region view, growing gently to 5 as you zoom in (by 8× from REF_SCALE). */
export const dotRadius = (s: number) => Math.min(5, Math.max(3, 3 + (2 * Math.log2(Math.max(1, s / REF_SCALE))) / 3));
const MAX_SCALE = 9;
/** Scale of the whole world on a desktop-sized atlas; labels and markers grow from here. */
const REF_SCALE = 0.2;
/** Side areas' names (DLC, Kitakami, the Sevii Islands) show from this zoom (a share of REF_SCALE); main regions' always do. */
const TIER2_FROM = 0.7;

let atlasData: Promise<AtlasData> | null = null;
/** The atlas's places and labels, fetched once and shared by every map on the page. */
export function loadAtlas(): Promise<AtlasData> {
  atlasData ??= fetch("/atlas/atlas.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`atlas ${r.status}`))));
  atlasData.catch(() => (atlasData = null));
  return atlasData;
}

/** A copy of a map image: drawn at `scale` of the map's own size. */
type Level = { img: CanvasImageSource; scale: number };

/**
 * Maps that come with pre-shrunk copies (scripts/geo/world-map-copies.mjs),
 * smallest first: the quarter copy draws the whole world, and each bigger
 * one is fetched only once the view is zoomed in far enough to need it, so a
 * phone never decodes the 15-megapixel original just to show the world.
 */
export const MAP_COPIES: Record<string, { src: string; width: number }[]> = {
  "/geo/maps/world.webp": [
    { src: "/geo/maps/world-1463.webp", width: 1463 },
    { src: "/geo/maps/world-2925.webp", width: 2925 },
    { src: "/geo/maps/world.webp", width: 5850 },
  ],
};
const copiesOf = (src: string) => MAP_COPIES[src] ?? [{ src, width: 0 }];

/**
 * A picture fetched and decoded off the main thread (createImageBitmap, or
 * an image's decode() where that's missing), so no frame waits on it.
 */
async function decodeOffThread(src: string): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`map ${src} ${res.status}`);
    return createImageBitmap(await res.blob());
  }
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

const levelCache = new Map<string, Promise<Level[]>>();
/**
 * One copy of a map, decoded once and shared by every map on the page. The
 * smallest copy also gets a halved one, for the most zoomed-out views.
 */
function loadLevel(copy: { src: string; width: number }, smallest: boolean, mapWidth: number): Promise<Level[]> {
  let p = levelCache.get(copy.src);
  if (!p) {
    p = decodeOffThread(copy.src).then(async (img) => {
      const w = copy.width || (img as ImageBitmap).width;
      const scale = w / mapWidth;
      const out: Level[] = [{ img, scale }];
      if (smallest && typeof createImageBitmap === "function" && img instanceof ImageBitmap && img.width > 900) {
        const half = await createImageBitmap(img, { resizeWidth: Math.round(img.width / 2), resizeHeight: Math.round(img.height / 2), resizeQuality: "high" }).catch(() => null);
        if (half) out.push({ img: half, scale: scale / 2 });
      }
      return out;
    });
    p.catch(() => levelCache.delete(copy.src));
    levelCache.set(copy.src, p);
  }
  return p;
}

/** The map's smallest copy, fetched and decoded: once it resolves, a map drawing `src` shows at once. */
export function mapReady(src: string, mapWidth = 5850): Promise<void> {
  const [first] = copiesOf(src);
  return loadLevel(first, true, mapWidth).then(() => undefined);
}

export function createAtlas(canvas: HTMLCanvasElement, stage: HTMLElement, atlas: AtlasData, src: string, opts: AtlasOptions = {}): AtlasEngine {
  const ctx = canvas.getContext("2d")!;
  const bounds: Box = opts.bounds ?? [0, 0, atlas.W, atlas.H];
  const locked = !!opts.bounds;
  /** The map repeats sideways (see AtlasOptions.wrapX): every `period` world px. */
  const wrap = !!opts.wrapX && !locked;
  const period = atlas.W;
  /** Labels and dots of a copy just off screen can still reach onto it: copies this many CSS px past either edge are drawn too. */
  const WRAP_MARGIN = 160;
  /** The copies to draw (world-px shifts, left to right): just the map itself unless it wraps. */
  const shifts = (): number[] => (wrap && W > 0 ? wrapShifts(view, W, period, WRAP_MARGIN) : [0]);
  let W = 0;
  let H = 0;
  let dpr = 1;
  let minS = 0.1;
  /** The floor an exact whole-map fit has dropped the zoom to (see fitBox), kept through resizes. */
  let fitFloor = Infinity;
  /** The dock is open (hovered or pinned), and its stretch while it shows the whole world (null: drawn as it is). */
  let open = false;
  let stretch: Stretch | null = null;
  /** The vertical scale at scale s (s itself without a stretch). */
  const vsc = (s: number) => verticalScale(s, stretch);
  /** The box the view stays on: the stretch box while stretched, else the dock's floor. */
  const floorBox = (): Box | undefined => (stretch ? opts.home?.stretch : opts.home?.floor);
  let selected: AtlasPlace | null = null;
  let anim = 0;
  let touched = false;
  let alive = true;
  /** The copies decoded so far, by scale (smallest first). */
  let levels: Level[] = [];
  const copies = copiesOf(src);
  /** Spaced dots: each one's nearest neighbour, and how far it has faded in (0–1). */
  const nearest = opts.spacedDots ? nearestDistances(atlas.markers) : null;
  const dotAlpha = new Float32Array(atlas.markers.length);
  let lastDraw = 0;
  /** When the view last moved (a glide, a zoom step, a drag or a pinch): frames in motion scale the map more cheaply. */
  let lastMove = 0;
  let settle = 0;
  /** The view is moving: cheap frames now, and one full-quality frame once it has stopped. */
  function moving() {
    lastMove = performance.now();
    window.clearTimeout(settle);
    settle = window.setTimeout(() => alive && requestDraw(), MOTION_SETTLE_MS);
  }
  /** A fit asked for before the canvas had a size. */
  let pending: (() => void) | null = null;
  /** The canvas has been sized (the ResizeObserver's first call): until then input has nowhere to land. */
  const sized = () => W > 0 && H > 0;
  const view: AtlasView = { s: 0.3, tx: 0, ty: 0 };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The site's fonts (next/font names them; the canvas needs the real family names).
  const css = getComputedStyle(canvas);
  const fonts = {
    display: css.getPropertyValue("--font-display").trim() || "'Chakra Petch'",
    sans: css.getPropertyValue("--font-body").trim() || "Inter",
    pixel: css.getPropertyValue("--font-pixel").trim() || "Silkscreen",
  };

  /** Fetches a copy (once), and draws again when it's in. */
  const asked = new Set<number>();
  let sharp = false;
  function want(i: number) {
    if (asked.has(i)) return;
    asked.add(i);
    void loadLevel(copies[i], i === 0, atlas.W).then(
      (got) => {
        levels = [...levels, ...got].sort((a, b) => a.scale - b.scale);
        if (alive) requestDraw();
      },
      () => asked.delete(i)
    );
  }
  want(0);

  let queued = false;
  function requestDraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!alive) return;
      // Already drawn this frame (a glide or a zoom step draws each frame): look again next frame instead.
      if (performance.now() - lastDraw < 4) requestDraw();
      else draw();
    });
  }

  /** The view that shows a box of the world (with a little room around it). */
  const fitTo = ([x0, y0, x1, y1]: Box, room = 1): AtlasView => {
    const s = Math.min(W / ((x1 - x0) * room), fitHeight(H / ((y1 - y0) * room)));
    return { s, tx: W / 2 - ((x0 + x1) / 2) * s, ty: H / 2 - ((y0 + y1) / 2) * vsc(s) };
  };
  /** The scale whose vertical scale is v: v itself without a stretch (the stretch is at most MAX_STRETCH, and never falls). */
  function fitHeight(v: number) {
    if (!stretch) return v;
    let lo = v / MAX_STRETCH;
    let hi = v;
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (vsc(mid) > v) hi = mid;
      else lo = mid;
    }
    return lo;
  }
  const fitWorld = () => fitTo([0, 0, atlas.W, atlas.H]);
  const whole = () => fitTo(bounds, locked ? 1.04 : 1);
  /** Region names in the order they claim room: the map's own first (a locked region's), then main regions, side areas, islands. */
  const inBounds = (r: AtlasRegion) => r.x >= bounds[0] && r.x <= bounds[2] && r.y >= bounds[1] && r.y <= bounds[3];
  const regionOrder = [...atlas.regions].sort((a, b) => Number(inBounds(b)) - Number(inBounds(a)) || a.tier - b.tier);
  /** The view to frame until the viewer moves: the start box, or the whole map once they've asked for it. */
  let framing: "start" | "whole" = opts.home ? "start" : "whole";
  const home = (): AtlasView => {
    if (framing === "whole" || !opts.home) return whole();
    const [x0, y0, x1, y1] = opts.home.box;
    if (opts.home.scale) {
      const floor = floorBox();
      if (floor && open) {
        const [fx0, fy0, fx1, fy1] = floor;
        return { s: minS, tx: W / 2 - ((fx0 + fx1) / 2) * minS, ty: H / 2 - ((fy0 + fy1) / 2) * vsc(minS) };
      }
      const s = Math.max(minS, opts.home.scale());
      const [cx, cy] = opts.home.at ?? [(x0 + x1) / 2, (y0 + y1) / 2];
      return { s, tx: W / 2 - cx * s, ty: H / 2 - cy * vsc(s) };
    }
    if (!opts.home.cover) return fitTo(opts.home.box);
    const s = Math.max(W / (x1 - x0), H / (y1 - y0));
    return { s, tx: W / 2 - ((x0 + x1) / 2) * s, ty: H / 2 - ((y0 + y1) / 2) * vsc(s) };
  };

  /** Zoom within limits, and never pan off the world. */
  function clamp() {
    view.s = Math.min(MAX_SCALE, Math.max(minS, view.s));
    const vs = vsc(view.s);
    // A wrapping map pans sideways forever: the middle's x is only brought back onto the map itself (by whole widths, so nothing
    // drawn moves), keeping tx small.
    const rawCx = (W / 2 - view.tx) / view.s;
    let cx = wrap ? wrapMod(rawCx, period) : Math.min(atlas.W, Math.max(0, rawCx));
    let cy = Math.min(atlas.H, Math.max(0, (H / 2 - view.ty) / vs));
    // With a floor (the guess map's dock), the view stays on that box: centred on it where the view is wider or taller than it
    // (zoomed right out, the whole world sits in the middle), never panned past its edges otherwise.
    const floor = floorBox();
    if (floor) {
      const [fx0, fy0, fx1, fy1] = floor;
      const hw = W / 2 / view.s;
      const hh = H / 2 / vs;
      if (!wrap) cx = fx1 - fx0 <= 2 * hw ? (fx0 + fx1) / 2 : Math.min(fx1 - hw, Math.max(fx0 + hw, cx));
      cy = fy1 - fy0 <= 2 * hh ? (fy0 + fy1) / 2 : Math.min(fy1 - hh, Math.max(fy0 + hh, cy));
    }
    // Normalised by whole widths, the view is drawn exactly as before (to the float): no snap.
    view.tx = wrap ? view.tx + (rawCx - cx) * view.s : W / 2 - cx * view.s;
    view.ty = H / 2 - cy * vs;
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    // The world point in the middle stays there when the map grows or shrinks.
    const cx = W ? (W / 2 - view.tx) / view.s : 0;
    const cy = H ? (H / 2 - view.ty) / vsc(view.s) : 0;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    open = !!opts.home?.open?.(W, H);
    stretch = stretchOf(opts.home, W, H);
    // Zoomed right out: the stretched whole world fills the canvas; else the floor box fits it (or a little past the whole map).
    minS = stretch ? stretch.s0 : opts.home?.floor ? fitTo(opts.home.floor).s * (opts.home.floorZoom ?? 1) : Math.min(fitWorld().s * 0.8, fitFloor);
    // Keep the whole map framed until the viewer starts exploring.
    if (!touched) Object.assign(view, home());
    else Object.assign(view, { tx: W / 2 - cx * view.s, ty: H / 2 - cy * vsc(view.s) });
    clamp();
    draw();
    if (pending && W && H) {
      const fit = pending;
      pending = null;
      fit();
    }
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    const { s, tx, ty } = view;
    const vs = vsc(s);
    const offs = shifts();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * s, 0, 0, dpr * vs, dpr * tx, dpr * ty);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = performance.now() - lastMove < MOTION_SETTLE_MS ? "low" : "high";
    // The smallest copy with enough detail for this zoom, along its more zoomed axis (a bigger one is fetched once it's needed).
    const need = (vs * dpr) / 1.5;
    const ideal = copies.findIndex((c) => (c.width ? c.width / atlas.W : 1) >= need);
    want(ideal < 0 ? copies.length - 1 : ideal);
    if (levels.length) {
      const lvl = levels.find((l) => l.scale >= need) ?? levels[levels.length - 1];
      // A wrapping map: the same decoded copy again at each width to either side that's on screen (the map's edges are open sea).
      if (!wrap) ctx.drawImage(lvl.img, 0, 0, atlas.W, atlas.H);
      else {
        // Each copy draws only its part that's on screen (a couple of the picture's pixels past it, so the edges filter the
        // same), so two copies across the seam cost what one map does.
        const { width: iw, height: ih } = lvl.img as ImageBitmap;
        const kx = iw / atlas.W;
        const ky = ih / atlas.H;
        const sy0 = Math.max(0, Math.floor((-ty / vs) * ky) - 2);
        const sy1 = Math.min(ih, Math.ceil(((H - ty) / vs) * ky) + 2);
        for (const off of offs) {
          const sx0 = Math.max(0, Math.floor(((-tx / s) - off) * kx) - 2);
          const sx1 = Math.min(iw, Math.ceil((((W - tx) / s) - off) * kx) + 2);
          if (sx1 <= sx0 || sy1 <= sy0) continue;
          ctx.drawImage(lvl.img, sx0, sy0, sx1 - sx0, sy1 - sy0, off + sx0 / kx, sy0 / ky, (sx1 - sx0) / kx, (sy1 - sy0) / ky);
        }
      }
      // Sharp enough for this view (or the biggest copy there is): tell the page once.
      const biggest = copies[copies.length - 1].width ? copies[copies.length - 1].width / atlas.W : 1;
      if (!sharp && sized() && (lvl.scale >= need || lvl.scale >= biggest)) {
        sharp = true;
        if (opts.onSharp) requestAnimationFrame(() => alive && opts.onSharp?.());
      }
    }

    // Where a wrapping map loops: a thin dashed line down each copy's edge (GeoGuessr's date line), in CSS px so it looks the
    // same at every zoom, anchored to the map's top so its dashes move with the map. Under the dots, names and pins.
    if (wrap) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.strokeStyle = SEAM_COLOR;
      ctx.lineWidth = 1.25;
      ctx.setLineDash(SEAM_DASH);
      ctx.lineDashOffset = 0;
      // Only the part on screen is stroked, starting a whole number of dashes down so the pattern stays put.
      const dashStep = SEAM_DASH[0] + SEAM_DASH[1];
      const y0 = ty < 0 ? ty + Math.floor(-ty / dashStep) * dashStep : ty;
      const y1 = Math.min(H, atlas.H * vs + ty);
      ctx.beginPath();
      for (const off of [...offs, offs[offs.length - 1] + period]) {
        const x = off * s + tx;
        if (x < -2 || x > W + 2) continue;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      ctx.stroke();
      ctx.restore();
    }

    const f = s / REF_SCALE;
    const now = performance.now();
    const dt = lastDraw ? now - lastDraw : DOT_FADE_MS;
    lastDraw = now;
    // A map of the whole world shows no dots zoomed out (just the region names); a region's map shows those that have room.
    const dotsAllowed = locked || (opts.home?.scale ? s >= opts.home.scale() * DOCK_DOTS_FROM : s >= fitWorld().s * WORLD_DOTS_FROM);
    let fading = false;
    // Spaced dots are drawn in CSS px, so they stay round on a stretched map.
    if (nearest) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < atlas.markers.length; i++) {
      const m = atlas.markers[i];
      const city = m.kind === "city";
      if (nearest) {
        const goal = dotsAllowed && dotShows(nearest[i], s) ? 1 : 0;
        const step = reduceMotion ? 1 : dt / DOT_FADE_MS;
        const alpha = (dotAlpha[i] = goal > dotAlpha[i] ? Math.min(goal, dotAlpha[i] + step) : Math.max(goal, dotAlpha[i] - step));
        if (alpha !== goal) fading = true;
        if (alpha <= 0) continue;
        // A round dot with a dark rim: 3 px in radius when it first shows, 5 px zoomed in.
        const r = dotRadius(s);
        const py = m.y * vs + ty;
        ctx.globalAlpha = alpha;
        for (const off of offs) {
          const px = (m.x + off) * s + tx;
          if (wrap && (px < -r || px > W + r)) continue;
          ctx.fillStyle = city ? "#6e1626" : "#1d3878";
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = city ? "#e2475b" : "#4d7ee8";
          ctx.beginPath();
          ctx.arc(px, py, r - 1.25, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      // Small dots from afar, full-size buildings up close.
      const px = f < 1.6 ? (city ? 5 : 4) : f < 3 ? (city ? 8 : 6) : city ? 10 : 8;
      const w = Math.max(m.w, px / s);
      const h = Math.max(m.h, px / s);
      const e = 2.5 / s;
      for (const off of offs) {
        const x = m.x + off;
        ctx.fillStyle = city ? "#6e1626" : "#1d3878";
        roundRect(x - w / 2 - e, m.y - h / 2 - e, w + 2 * e, h + 2 * e, 3 / s);
        ctx.fill();
        ctx.fillStyle = city ? "#e2475b" : "#4d7ee8";
        roundRect(x - w / 2, m.y - h / 2, w, h, 2 / s);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.35)";
        ctx.fillRect(x - w / 2, m.y - h / 2, w, h * 0.32);
      }
    }
    ctx.globalAlpha = 1;
    // A dot still fading in or out draws again next frame.
    if (fading) requestDraw();
    // How many dots are up, for the browser checks.
    if (nearest) canvas.dataset.dots = String(dotAlpha.reduce((n, a) => n + (a > 0 ? 1 : 0), 0));
    if (selected) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      for (const off of offs) {
        ctx.beginPath();
        ctx.arc((selected.x + off) * s + tx, selected.y * vs + ty, 22 + 6 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    drawLabels(f, offs);
    if (locked) {
      // Everything outside the region's map is dimmed.
      const [x0, y0, x1, y1] = bounds;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "rgba(6, 14, 28, 0.6)";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(x0 * s + tx, y0 * vs + ty, (x1 - x0) * s, (y1 - y0) * vs);
      ctx.fill("evenodd");
    }
    opts.onZoom?.(s < fitWorld().s * 2.2 ? "World" : s < 0.9 ? "Region" : s < 1.6 ? "Towns + routes" : "Close up");
    // Before the first sizing the view is a placeholder: overlays wait for the real one.
    if (sized()) opts.onView?.({ ...view, k: vs / s });
  }

  const widths = new Map<string, number>();
  /** `offs`: the copies on screen (world-px shifts, left to right); every label is tried on each, in that order, so a wrapping map's names are the same on every copy. */
  function drawLabels(f: number, offs: number[]) {
    const { s, tx, ty } = view;
    const vs = vsc(s);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const fits = (x: number, y: number, w: number, h: number) => {
      if (x + w < 0 || y + h < 0 || x > W || y > H) return false;
      for (const b of boxes) if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return false;
      boxes.push({ x, y, w, h });
      return true;
    };
    // A label of one or more lines ("\n"), centred on its point; skipped if it would overlap one already drawn.
    // `keepIn`: a region's name whose point is on screen slides in from the edge rather than being cut off by it.
    const label = (text: string, wx: number, wy: number, font: string, size: number, dy: number, color: string, track = 0, dx = 0, keepIn = false, quiet = false): boolean => {
      let x = wx * s + tx + dx;
      const y = wy * vs + ty + dy;
      // A wrapping map tries each name on every copy: those far off screen are skipped before they're measured.
      if (wrap && (x < -WRAP_MARGIN || x > W + WRAP_MARGIN)) return false;
      // A quiet name whose place is off the map isn't drawn, rather than showing a sliver of it at the edge.
      if (quiet && (x < 0 || x > W || y < 0 || y > H)) return false;
      ctx.font = font.replace("SIZE", `${size}px`);
      ctx.letterSpacing = `${track}px`;
      const lines = text.split("\n");
      const lineH = size + 2;
      let w = 0;
      for (const line of lines) {
        const key = `${line}|${ctx.font}|${track}`;
        let lw = widths.get(key);
        if (lw === undefined) {
          lw = ctx.measureText(line).width;
          widths.set(key, lw);
        }
        w = Math.max(w, lw);
      }
      // Room around each label, so two never run together into one ("JOHTO KANTO"): the later (lower-priority) one waits for more zoom.
      // Quiet names are small enough to sit level with a close neighbour (Johto beside Kanto), so they need less room; the open
      // dock's whole world, a size smaller, keeps a little more, so Johto still steps aside from Kanto instead of reading as one.
      const padX = quiet ? (open ? Math.max(2, size * 0.4) : 2) : Math.max(3, size * 0.4);
      const padY = Math.max(1, size * 0.15);
      if (keepIn && x >= 0 && x <= W && w + 2 * padX < W) x = Math.min(W - w / 2 - padX, Math.max(w / 2 + padX, x));
      // A quiet name (capitals, no descenders) claims only its own height, so a neighbour can sit just above or below it.
      if (!fits(x - w / 2 - padX, y - size - padY, w + 2 * padX, size + (quiet ? 2 : 6) + (lines.length - 1) * lineH + 2 * padY)) return false;
      ctx.lineWidth = quiet ? 2 : Math.max(3, size / 4);
      ctx.strokeStyle = "rgba(8,18,32,.88)";
      ctx.lineJoin = "round";
      ctx.textAlign = "center";
      ctx.fillStyle = color;
      lines.forEach((line, i) => {
        ctx.strokeText(line, x, y + i * lineH);
        ctx.fillText(line, x, y + i * lineH);
      });
      return true;
    };
    /** Where a route's name may go when a town already sits on its point: just below, above, or to either side. */
    const ROUTE_SPOTS: [number, number][] = [[0, 4], [0, 22], [0, -14], [34, 4], [-34, 4]];
    // Paldea's areas are routes with long names: "South Province (Area Three)" goes on two lines.
    const routeText = (name: string) => name.replace(/^(.+?) \((Area .+)\)$/, "$1\n$2");
    const { display, sans, pixel } = fonts;
    const local = opts.names;
    const nm = (name: string) => (local ? (local[name] ?? name) : name);

    if (selected) for (const off of offs) label(nm(selected.name), selected.x + off, selected.y, `700 SIZE ${sans}, system-ui`, 15, -20, "#ffe08a");
    if (f < 4.5) {
      for (const r of regionOrder) {
        const quiet = opts.quietLabels;
        // Quiet names scale with the map's width (9 px on a 300 px map, up to 12 on a wide one) and grow a little zoomed in, up to
        // 3 px more; the open dock's whole world starts them 1 px smaller (8 px hovered in a 1000×578 window), with the same cap.
        // The atlas's are display-sized.
        const quietCap = Math.min(12, Math.max(9, W / 32)) - (r.tier === 1 ? 0 : 1) + 3;
        const quietBase = quietCap - 3 - (open ? 1 : 0);
        const baseSize = quiet ? quietBase : r.tier === 1 ? 20 : r.tier === 2 ? 14 : 12;
        const size = quiet
          ? Math.round(Math.min(quietCap, baseSize * Math.max(1, Math.pow(f, 0.35))))
          : Math.round(Math.max(baseSize * 0.7, Math.min(baseSize * 1.7, baseSize * Math.pow(f, 0.35))));
        // Small maps keep to the main regions: DLC areas and islands come in as you zoom.
        if ((r.tier === 3 && f < 1.4) || (r.tier === 2 && f < TIER2_FROM)) continue;
        // A main region's name never drops out: if its spot is taken (Johto beside Kanto), it tries just above, below, then to either side.
        // Quiet names first nudge a little to either side, so a crowded one (Johto beside Kanto) stays level and over its own land,
        // then step a full line up or down.
        const up = quiet ? size * 1.6 : size * 1.25;
        const down = quiet ? size * 1.6 : size * 1.35;
        const nudge: [number, number][] = quiet ? [[-size * 0.7, 0], [size * 0.7, 0]] : [];
        const spots: [number, number][] = r.tier === 1 ? [[0, 0], ...nudge, [0, -up], [0, down], [-size * 2.6, 0], [size * 2.6, 0]] : [[0, 0]];
        for (const off of offs)
          spots.some(([dx, dy]) =>
            label(
              r.tier === 1 ? nm(r.name).toUpperCase() : nm(r.name),
              r.x + off,
              r.y,
              `${quiet ? 500 : r.tier === 1 ? 700 : 600} SIZE ${display}, ${sans}, sans-serif`,
              size,
              size / 3 + dy,
              r.tier === 1 ? "#ffffff" : "#d7e6f7",
              quiet ? (r.tier === 1 ? 0.5 : 0.2) : r.tier === 1 ? 2 : 0.5,
              dx,
              true,
              quiet
            )
          );
      }
    }
    if (f >= 2.2) for (const p of atlas.places) if (p.kind === "town") for (const off of offs) label(nm(p.name), p.x + off, p.y, `600 SIZE ${sans}, system-ui`, f > 4 ? 13 : 11, -12, "#ffffff");
    // Routes before landmarks: where both can't fit, the route keeps its name.
    if (f >= 3.6) {
      for (const p of atlas.places) {
        if (p.kind !== "route") continue;
        for (const off of offs) ROUTE_SPOTS.some(([dx, dy]) => label(routeText(nm(p.name)), p.x + off, p.y, `SIZE ${pixel}, monospace`, 10, dy, "#ffe2b5", 0, dx));
      }
    }
    if (f >= 3.6) for (const p of atlas.places) if (p.kind === "landmark") for (const off of offs) label(nm(p.name), p.x + off, p.y, `600 SIZE ${sans}, system-ui`, 11, -10, "#cfe0ff");
    if (f >= 6)
      for (const p of atlas.places)
        for (const off of offs) p.inside?.forEach((b, i) => label(nm(b), p.x + off, p.y, `500 SIZE ${sans}, system-ui`, 11, 18 + i * 14, "#c9f2dc"));
  }

  /** Zoom by k about screen point (cx, cy): eased over a few frames, so wheel notches glide instead of jumping. */
  let zoomGoal: { s: number; cx: number; cy: number } | null = null;
  function zoomAt(k: number, cx: number, cy: number, instant = false) {
    // Nothing to zoom about before the map has a size: a zoom then would leave the view framed on nothing once it does.
    if (!sized()) return;
    touched = true;
    const s2 = Math.min(MAX_SCALE, Math.max(minS, (zoomGoal?.s ?? view.s) * k));
    if (instant || reduceMotion) {
      cancelAnimationFrame(anim);
      zoomGoal = null;
      scaleAbout(s2, cx, cy);
      requestDraw();
      return;
    }
    const gliding = zoomGoal !== null;
    zoomGoal = { s: s2, cx, cy };
    if (!gliding) {
      cancelAnimationFrame(anim);
      anim = requestAnimationFrame(zoomStep);
    }
  }
  function scaleAbout(s2: number, cx: number, cy: number) {
    moving();
    const z = zoomedAbout(view, s2, cx, cy, stretch);
    view.tx = z.tx;
    view.ty = z.ty;
    view.s = s2;
    clamp();
  }
  function zoomStep() {
    if (!alive || !zoomGoal) return;
    const { s: goal, cx, cy } = zoomGoal;
    const ls = Math.log(view.s);
    const lg = Math.log(goal);
    const close = Math.abs(lg - ls) < 0.003;
    scaleAbout(close ? goal : Math.exp(ls + (lg - ls) * 0.3), cx, cy);
    draw();
    // Stop once there, or if the zoom limits leave nowhere to go.
    if (close || Math.abs(Math.log(view.s) - ls) < 1e-6) zoomGoal = null;
    else anim = requestAnimationFrame(zoomStep);
  }

  /** Glide to show world point (wx, wy) at scale s2: 520 ms in and out, or `dur` ms easing out. */
  function glide(wx: number, wy: number, s2: number, dur = 520, easeOut = false): Promise<void> {
    cancelAnimationFrame(anim);
    zoomGoal = null;
    s2 = Math.min(MAX_SCALE, Math.max(minS, s2));
    const from = { ...view };
    // A wrapping map glides to the copy of the target nearest where the view is, never back across the world.
    if (wrap && W) wx += Math.round((W / 2 - from.tx) / from.s / period - wx / period) * period;
    return new Promise((done) => {
      if (reduceMotion || !W) {
        view.s = s2;
        view.tx = W / 2 - wx * s2;
        view.ty = H / 2 - wy * vsc(s2);
        clamp();
        draw();
        done();
        return;
      }
      const t0 = performance.now();
      const fx = (W / 2 - from.tx) / from.s;
      const fy = (H / 2 - from.ty) / vsc(from.s);
      const step = (now: number) => {
        if (!alive) return done();
        const t = Math.min(1, (now - t0) / dur);
        const e = easeOut ? 1 - Math.pow(1 - t, 3) : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        moving();
        view.s = Math.exp(Math.log(from.s) + (Math.log(s2) - Math.log(from.s)) * e);
        view.tx = W / 2 - (fx + (wx - fx) * e) * view.s;
        view.ty = H / 2 - (fy + (wy - fy) * e) * vsc(view.s);
        clamp();
        draw();
        if (t < 1) anim = requestAnimationFrame(step);
        else done();
      };
      anim = requestAnimationFrame(step);
    });
  }

  function flyTo(wx: number, wy: number, zoom: "region" | "place" | "world"): Promise<void> {
    touched = true;
    const fit = fitWorld().s;
    return glide(wx, wy, zoom === "world" ? fit : zoom === "region" ? fit * 5 : fit * 9);
  }

  function fitBox(box: Box, min = 0, duration?: number, room = 1.5): Promise<void> {
    if (!W || !H) {
      pending = () => void fitBox(box, min, duration, room);
      return Promise.resolve();
    }
    touched = true;
    const [x0, y0, x1, y1] = box;
    const w = Math.max(x1 - x0, min);
    const h = Math.max(y1 - y0, min);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const target = fitTo([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], room);
    // A whole map framed exactly (room 1, the end's breakdown) is never clamped bigger and cut off: the floor drops to it.
    if (room <= 1) minS = Math.min(minS, (fitFloor = target.s));
    return duration === undefined ? glide(cx, cy, target.s) : glide(cx, cy, target.s, duration, true);
  }

  function pick(sx: number, sy: number) {
    // The world point drawn under the click, as the map is drawn now (stretched or not).
    const [rx, wy] = worldOf({ ...view, k: vsc(view.s) / view.s }, sx, sy);
    // A tap on any copy of a wrapping map is a tap on the map itself.
    const wx = wrap ? wrapMod(rx, period) : rx;
    if (opts.onTap) return opts.onTap(wx, wy);
    if (!opts.onPick) return;
    const f = view.s / REF_SCALE;
    let best: AtlasPlace | null = null;
    let bd = 16 / view.s;
    if (f >= 2)
      for (const p of atlas.places) {
        const d = Math.hypot(p.x - wx, p.y - wy) * (p.kind === "route" ? 1.3 : 1);
        if (d < bd) [best, bd] = [p, d];
      }
    if (best) return opts.onPick({ place: best });
    // Otherwise the nearest region label, zooming there from afar.
    const r = atlas.regions.reduce((a, b) => (Math.hypot(a.x - wx, a.y - wy) < Math.hypot(b.x - wx, b.y - wy) ? a : b));
    if (Math.hypot(r.x - wx, r.y - wy) < 380) {
      opts.onPick({ region: r });
      if (f < 3) void flyTo(r.x, r.y, "region");
    } else opts.onPick(null);
  }

  // ---- pointer, pinch and wheel --------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; tx: number; ty: number } | null = null;
  /** A wrapping map's drag: the pointer's last few positions (CSS px, ms), for the fling when it's let go. */
  const trail: { x: number; y: number; t: number }[] = [];
  let moved = false;
  let pinch: { d: number; s: number; tx: number; ty: number; cx: number; cy: number } | null = null;

  const onDown = (e: PointerEvent) => {
    // A press before the map has a size can't be placed on it (and a drag from it would frame nothing).
    if (!sized()) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    cancelAnimationFrame(anim);
    zoomGoal = null;
    if (pointers.size === 1) {
      drag = { x: e.offsetX, y: e.offsetY, tx: view.tx, ty: view.ty };
      trail.length = 0;
      moved = false;
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s, tx: view.tx, ty: view.ty, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const s2 = Math.min(MAX_SCALE, Math.max(minS, (pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      // Zoomed about where the fingers started, then moved with them.
      const z = zoomedAbout(pinch, s2, pinch.cx, pinch.cy, stretch);
      view.s = s2;
      view.tx = z.tx + cx - pinch.cx;
      view.ty = z.ty + cy - pinch.cy;
      moved = touched = true;
      moving();
      clamp();
      requestDraw();
    } else if (drag) {
      const dx = e.offsetX - drag.x;
      const dy = e.offsetY - drag.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
      moved = touched = true;
      canvas.style.cursor = "grabbing";
      moving();
      view.tx = drag.tx + dx;
      view.ty = drag.ty + dy;
      if (wrap) {
        trail.push({ x: e.offsetX, y: e.offsetY, t: e.timeStamp });
        if (trail.length > 8) trail.shift();
      }
      clamp();
      requestDraw();
    }
  };
  /**
   * A wrapping map, let go mid-drag, carries on the way it was going and eases
   * to a stop (GeoGuessr's), across the seam like any other pan: each frame is
   * an ordinary pan, normalised by whole widths. Up and down stop at the edge.
   */
  function fling(upAt: number) {
    const last = trail[trail.length - 1];
    // Only a drag still moving when it was let go (a pause first, and it stays put).
    if (reduceMotion || !last || upAt - last.t > 60) return;
    const first = trail.find((p) => last.t - p.t <= 90) ?? last;
    const dt = last.t - first.t;
    if (dt < 8) return;
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    if (Math.hypot(vx, vy) < 0.25) return;
    let prev = performance.now();
    const step = (now: number) => {
      if (!alive) return;
      const ms = Math.min(40, now - prev);
      prev = now;
      moving();
      const ty = view.ty;
      view.tx += vx * ms;
      view.ty += vy * ms;
      clamp();
      // Stopped at the top or bottom: no more drift that way.
      if (Math.abs(view.ty - (ty + vy * ms)) > 0.5) vy = 0;
      draw();
      const decay = Math.exp(-ms / 325);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) > 0.02) anim = requestAnimationFrame(step);
    };
    cancelAnimationFrame(anim);
    anim = requestAnimationFrame(step);
  }
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      canvas.style.cursor = "";
      if (drag && !moved) pick(e.offsetX, e.offsetY);
      else if (drag && wrap) fling(e.timeStamp);
      drag = null;
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels send big steps.
    const k = e.ctrlKey ? 0.012 : e.deltaMode === 1 ? 0.12 : 0.0035;
    // Pinches and trackpads already send many small steps, so they follow the fingers directly.
    zoomAt(Math.exp(-e.deltaY * k), e.offsetX, e.offsetY, e.ctrlKey || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40));
  };
  // In a game a double click is two guesses, not a zoom.
  const onDbl = (e: MouseEvent) => !opts.onTap && zoomAt(2, e.offsetX, e.offsetY);

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDbl);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  void document.fonts?.ready.then(() => alive && draw());

  return {
    flyTo,
    fitBox,
    reset: () => {
      touched = false;
      framing = "whole";
      const h = home();
      void glide((W / 2 - h.tx) / h.s, (H / 2 - h.ty) / vsc(h.s), h.s);
    },
    recenter: () => {
      cancelAnimationFrame(anim);
      zoomGoal = null;
      touched = false;
      framing = opts.home ? "start" : "whole";
      if (!sized()) return;
      Object.assign(view, home());
      clamp();
      requestDraw();
    },
    zoomBy: (factor) => zoomAt(factor, W / 2, H / 2),
    setSelected: (place) => {
      selected = place;
      requestDraw();
    },
    destroy: () => {
      alive = false;
      cancelAnimationFrame(anim);
      window.clearTimeout(settle);
      ro.disconnect();
      // Hand the canvas's pixels back now, rather than whenever the element is collected.
      canvas.width = 0;
      canvas.height = 0;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
    },
  };
}
