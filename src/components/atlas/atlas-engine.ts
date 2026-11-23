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

/** The view: screen x = world x · s + tx. */
export interface AtlasView {
  s: number;
  tx: number;
  ty: number;
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
   * pans off it.
   */
  home?: { box: Box; cover?: boolean; scale?: () => number; at?: [number, number]; floor?: Box; floorZoom?: number };
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
}

export interface AtlasEngine {
  flyTo: (x: number, y: number, zoom: "region" | "place" | "world") => Promise<void>;
  /** Zoom to show a box of the world, never closer than `min` world pixels across; `duration` (ms) eases out instead of the default glide. */
  fitBox: (box: Box, min?: number, duration?: number) => Promise<void>;
  /** Back to the whole map (the world, or the region's box). */
  reset: () => void;
  /** Back to where the map started, at once (a new round on the same map). */
  recenter: () => void;
  zoomBy: (factor: number) => void;
  setSelected: (place: AtlasPlace | null) => void;
  destroy: () => void;
}

const SEA = "#165c96";
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
  let W = 0;
  let H = 0;
  let dpr = 1;
  let minS = 0.1;
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
    const s = Math.min(W / ((x1 - x0) * room), H / ((y1 - y0) * room));
    return { s, tx: W / 2 - ((x0 + x1) / 2) * s, ty: H / 2 - ((y0 + y1) / 2) * s };
  };
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
      const s = Math.max(minS, opts.home.scale());
      const [cx, cy] = opts.home.at ?? [(x0 + x1) / 2, (y0 + y1) / 2];
      return { s, tx: W / 2 - cx * s, ty: H / 2 - cy * s };
    }
    if (!opts.home.cover) return fitTo(opts.home.box);
    const s = Math.max(W / (x1 - x0), H / (y1 - y0));
    return { s, tx: W / 2 - ((x0 + x1) / 2) * s, ty: H / 2 - ((y0 + y1) / 2) * s };
  };

  /** Zoom within limits, and never pan off the world. */
  function clamp() {
    view.s = Math.min(MAX_SCALE, Math.max(minS, view.s));
    let cx = Math.min(atlas.W, Math.max(0, (W / 2 - view.tx) / view.s));
    let cy = Math.min(atlas.H, Math.max(0, (H / 2 - view.ty) / view.s));
    // With a floor (the guess map's dock), the view stays on that box: centred on it where the view is wider or taller than it
    // (zoomed right out, the whole world sits in the middle), never panned past its edges otherwise.
    if (opts.home?.floor) {
      const [fx0, fy0, fx1, fy1] = opts.home.floor;
      const hw = W / 2 / view.s;
      const hh = H / 2 / view.s;
      cx = fx1 - fx0 <= 2 * hw ? (fx0 + fx1) / 2 : Math.min(fx1 - hw, Math.max(fx0 + hw, cx));
      cy = fy1 - fy0 <= 2 * hh ? (fy0 + fy1) / 2 : Math.min(fy1 - hh, Math.max(fy0 + hh, cy));
    }
    view.tx = W / 2 - cx * view.s;
    view.ty = H / 2 - cy * view.s;
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    // The world point in the middle stays there when the map grows or shrinks.
    const cx = W ? (W / 2 - view.tx) / view.s : 0;
    const cy = H ? (H / 2 - view.ty) / view.s : 0;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    minS = opts.home?.floor ? fitTo(opts.home.floor).s * (opts.home.floorZoom ?? 1) : fitWorld().s * 0.8;
    // Keep the whole map framed until the viewer starts exploring.
    if (!touched) Object.assign(view, home());
    else Object.assign(view, { tx: W / 2 - cx * view.s, ty: H / 2 - cy * view.s });
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = performance.now() - lastMove < MOTION_SETTLE_MS ? "low" : "high";
    // The smallest copy with enough detail for this zoom (a bigger one is fetched once it's needed).
    const need = (s * dpr) / 1.5;
    const ideal = copies.findIndex((c) => (c.width ? c.width / atlas.W : 1) >= need);
    want(ideal < 0 ? copies.length - 1 : ideal);
    if (levels.length) {
      const lvl = levels.find((l) => l.scale >= need) ?? levels[levels.length - 1];
      ctx.drawImage(lvl.img, 0, 0, atlas.W, atlas.H);
      // Sharp enough for this view (or the biggest copy there is): tell the page once.
      const biggest = copies[copies.length - 1].width ? copies[copies.length - 1].width / atlas.W : 1;
      if (!sharp && sized() && (lvl.scale >= need || lvl.scale >= biggest)) {
        sharp = true;
        if (opts.onSharp) requestAnimationFrame(() => alive && opts.onSharp?.());
      }
    }

    const f = s / REF_SCALE;
    const now = performance.now();
    const dt = lastDraw ? now - lastDraw : DOT_FADE_MS;
    lastDraw = now;
    // A map of the whole world shows no dots zoomed out (just the region names); a region's map shows those that have room.
    const dotsAllowed = locked || (opts.home?.scale ? s >= opts.home.scale() * DOCK_DOTS_FROM : s >= fitWorld().s * WORLD_DOTS_FROM);
    let fading = false;
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
        const r = dotRadius(s) / s;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = city ? "#6e1626" : "#1d3878";
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = city ? "#e2475b" : "#4d7ee8";
        ctx.beginPath();
        ctx.arc(m.x, m.y, r - 1.25 / s, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // Small dots from afar, full-size buildings up close.
      const px = f < 1.6 ? (city ? 5 : 4) : f < 3 ? (city ? 8 : 6) : city ? 10 : 8;
      const w = Math.max(m.w, px / s);
      const h = Math.max(m.h, px / s);
      const e = 2.5 / s;
      ctx.fillStyle = city ? "#6e1626" : "#1d3878";
      roundRect(m.x - w / 2 - e, m.y - h / 2 - e, w + 2 * e, h + 2 * e, 3 / s);
      ctx.fill();
      ctx.fillStyle = city ? "#e2475b" : "#4d7ee8";
      roundRect(m.x - w / 2, m.y - h / 2, w, h, 2 / s);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fillRect(m.x - w / 2, m.y - h / 2, w, h * 0.32);
    }
    ctx.globalAlpha = 1;
    // A dot still fading in or out draws again next frame.
    if (fading) requestDraw();
    // How many dots are up, for the browser checks.
    if (nearest) canvas.dataset.dots = String(dotAlpha.reduce((n, a) => n + (a > 0 ? 1 : 0), 0));
    if (selected) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3 / s;
      ctx.beginPath();
      ctx.arc(selected.x, selected.y, 22 / s + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawLabels(f);
    if (locked) {
      // Everything outside the region's map is dimmed.
      const [x0, y0, x1, y1] = bounds;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "rgba(6, 14, 28, 0.6)";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(x0 * s + tx, y0 * s + ty, (x1 - x0) * s, (y1 - y0) * s);
      ctx.fill("evenodd");
    }
    opts.onZoom?.(s < fitWorld().s * 2.2 ? "World" : s < 0.9 ? "Region" : s < 1.6 ? "Towns + routes" : "Close up");
    // Before the first sizing the view is a placeholder: overlays wait for the real one.
    if (sized()) opts.onView?.({ ...view });
  }

  const widths = new Map<string, number>();
  function drawLabels(f: number) {
    const { s, tx, ty } = view;
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
      const y = wy * s + ty + dy;
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
      // Quiet names are small enough to sit level with a close neighbour (Johto beside Kanto), so they need less room.
      const padX = quiet ? 2 : Math.max(3, size * 0.4);
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

    if (selected) label(nm(selected.name), selected.x, selected.y, `700 SIZE ${sans}, system-ui`, 15, -20, "#ffe08a");
    if (f < 4.5) {
      for (const r of regionOrder) {
        const quiet = opts.quietLabels;
        const baseSize = quiet ? 8 : r.tier === 1 ? 20 : r.tier === 2 ? 14 : 12;
        // Quiet names stay small (8 px, growing a little zoomed in, to 12); the atlas's are display-sized.
        const size = quiet
          ? Math.round(Math.min(12, baseSize * Math.max(1, Math.pow(f, 0.35))))
          : Math.round(Math.max(baseSize * 0.7, Math.min(baseSize * 1.7, baseSize * Math.pow(f, 0.35))));
        // Small maps keep to the main regions: DLC areas and islands come in as you zoom.
        if ((r.tier === 3 && f < 1.4) || (r.tier === 2 && f < TIER2_FROM)) continue;
        // A main region's name never drops out: if its spot is taken (Johto beside Kanto), it tries just above, below, then to either side.
        // Quiet names step a full line up or down, so a crowded one (Johto beside Kanto) stays over its own land rather than drifting sideways.
        const up = quiet ? size * 1.6 : size * 1.25;
        const down = quiet ? size * 1.6 : size * 1.35;
        const spots: [number, number][] = r.tier === 1 ? [[0, 0], [0, -up], [0, down], [-size * 2.6, 0], [size * 2.6, 0]] : [[0, 0]];
        spots.some(([dx, dy]) =>
          label(
            r.tier === 1 ? nm(r.name).toUpperCase() : nm(r.name),
            r.x,
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
    if (f >= 2.2) for (const p of atlas.places) if (p.kind === "town") label(nm(p.name), p.x, p.y, `600 SIZE ${sans}, system-ui`, f > 4 ? 13 : 11, -12, "#ffffff");
    // Routes before landmarks: where both can't fit, the route keeps its name.
    if (f >= 3.6) {
      for (const p of atlas.places) {
        if (p.kind !== "route") continue;
        ROUTE_SPOTS.some(([dx, dy]) => label(routeText(nm(p.name)), p.x, p.y, `SIZE ${pixel}, monospace`, 10, dy, "#ffe2b5", 0, dx));
      }
    }
    if (f >= 3.6) for (const p of atlas.places) if (p.kind === "landmark") label(nm(p.name), p.x, p.y, `600 SIZE ${sans}, system-ui`, 11, -10, "#cfe0ff");
    if (f >= 6)
      for (const p of atlas.places)
        p.inside?.forEach((b, i) => label(nm(b), p.x, p.y, `500 SIZE ${sans}, system-ui`, 11, 18 + i * 14, "#c9f2dc"));
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
    const r = s2 / view.s;
    view.tx = cx - (cx - view.tx) * r;
    view.ty = cy - (cy - view.ty) * r;
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
    return new Promise((done) => {
      if (reduceMotion || !W) {
        view.s = s2;
        view.tx = W / 2 - wx * s2;
        view.ty = H / 2 - wy * s2;
        clamp();
        draw();
        done();
        return;
      }
      const t0 = performance.now();
      const fx = (W / 2 - from.tx) / from.s;
      const fy = (H / 2 - from.ty) / from.s;
      const step = (now: number) => {
        if (!alive) return done();
        const t = Math.min(1, (now - t0) / dur);
        const e = easeOut ? 1 - Math.pow(1 - t, 3) : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        moving();
        view.s = Math.exp(Math.log(from.s) + (Math.log(s2) - Math.log(from.s)) * e);
        view.tx = W / 2 - (fx + (wx - fx) * e) * view.s;
        view.ty = H / 2 - (fy + (wy - fy) * e) * view.s;
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

  function fitBox(box: Box, min = 0, duration?: number): Promise<void> {
    if (!W || !H) {
      pending = () => void fitBox(box, min, duration);
      return Promise.resolve();
    }
    touched = true;
    const [x0, y0, x1, y1] = box;
    const w = Math.max(x1 - x0, min);
    const h = Math.max(y1 - y0, min);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const target = fitTo([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], 1.5);
    return duration === undefined ? glide(cx, cy, target.s) : glide(cx, cy, target.s, duration, true);
  }

  function pick(sx: number, sy: number) {
    const wx = (sx - view.tx) / view.s;
    const wy = (sy - view.ty) / view.s;
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
      const k = s2 / pinch.s;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      view.s = s2;
      view.tx = cx - (pinch.cx - pinch.tx) * k;
      view.ty = cy - (pinch.cy - pinch.ty) * k;
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
      clamp();
      requestDraw();
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      canvas.style.cursor = "";
      if (drag && !moved) pick(e.offsetX, e.offsetY);
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
      void glide((W / 2 - h.tx) / h.s, (H / 2 - h.ty) / h.s, h.s);
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
