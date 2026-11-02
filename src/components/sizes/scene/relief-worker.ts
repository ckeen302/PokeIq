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
  /** Bounding sphere: centre x, y, z and radius (as three.js would compute it). */
  sphere?: [number, number, number, number];
}

/** The bounding sphere three.js would compute: the box's centre, and the farthest vertex from it. */
export function boundingSphere(p: Float32Array): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!(x1 >= x0)) return [0, 0, 0, 0];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx, dy = p[i + 1] - cy, dz = p[i + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return [cx, cy, cz, Math.sqrt(r2)];
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ReliefJob>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

ctx.onmessage = (e: MessageEvent<ReliefJob>) => {
  const job = e.data;
  try {
    const mesh = buildReliefMesh({ w: job.w, h: job.h, data: job.data, channels: 4 }, job.box, job.segments);
    const uv = mesh.uv;
    for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
    const out: ReliefResult = { id: job.id, ok: true, position: mesh.position, normal: mesh.normal, uv, index: mesh.index, height: mesh.height, zMin: mesh.zMin, zMax: mesh.zMax, sphere: boundingSphere(mesh.position) };
    ctx.postMessage(out, [mesh.position.buffer, mesh.normal.buffer, uv.buffer, mesh.index.buffer]);
  } catch {
    ctx.postMessage({ id: job.id, ok: false } satisfies ReliefResult);
  }
};
