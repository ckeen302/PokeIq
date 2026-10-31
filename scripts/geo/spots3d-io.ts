/** Image files to and from the rasters scripts/geo/spots3d-lib.ts works on. */
import sharp from "sharp";
import type { Raster } from "./spots3d-lib";

/** An image file as RGB floats, transparent pixels invalid. */
export async function readRaster(file: string | Buffer): Promise<Raster> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const rgb = new Float32Array(n * 3);
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
    valid[i] = data[i * 4 + 3] > 128 ? 1 : 0;
  }
  return { w: info.width, h: info.height, ch: 3, data: rgb, valid };
}

/** An RGB raster as a PNG (invalid pixels magenta-dark). */
export async function rasterPng(img: Raster): Promise<Buffer> {
  const out = Buffer.alloc(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) {
    const ok = !img.valid || img.valid[i];
    for (let k = 0; k < 3; k++) out[i * 3 + k] = ok ? Math.max(0, Math.min(255, Math.round(img.data[i * img.ch + k]))) : k === 1 ? 0 : 60;
  }
  return sharp(out, { raw: { width: img.w, height: img.h, channels: 3 } }).png().toBuffer();
}
