import { buildReliefMesh } from "@/lib/sizes/relief";
import { samplePoints } from "./points";

/**
 * Builds the legendaries' relief meshes off the main thread (laying out tens
 * of thousands of vertices would otherwise stall a frame as a chapter loads).
 * Takes the decoded relief map's pixels; returns the mesh's arrays
 * (transferred, not copied), UVs flipped for textures uploaded without flipY,
 * and a sample of points on the figure's front surface for particle effects.
 */

export interface ReliefJob {
  id: number;
  w: number;
  h: number;
  data: Uint8ClampedArray;
  box: { x: number; y: number; w: number; h: number; size: number };
  segments: number;
  samples: number;
}

export interface ReliefResult {
  id: number;
  ok: boolean;
  position?: Float32Array;
  normal?: Float32Array;
  uv?: Float32Array;
  index?: Uint32Array | Uint16Array;
  width?: number;
  height?: number;
  zMin?: number;
  zMax?: number;
  points?: Float32Array;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ReliefJob>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

ctx.onmessage = (e: MessageEvent<ReliefJob>) => {
  const job = e.data;
  try {
    const mesh = buildReliefMesh({ w: job.w, h: job.h, data: job.data, channels: 4 }, job.box, job.segments);
    const uv = mesh.uv;
    for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
    const points = samplePoints(mesh.position, job.samples);
    const out: ReliefResult = { id: job.id, ok: true, position: mesh.position, normal: mesh.normal, uv, index: mesh.index, width: mesh.width, height: mesh.height, zMin: mesh.zMin, zMax: mesh.zMax, points };
    ctx.postMessage(out, [mesh.position.buffer, mesh.normal.buffer, uv.buffer, mesh.index.buffer, points.buffer]);
  } catch {
    ctx.postMessage({ id: job.id, ok: false } satisfies ReliefResult);
  }
};
