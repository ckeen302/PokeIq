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
  /** Every frame drawn, for overlays that follow the map. */
  onView?: (view: AtlasView) => void;
  onZoom?: (label: string) => void;
}

export interface AtlasEngine {
  flyTo: (x: number, y: number, zoom: "region" | "place" | "world") => Promise<void>;
  /** Zoom to show a box of the world, never closer than `min` world pixels across; `duration` (ms) eases out instead of the default glide. */
  fitBox: (box: Box, min?: number, duration?: number) => Promise<void>;
  /** Back to the whole map (the world, or the region's box). */
  reset: () => void;
  zoomBy: (factor: number) => void;
  setSelected: (place: AtlasPlace | null) => void;
  destroy: () => void;
}

const SEA = "#165c96";
const MAX_SCALE = 9;
/** Scale of the whole world on a desktop-sized atlas; labels and markers grow from here. */
const REF_SCALE = 0.2;

let atlasData: Promise<AtlasData> | null = null;
/** The atlas's places and labels, fetched once and shared by every map on the page. */
export function loadAtlas(): Promise<AtlasData> {
  atlasData ??= fetch("/atlas/atlas.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`atlas ${r.status}`))));
  atlasData.catch(() => (atlasData = null));
  return atlasData;
}

type Levels = { img: CanvasImageSource; scale: number }[];
const levelCache = new Map<string, Promise<Levels>>();
/** The map image plus halved copies, largest first: made once per image, reused by every map. */
function mapLevels(src: string): Promise<Levels> {
  let levels = levelCache.get(src);
  if (!levels) {
    levels = new Promise((resolve, reject) => {
      const base = new Image();
      base.decoding = "async";
      base.onerror = () => {
        levelCache.delete(src);
        reject(new Error(`map ${src}`));
      };
      base.onload = () => {
        const out: Levels = [{ img: base, scale: 1 }];
        let from: CanvasImageSource = base;
        let w = base.width;
        let h = base.height;
        let scale = 1;
        while (w > 600) {
          w = Math.round(w / 2);
          h = Math.round(h / 2);
          scale /= 2;
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const g = c.getContext("2d")!;
          g.imageSmoothingQuality = "high";
          g.drawImage(from, 0, 0, w, h);
          out.push({ img: c, scale });
          from = c;
        }
        resolve(out);
      };
      base.src = src;
    });
    levelCache.set(src, levels);
  }
  return levels;
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
  let levels: Levels = [];
  /** A fit asked for before the canvas had a size. */
  let pending: (() => void) | null = null;
  const view: AtlasView = { s: 0.3, tx: 0, ty: 0 };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The site's fonts (next/font names them; the canvas needs the real family names).
  const css = getComputedStyle(canvas);
  const fonts = {
    display: css.getPropertyValue("--font-display").trim() || "'Chakra Petch'",
    sans: css.getPropertyValue("--font-body").trim() || "Inter",
    pixel: css.getPropertyValue("--font-pixel").trim() || "Silkscreen",
  };

  void mapLevels(src).then((l) => {
    levels = l;
    if (alive) requestDraw();
  });

  let queued = false;
  function requestDraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (alive) draw();
    });
  }

  /** The view that shows a box of the world (with a little room around it). */
  const fitTo = ([x0, y0, x1, y1]: Box, room = 1): AtlasView => {
    const s = Math.min(W / ((x1 - x0) * room), H / ((y1 - y0) * room));
    return { s, tx: W / 2 - ((x0 + x1) / 2) * s, ty: H / 2 - ((y0 + y1) / 2) * s };
  };
  const fitWorld = () => fitTo([0, 0, atlas.W, atlas.H]);
  const home = () => fitTo(bounds, locked ? 1.04 : 1);

  /** Zoom within limits, and never pan off the world. */
  function clamp() {
    view.s = Math.min(MAX_SCALE, Math.max(minS, view.s));
    const cx = Math.min(atlas.W, Math.max(0, (W / 2 - view.tx) / view.s));
    const cy = Math.min(atlas.H, Math.max(0, (H / 2 - view.ty) / view.s));
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
    minS = fitWorld().s * 0.8;
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
    ctx.imageSmoothingQuality = "high";
    if (levels.length) {
      // The smallest copy that still has enough detail for this zoom.
      const need = s * dpr;
      const lvl = levels.find((l) => l.scale <= need * 1.5) ?? levels[0];
      ctx.drawImage(lvl.img, 0, 0, atlas.W, atlas.H);
    }

    const f = s / REF_SCALE;
    for (const m of atlas.markers) {
      const city = m.kind === "city";
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
    opts.onView?.({ ...view });
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
    const label = (text: string, wx: number, wy: number, font: string, size: number, dy: number, color: string, track = 0, dx = 0): boolean => {
      const x = wx * s + tx + dx;
      const y = wy * s + ty + dy;
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
      if (!fits(x - w / 2 - 3, y - size, w + 6, size + 6 + (lines.length - 1) * lineH)) return false;
      ctx.lineWidth = Math.max(3, size / 4);
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

    if (selected) label(selected.name, selected.x, selected.y, `700 SIZE ${sans}, system-ui`, 15, -20, "#ffe08a");
    if (f < 4.5) {
      for (const r of atlas.regions) {
        const baseSize = r.tier === 1 ? 20 : r.tier === 2 ? 14 : 12;
        const size = Math.round(Math.max(baseSize * 0.7, Math.min(baseSize * 1.7, baseSize * Math.pow(f, 0.35))));
        if (r.tier === 3 && f < 1.4) continue;
        label(
          r.tier === 1 ? r.name.toUpperCase() : r.name,
          r.x,
          r.y,
          `${r.tier === 1 ? 700 : 600} SIZE ${display}, ${sans}, sans-serif`,
          size,
          size / 3,
          r.tier === 1 ? "#ffffff" : "#d7e6f7",
          r.tier === 1 ? 2 : 0.5
        );
      }
    }
    if (f >= 2.2) for (const p of atlas.places) if (p.kind === "town") label(p.name, p.x, p.y, `600 SIZE ${sans}, system-ui`, f > 4 ? 13 : 11, -12, "#ffffff");
    // Routes before landmarks: where both can't fit, the route keeps its name.
    if (f >= 3.6) {
      for (const p of atlas.places) {
        if (p.kind !== "route") continue;
        ROUTE_SPOTS.some(([dx, dy]) => label(routeText(p.name), p.x, p.y, `SIZE ${pixel}, monospace`, 10, dy, "#ffe2b5", 0, dx));
      }
    }
    if (f >= 3.6) for (const p of atlas.places) if (p.kind === "landmark") label(p.name, p.x, p.y, `600 SIZE ${sans}, system-ui`, 11, -10, "#cfe0ff");
    if (f >= 6)
      for (const p of atlas.places)
        p.inside?.forEach((b, i) => label(b, p.x, p.y, `500 SIZE ${sans}, system-ui`, 11, 18 + i * 14, "#c9f2dc"));
  }

  /** Zoom by k about screen point (cx, cy): eased over a few frames, so wheel notches glide instead of jumping. */
  let zoomGoal: { s: number; cx: number; cy: number } | null = null;
  function zoomAt(k: number, cx: number, cy: number, instant = false) {
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
      clamp();
      requestDraw();
    } else if (drag) {
      const dx = e.offsetX - drag.x;
      const dy = e.offsetY - drag.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
      moved = touched = true;
      canvas.style.cursor = "grabbing";
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
      const h = home();
      void glide((W / 2 - h.tx) / h.s, (H / 2 - h.ty) / h.s, h.s);
    },
    zoomBy: (factor) => zoomAt(factor, W / 2, H / 2),
    setSelected: (place) => {
      selected = place;
      requestDraw();
    },
    destroy: () => {
      alive = false;
      cancelAnimationFrame(anim);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
    },
  };
}
