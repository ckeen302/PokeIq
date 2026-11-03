import { buildFigureMesh } from "@/lib/race/figure";
import { findParts } from "@/lib/race/parts";
import type { FigureJob, FigureResult } from "./figure-build";

/** Finds a runner's moving parts and builds its mesh off the main thread (scene/figure-build). */
const ctx = self as unknown as { onmessage: ((e: MessageEvent<FigureJob>) => void) | null; postMessage(m: FigureResult, transfer: Transferable[]): void };

ctx.onmessage = (e) => {
  const job = e.data;
  try {
    const map = { w: job.w, h: job.h, data: new Uint8ClampedArray(job.data), channels: 4 as const };
    const parts = findParts(map, { motion: job.motion, shape: job.shape });
    const mesh = buildFigureMesh(map, job.box, job.segments, parts);
    ctx.postMessage({ id: job.id, mesh }, [mesh.position.buffer, mesh.normal.buffer, mesh.uv.buffer, mesh.index.buffer, mesh.part.buffer]);
  } catch (err) {
    ctx.postMessage({ id: job.id, error: String(err instanceof Error ? err.message : err) }, []);
  }
};
