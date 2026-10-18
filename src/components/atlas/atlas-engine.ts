/**
 * The world atlas canvas: the painted world map (with pre-shrunk copies so
 * zoomed-out frames stay cheap), crisp town markers, and labels that appear as
 * you zoom in and never overlap. Pan with a drag, zoom with the wheel or a pinch.
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

export interface AtlasCallbacks {
  /** A click on a place, on a region's area, or on empty sea (null). */
  onPick: (pick: { place: AtlasPlace } | { region: AtlasRegion } | null) => void;
  onZoom: (label: string) => void;
}

export interface AtlasEngine {
  flyTo: (x: number, y: number, zoom: "region" | "place" | "world") => Promise<void>;
  zoomBy: (factor: number) => void;
  setSelected: (place: AtlasPlace | null) => void;
  destroy: () => void;
}

const SEA = "#165c96";
const MAX_SCALE = 9;

export function createAtlas(canvas: HTMLCanvasElement, stage: HTMLElement, atlas: AtlasData, src: string, cb: AtlasCallbacks): AtlasEngine {
  const ctx = canvas.getContext("2d")!;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let minS = 0.1;
  let selected: AtlasPlace | null = null;
  let anim = 0;
  let touched = false;
  let alive = true;
  const view = { s: 0.3, tx: 0, ty: 0 };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The site's fonts (next/font names them; the canvas needs the real family names).
  const css = getComputedStyle(canvas);
  const fonts = {
    display: css.getPropertyValue("--font-display").trim() || "'Chakra Petch'",
    sans: css.getPropertyValue("--font-body").trim() || "Inter",
    pixel: css.getPropertyValue("--font-pixel").trim() || "Silkscreen",
  };

  // Full-size map plus halved copies, largest first.
  const levels: { img: CanvasImageSource; scale: number }[] = [];
  const base = new Image();
  base.decoding = "async";
  base.onload = () => {
    if (!alive) return;
    levels.push({ img: base, scale: 1 });
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
      levels.push({ img: c, scale });
      from = c;
    }
    requestDraw();
  };
  base.src = src;

  let queued = false;
  function requestDraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (alive) draw();
    });
  }

  const fitWorld = () => {
    const s = Math.min(W / atlas.W, H / atlas.H);
    return { s, tx: (W - atlas.W * s) / 2, ty: (H - atlas.H * s) / 2 };
  };

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    minS = fitWorld().s * 0.8;
    // Keep the whole world framed until the viewer starts exploring.
    if (!touched) Object.assign(view, fitWorld());
    draw();
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

    const f = s / fitWorld().s;
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
    cb.onZoom(f < 2.2 ? "World" : s < 0.9 ? "Region" : s < 1.6 ? "Towns + routes" : "Close up");
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
    const label = (text: string, wx: number, wy: number, font: string, size: number, dy: number, color: string, track = 0) => {
      const x = wx * s + tx;
      const y = wy * s + ty + dy;
      ctx.font = font.replace("SIZE", `${size}px`);
      ctx.letterSpacing = `${track}px`;
      const key = `${text}|${ctx.font}|${track}`;
      let w = widths.get(key);
      if (w === undefined) {
        w = ctx.measureText(text).width;
        widths.set(key, w);
      }
      if (!fits(x - w / 2 - 3, y - size, w + 6, size + 6)) return;
      ctx.lineWidth = Math.max(3, size / 4);
      ctx.strokeStyle = "rgba(8,18,32,.88)";
      ctx.lineJoin = "round";
      ctx.textAlign = "center";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    const { display, sans, pixel } = fonts;

    if (selected) label(selected.name, selected.x, selected.y, `700 SIZE ${sans}, system-ui`, 15, -20, "#ffe08a");
    if (f < 4.5) {
      for (const r of atlas.regions) {
        const baseSize = r.tier === 1 ? 20 : r.tier === 2 ? 14 : 12;
        const size = Math.round(Math.min(baseSize * 1.7, baseSize * Math.pow(f, 0.35)));
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
    if (f >= 3.6) for (const p of atlas.places) if (p.kind === "landmark") label(p.name, p.x, p.y, `600 SIZE ${sans}, system-ui`, 11, -10, "#cfe0ff");
    if (f >= 3.6) for (const p of atlas.places) if (p.kind === "route") label(p.name, p.x, p.y, `SIZE ${pixel}, monospace`, 10, 4, "#ffe2b5");
    if (f >= 6)
      for (const p of atlas.places)
        p.inside?.forEach((b, i) => label(b, p.x, p.y, `500 SIZE ${sans}, system-ui`, 11, 18 + i * 14, "#c9f2dc"));
  }

  function zoomAt(k: number, cx: number, cy: number) {
    touched = true;
    const s2 = Math.min(MAX_SCALE, Math.max(minS, view.s * k));
    const r = s2 / view.s;
    view.tx = cx - (cx - view.tx) * r;
    view.ty = cy - (cy - view.ty) * r;
    view.s = s2;
    requestDraw();
  }

  function flyTo(wx: number, wy: number, zoom: "region" | "place" | "world"): Promise<void> {
    touched = true;
    cancelAnimationFrame(anim);
    const fit = fitWorld().s;
    const s2 = Math.min(MAX_SCALE, Math.max(minS, zoom === "world" ? fit : zoom === "region" ? fit * 5 : fit * 9));
    const from = { ...view };
    return new Promise((done) => {
      if (reduceMotion) {
        view.s = s2;
        view.tx = W / 2 - wx * s2;
        view.ty = H / 2 - wy * s2;
        draw();
        done();
        return;
      }
      const t0 = performance.now();
      const dur = 520;
      const fx = (W / 2 - from.tx) / from.s;
      const fy = (H / 2 - from.ty) / from.s;
      const step = (now: number) => {
        if (!alive) return done();
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        view.s = Math.exp(Math.log(from.s) + (Math.log(s2) - Math.log(from.s)) * e);
        view.tx = W / 2 - (fx + (wx - fx) * e) * view.s;
        view.ty = H / 2 - (fy + (wy - fy) * e) * view.s;
        draw();
        if (t < 1) anim = requestAnimationFrame(step);
        else done();
      };
      anim = requestAnimationFrame(step);
    });
  }

  function pick(sx: number, sy: number) {
    const wx = (sx - view.tx) / view.s;
    const wy = (sy - view.ty) / view.s;
    const f = view.s / fitWorld().s;
    let best: AtlasPlace | null = null;
    let bd = 16 / view.s;
    if (f >= 2)
      for (const p of atlas.places) {
        const d = Math.hypot(p.x - wx, p.y - wy) * (p.kind === "route" ? 1.3 : 1);
        if (d < bd) [best, bd] = [p, d];
      }
    if (best) return cb.onPick({ place: best });
    // Otherwise the nearest region label, zooming there from afar.
    const r = atlas.regions.reduce((a, b) => (Math.hypot(a.x - wx, a.y - wy) < Math.hypot(b.x - wx, b.y - wy) ? a : b));
    if (Math.hypot(r.x - wx, r.y - wy) < 380) {
      cb.onPick({ region: r });
      if (f < 3) void flyTo(r.x, r.y, "region");
    } else cb.onPick(null);
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
    touched = true;
    if (pointers.size === 1) {
      drag = { x: e.offsetX, y: e.offsetY, tx: view.tx, ty: view.ty };
      moved = false;
      canvas.style.cursor = "grabbing";
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
      moved = true;
      requestDraw();
    } else if (drag) {
      const dx = e.offsetX - drag.x;
      const dy = e.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      view.tx = drag.tx + dx;
      view.ty = drag.ty + dy;
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
    zoomAt(Math.exp(-e.deltaY * k), e.offsetX, e.offsetY);
  };
  const onDbl = (e: MouseEvent) => zoomAt(2, e.offsetX, e.offsetY);

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
