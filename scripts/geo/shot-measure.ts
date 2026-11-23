/**
 * A screenshot's measurements for src/data/geo-shot-meta.json: its size, the
 * quality flags and the detail that the difficulty heuristic reads (shared by
 * audit-shots.ts and upload-additions.ts).
 */
import sharp from "sharp";
import { SHOT_FLAG } from "../../src/lib/geo-difficulty";

export async function measure(buf: Buffer, era: "2d" | "3d") {
  const img = sharp(buf);
  const { width = 0, height = 0 } = await img.metadata();
  // Detail: the spread of a Laplacian over a 512-px-wide greyscale copy.
  const small = sharp(buf).greyscale().resize({ width: Math.min(512, width) });
  const lap = await small
    .clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer();
  let sum = 0;
  let sq = 0;
  for (const v of lap) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / lap.length;
  const detail = Math.sqrt(Math.max(0, sq / lap.length - mean * mean));
  // Flatness: the share of the frame in its single most common (quantised) colour.
  const rgb = await sharp(buf).removeAlpha().resize({ width: 160 }).raw().toBuffer();
  const counts = new Map<number, number>();
  for (let i = 0; i < rgb.length; i += 3) {
    const key = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = Math.max(...counts.values()) / (rgb.length / 3);
  let flags = 0;
  if (width < 480 || height < 270) flags |= SHOT_FLAG.small;
  if (era === "3d" && detail < 6) flags |= SHOT_FLAG.blurry;
  if (top > 0.5) flags |= SHOT_FLAG.ui;
  if (height > width * 1.33) flags |= SHOT_FLAG.tall;
  return { width, height, flags, detail, top };
}
