import * as THREE from "three";

/**
 * Streaming trace for /pokedex/sizes (on with ?trace=1, for tests and
 * profiling): for every figure, each time it comes into view, when it came
 * in, when it was first drawn in 3D and how long it stayed. Read from
 * window.__szTrace. Costs nothing when off.
 */

export interface TraceEpisode {
  index: number;
  key: string;
  /** performance.now() when it came into view (ms). */
  enter: number;
  /** Delay from entering the view to its first frame drawn at all (ms); null if never drawn while in view. */
  shown: number | null;
  /** Delay to its first frame drawn as a full 3D relief (ms); null if never. */
  relief: number | null;
  /** Frames it was in view without being drawn. */
  missing: number;
  /** How long it stayed in view (ms). */
  dur: number;
  /** Largest height on screen while in view (px). */
  px: number;
}

export interface TraceFigure {
  key: string;
  x: number;
  w: number;
  h: number;
  z?: number;
}

export type Drawn = 0 | 1 | 2; // 0 not drawn, 1 drawn as a stand-in, 2 drawn as a 3D relief

interface Open {
  enter: number;
  shown: number | null;
  relief: number | null;
  missing: number;
  px: number;
}

export interface Trace {
  frame(now: number, camera: THREE.PerspectiveCamera, viewW: number, viewH: number, figures: TraceFigure[], drawn: (i: number) => Drawn, around: number): void;
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
  const store = { episodes: [] as TraceEpisode[], frames: 0, frameMs: [] as number[], flush: () => {} };
  (window as unknown as { __szTrace: typeof store }).__szTrace = store;
  const open = new Map<number, Open>();
  let figs: TraceFigure[] = [];
  let last = 0;
  const v = new THREE.Vector3();
  const close = (i: number, o: Open, now: number) => {
    const f = figs[i];
    store.episodes.push({ index: i, key: f?.key ?? String(i), enter: o.enter, shown: o.shown === null ? null : Math.max(0, o.shown - o.enter), relief: o.relief === null ? null : Math.max(0, o.relief - o.enter), missing: o.missing, dur: now - o.enter, px: Math.round(o.px) });
  };
  store.flush = () => {
    const now = performance.now();
    for (const [i, o] of open) close(i, o, now);
    open.clear();
  };
  return {
    reset() {
      store.flush();
      figs = [];
    },
    frame(now, camera, W, H, figures, drawn, around) {
      if (figures !== figs) {
        for (const [i, o] of open) close(i, o, now);
        open.clear();
        figs = figures;
      }
      store.frames++;
      if (last) store.frameMs.push(Math.round(now - last));
      last = now;
      // Figures near the framed point (a sorted line: a window of indices either side).
      let lo = 0, hi = figures.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (figures[mid].x <= around) lo = mid; else hi = mid; }
      const from = Math.max(0, lo - 900), to = Math.min(figures.length, lo + 900);
      const seen = new Set<number>();
      for (let i = from; i < to; i++) {
        const f = figures[i];
        const z = f.z ?? 0;
        // Screen box of the figure's upright rectangle.
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
        for (const [dx, dy] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
          v.set(f.x + dx * f.w, dy * f.h, z).project(camera);
          if (v.z > 1 || v.z < -1) { behind = true; break; }
          const sx = (v.x * 0.5 + 0.5) * W, sy = (1 - (v.y * 0.5 + 0.5)) * H;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        const px = y1 - y0;
        const inView = !behind && x1 > 0 && x0 < W && y1 > 0 && y0 < H && px >= MIN_PX;
        if (!inView) continue;
        seen.add(i);
        let o = open.get(i);
        if (!o) { o = { enter: now, shown: null, relief: null, missing: 0, px: 0 }; open.set(i, o); }
        o.px = Math.max(o.px, px);
        const d = drawn(i);
        if (d && o.shown === null) o.shown = now;
        if (d === 2 && o.relief === null) o.relief = now;
        if (!d) o.missing++;
      }
      for (const [i, o] of open) if (!seen.has(i)) { close(i, o, now); open.delete(i); }
    },
  };
}
