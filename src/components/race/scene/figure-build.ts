import { buildFigureMesh, type FigureMesh } from "@/lib/race/figure";
import { findParts } from "@/lib/race/parts";
import type { Motion } from "@/lib/race/types";

/**
 * Builds a runner's mesh and finds its moving parts in a worker
 * (scene/figure.worker), so the main thread stays free while a race
 * loads. Without workers it builds here instead, one figure per frame,
 * still only while the race loads.
 */

export interface FigureJob {
  id: number;
  w: number;
  h: number;
  /** RGBA relief map pixels (transferred). */
  data: ArrayBuffer;
  box: { x: number; y: number; w: number; h: number; size: number };
  segments: number;
  motion: Motion;
  shape: string | null;
}

export type FigureResult = { id: number; mesh: FigureMesh; error?: undefined } | { id: number; error: string; mesh?: undefined };

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { resolve(m: FigureMesh): void; reject(e: Error): void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./figure.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<FigureResult>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.mesh) w.resolve(e.data.mesh);
      else w.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      // A worker that can't start: everything still waiting is built here instead.
      worker?.terminate();
      worker = null;
      for (const [, w] of waiting) w.reject(new Error("worker failed"));
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

async function buildHere(job: Omit<FigureJob, "id">): Promise<FigureMesh> {
  await nextFrame();
  const map = { w: job.w, h: job.h, data: new Uint8ClampedArray(job.data), channels: 4 as const };
  const parts = findParts(map, { motion: job.motion, shape: job.shape });
  return buildFigureMesh(map, job.box, job.segments, parts);
}

export function buildFigure(job: Omit<FigureJob, "id">): Promise<FigureMesh> {
  const w = getWorker();
  if (!w) return buildHere(job);
  const id = nextId++;
  const copy = job.data.slice(0);
  return new Promise<FigureMesh>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ ...job, id }, [job.data]);
  }).catch(() => buildHere({ ...job, data: copy }));
}
