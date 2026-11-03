import { buildReliefMesh } from "@/lib/sizes/relief";

/**
 * Builds a species' 3D relief figures off the main thread, at every detail
 * level at once: fetches its baked relief map (front and back surfaces,
 * from public/sizes/depth), decodes it, and lays out one mesh per level
 * (fewer segments for the far levels: still solid 3D, just coarser). The
 * arrays are transferred, not copied; UVs are flipped for textures uploaded
 * without flipY.
 */

export interface ReliefRequest {
  id: number;
  /** Absolute URL of the relief map. */
  url: string;
  box: { x: number; y: number; w: number; h: number; size: number };
  segments: number[];
}

export interface ReliefLevel {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array | Uint16Array;
  /** Mesh height in units of the box's longest side (the figure is scaled from it). */
  height: number;
  triangles: number;
}

export type ReliefReply = { id: number; ok: true; levels: ReliefLevel[] } | { id: number; ok: false; message: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<ReliefRequest>) => void) | null; postMessage(m: ReliefReply, t?: Transferable[]): void };

async function pixels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { w: img.width, h: img.height, data: img.data };
}

scope.onmessage = async (e) => {
  const job = e.data;
  try {
    const map = await pixels(job.url);
    const levels: ReliefLevel[] = [];
    const transfer: Transferable[] = [];
    for (const seg of job.segments) {
      const m = buildReliefMesh({ w: map.w, h: map.h, data: map.data, channels: 4 }, job.box, seg);
      for (let i = 1; i < m.uv.length; i += 2) m.uv[i] = 1 - m.uv[i];
      levels.push({ position: m.position, normal: m.normal, uv: m.uv, index: m.index, height: m.height, triangles: m.index.length / 3 });
      transfer.push(m.position.buffer, m.normal.buffer, m.uv.buffer, m.index.buffer);
    }
    scope.postMessage({ id: job.id, ok: true, levels }, transfer);
  } catch (err) {
    scope.postMessage({ id: job.id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
