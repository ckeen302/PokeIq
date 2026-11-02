import { buildReliefMesh } from "@/lib/sizes/relief";

/**
 * Builds relief figure meshes off the main thread: smoothing the map and
 * laying out tens of thousands of vertices would otherwise stall a frame each
 * time a figure streams in mid-glide. Takes the decoded relief map's pixels,
 * returns the mesh's arrays (transferred, not copied), with UVs already
 * flipped for textures uploaded without flipY.
 */

export interface ReliefJob {
  id: number;
  w: number;
  h: number;
  data: Uint8ClampedArray;
  box: { x: number; y: number; w: number; h: number; size: number };
  segments: number;
}

export interface ReliefResult {
  id: number;
  ok: boolean;
  position?: Float32Array;
  normal?: Float32Array;
  uv?: Float32Array;
  index?: Uint32Array | Uint16Array;
  height?: number;
  zMin?: number;
  zMax?: number;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ReliefJob>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

ctx.onmessage = (e: MessageEvent<ReliefJob>) => {
  const job = e.data;
  try {
    const mesh = buildReliefMesh({ w: job.w, h: job.h, data: job.data, channels: 4 }, job.box, job.segments);
    const uv = mesh.uv;
    for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
    const out: ReliefResult = { id: job.id, ok: true, position: mesh.position, normal: mesh.normal, uv, index: mesh.index, height: mesh.height, zMin: mesh.zMin, zMax: mesh.zMax };
    ctx.postMessage(out, [mesh.position.buffer, mesh.normal.buffer, uv.buffer, mesh.index.buffer]);
  } catch {
    ctx.postMessage({ id: job.id, ok: false } satisfies ReliefResult);
  }
};
