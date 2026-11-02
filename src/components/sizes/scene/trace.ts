import * as THREE from "three";

/**
 * Streaming trace for /pokedex/sizes (on with ?trace=1, for tests and
 * profiling): for every figure, each time it comes into view, when it came
 * in, when it was first drawn at all, first drawn in 3D, and first drawn at
 * full detail (its own relief mesh), how long after it grew big enough to
 * need that detail, and how long it stayed. Read from window.__szTrace.
 * Costs nothing when off.
 */

export interface TraceEpisode {
  index: number;
  key: string;
  /** performance.now() when it came into view (ms). */
  enter: number;
  /** Delay from entering the view to its first frame drawn at all (ms); null if never drawn while in view. */
  shown: number | null;
  /** Delay to its first frame drawn in 3D (ms); null if never. */
  relief: number | null;
  /** Delay to its first frame drawn at full detail (ms); null if never. */
  near: number | null;
  /** From the first frame it was big enough to need full detail to the first frame with it (ms); null if it never needed it or never got it. */
  nearWait: number | null;
  /** Frames it was in view without being drawn, and frames drawn as a flat stand-in. */
  missing: number;
  flat: number;
  /** How long it stayed in view (ms). */
  dur: number;
  /** Largest height on screen while in view (px). */
  px: number;
}

export interface TraceFigure {
  key: string;
  /** World position of its feet and the direction it faces. */
  x: number;
  z: number;
  yaw?: number;
  /** Distance along the line (sorted). */
  s?: number;
  w: number;
  h: number;
}

/** 0 not drawn, 1 drawn as a flat stand-in, 2 drawn in 3D at low detail, 3 drawn at full detail. */
export type Drawn = 0 | 1 | 2 | 3;

interface Open {
  enter: number;
  shown: number | null;
  relief: number | null;
  near: number | null;
  needAt: number | null;
  missing: number;
  flat: number;
  px: number;
}

export interface Trace {
  frame(now: number, camera: THREE.PerspectiveCamera, viewW: number, viewH: number, figures: TraceFigure[], drawn: (i: number) => Drawn, around: number, needPx?: number): void;
  /** Extra measurements the scene keeps (prefetch lead times and the like). */
  extra: Record<string, number[]>;
  reset(): void;
}

const MIN_PX = 6;

/** ?trace=1&bare=1: the city is left out, so software rendering (automated checks) keeps a real device's frame pacing while the figures stream. */
export function traceBare(): boolean {
  try {
    return typeof window !== "undefined" && /[?&]trace=1\b/.test(window.location.search) && /[?&]bare=1\b/.test(window.location.search);
  } catch {
    return false;
  }
}

export function createTrace(): Trace | null {
  if (typeof window === "undefined") return null;
  try {
    if (!/[?&]trace=1\b/.test(window.location.search)) return null;
  } catch {
    return null;
  }
  const extra: Record<string, number[]> = {};
  const store = { episodes: [] as TraceEpisode[], frames: 0, frameMs: [] as number[], extra, flush: () => {} };
  (window as unknown as { __szTrace: typeof store }).__szTrace = store;
  const open = new Map<number, Open>();
  let figs: TraceFigure[] = [];
  let last = 0;
  const v = new THREE.Vector3();
  const close = (i: number, o: Open, now: number) => {
    const f = figs[i];
    const rel = (t: number | null) => (t === null ? null : Math.max(0, t - o.enter));
    store.episodes.push({ index: i, key: f?.key ?? String(i), enter: o.enter, shown: rel(o.shown), relief: rel(o.relief), near: rel(o.near), nearWait: o.near !== null && o.needAt !== null ? Math.max(0, o.near - o.needAt) : null, missing: o.missing, flat: o.flat, dur: now - o.enter, px: Math.round(o.px) });
  };
  store.flush = () => {
    const now = performance.now();
    for (const [i, o] of open) close(i, o, now);
    open.clear();
  };
  return {
    extra,
    reset() {
      store.flush();
      figs = [];
    },
    frame(now, camera, W, H, figures, drawn, around, needPx = Infinity) {
      if (figures !== figs) {
        for (const [i, o] of open) close(i, o, now);
        open.clear();
        figs = figures;
      }
      store.frames++;
      if (last) store.frameMs.push(Math.round(now - last));
      last = now;
      // Figures near the framed point (a sorted line: a window of indices either side).
      const key = (f: TraceFigure) => f.s ?? f.x;
      let lo = 0, hi = figures.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (key(figures[mid]) <= around) lo = mid; else hi = mid; }
      const from = Math.max(0, lo - 900), to = Math.min(figures.length, lo + 900);
      const seen = new Set<number>();
      for (let i = from; i < to; i++) {
        const f = figures[i];
        const yaw = f.yaw ?? Math.PI;
        // The figure's upright rectangle, across its facing.
        const rx = -Math.cos(yaw), rz = Math.sin(yaw);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
        for (const [dx, dy] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
          v.set(f.x + rx * dx * f.w, dy * f.h, f.z + rz * dx * f.w).project(camera);
          if (v.z > 1 || v.z < -1) { behind = true; break; }
          const sx = (v.x * 0.5 + 0.5) * W, sy = (1 - (v.y * 0.5 + 0.5)) * H;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        const px = y1 - y0;
        const inView = !behind && x1 > 0 && x0 < W && y1 > 0 && y0 < H && px >= MIN_PX;
        if (!inView) continue;
        seen.add(i);
        let o = open.get(i);
        if (!o) { o = { enter: now, shown: null, relief: null, near: null, needAt: null, missing: 0, flat: 0, px: 0 }; open.set(i, o); }
        o.px = Math.max(o.px, px);
        if (px >= needPx && o.needAt === null) o.needAt = now;
        const d = drawn(i);
        if (d && o.shown === null) o.shown = now;
        if (d >= 2 && o.relief === null) o.relief = now;
        if (d === 3 && o.near === null) o.near = now;
        if (!d) o.missing++;
        if (d === 1) o.flat++;
      }
      for (const [i, o] of open) if (!seen.has(i)) { close(i, o, now); open.delete(i); }
    },
  };
}
