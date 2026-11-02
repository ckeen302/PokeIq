/**
 * Builds the relief maps that turn every Pokémon HOME render on
 * /pokedex/sizes into a solid 3D figure.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/sizes-depth.ts [--only=25,250] [--threads=3]
 *
 * 1. Depth: Depth Anything V2 Small (Apache-2.0, run on the CPU with ONNX
 *    Runtime through Transformers.js, about half a second a render) reads
 *    each render, composited on neutral grey, and estimates how near each
 *    pixel is. The raw maps are cached (SIZES_DEPTH_CACHE) so the bake can
 *    be re-tuned without running the model again.
 * 2. Bake: inside the render's visible box, the near/far map becomes the
 *    figure's front surface, and an inflation of the silhouette (a rounded
 *    profile from its distance field) gives it thickness behind that, so
 *    the front and back meet at the outline and the figure reads as solid
 *    when the camera moves around it. Written to public/sizes/depth/<id>.webp
 *    (lossless, 128 px on the longest side):
 *      R  front surface   G  back surface    (z / L + 0.5, L = the box's longest side)
 *      B  coverage (any visible pixel in the cell, so the mesh keeps the outline's cells)
 *
 * The HOME renders come from the cache scripts/sizes-data.ts fills
 * (SIZES_CACHE); the model from the Hugging Face hub (HF_CACHE).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import ART from "../src/data/sizes-art.json";
import { bakeRelief, DEPTH_RES } from "../src/lib/sizes/relief";

const CACHE = process.env.SIZES_CACHE ?? join(tmpdir(), "pokeiq-sizes");
const RAW = process.env.SIZES_DEPTH_CACHE ?? join(tmpdir(), "pokeiq-sizes-depth");
const HF = process.env.HF_CACHE ?? join(tmpdir(), "pokeiq-hf");
const OUT = "public/sizes/depth";
const MODEL = "onnx-community/depth-anything-v2-small";
/** Raw depth is kept at this size (16-bit), cropped to the box. */
const RAW_RES = 256;

type Box = [number, number, number, number, number];
const BOXES = ART as unknown as Record<string, Box>;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main() {
  mkdirSync(RAW, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const only = arg("only")?.split(",").map(Number);
  const ids = Object.keys(BOXES).map(Number).filter((id) => !only || only.includes(id)).sort((a, b) => a - b);

  // ---- 1. depth (only for renders without a cached map)
  const todo = ids.filter((id) => !existsSync(join(RAW, `${id}.u16`)));
  if (todo.length) {
    const { pipeline, env, RawImage } = await import("@huggingface/transformers");
    env.cacheDir = HF;
    const threads = Number(arg("threads") ?? 3);
    const estimate = await pipeline("depth-estimation", MODEL, { dtype: "fp32", session_options: { intraOpNumThreads: threads } } as never);
    const started = Date.now();
    for (const [n, id] of todo.entries()) {
      const png = readFileSync(join(CACHE, `home-${id}.png`));
      const { data, info } = await sharp(png).flatten({ background: { r: 128, g: 128, b: 128 } }).raw().toBuffer({ resolveWithObject: true });
      const out = (await estimate(new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3))) as unknown as { predicted_depth: { dims: number[]; data: Float32Array } };
      const [h, w] = out.predicted_depth.dims;
      const d = out.predicted_depth.data;
      // Crop to the visible box, normalise over the whole image (relative depth), keep 16 bits.
      const [bx, by, bw, bh, size] = BOXES[id];
      const sx = w / size, sy = h / size;
      let lo = Infinity, hi = -Infinity;
      for (const v of d) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const scale = RAW_RES / Math.max(bw, bh);
      const ow = Math.max(1, Math.round(bw * scale)), oh = Math.max(1, Math.round(bh * scale));
      const out16 = new Uint16Array(ow * oh);
      for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
          // Bilinear sample at the centre of the output pixel.
          const px = (bx + ((x + 0.5) / ow) * bw) * sx - 0.5;
          const py = (by + ((y + 0.5) / oh) * bh) * sy - 0.5;
          const x0 = Math.max(0, Math.min(w - 1, Math.floor(px))), y0 = Math.max(0, Math.min(h - 1, Math.floor(py)));
          const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
          const fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
          const v = (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
          out16[y * ow + x] = Math.round(((v - lo) / Math.max(1e-6, hi - lo)) * 65535);
        }
      }
      // Kept as raw 16-bit: a 4-byte header (width, height) then the values.
      const file = Buffer.alloc(4 + out16.byteLength);
      file.writeUInt16LE(ow, 0);
      file.writeUInt16LE(oh, 2);
      Buffer.from(out16.buffer).copy(file, 4);
      writeFileSync(join(RAW, `${id}.u16`), file);
      if (n % 25 === 0) console.log(`depth ${n + 1}/${todo.length} (#${id}) ${((Date.now() - started) / (n + 1)).toFixed(0)} ms each`);
    }
  }

  // ---- 2. bake
  let bytes = 0;
  for (const id of ids) {
    const [bx, by, bw, bh] = BOXES[id];
    const rawFile = readFileSync(join(RAW, `${id}.u16`));
    const raw = { info: { width: rawFile.readUInt16LE(0), height: rawFile.readUInt16LE(2) } };
    const depth = new Float32Array(raw.info.width * raw.info.height);
    for (let i = 0; i < depth.length; i++) depth[i] = rawFile.readUInt16LE(4 + i * 2) / 65535;
    // Alpha (area-averaged) and coverage (any visible pixel) per cell, from the full-size render.
    const scale = DEPTH_RES / Math.max(bw, bh);
    const ow = Math.max(2, Math.round(bw * scale)), oh = Math.max(2, Math.round(bh * scale));
    const full = await sharp(join(CACHE, `home-${id}.png`)).ensureAlpha().extractChannel(3).extract({ left: bx, top: by, width: bw, height: bh }).raw().toBuffer();
    const alpha = new Float32Array(ow * oh), cover = new Float32Array(ow * oh);
    for (let y = 0; y < oh; y++) {
      const y0 = Math.floor((y / oh) * bh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / oh) * bh));
      for (let x = 0; x < ow; x++) {
        const x0 = Math.floor((x / ow) * bw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / ow) * bw));
        let s = 0, c = 0, any = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const a = full[yy * bw + xx]; s += a; c++; if (a > 8) any = 1; }
        alpha[y * ow + x] = s / c / 255;
        cover[y * ow + x] = any;
      }
    }
    // Resample the 16-bit depth to the bake size (keeps precision).
    const dres = new Float32Array(ow * oh);
    const W = raw.info.width;
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const px = ((x + 0.5) / ow) * W - 0.5, py = ((y + 0.5) / oh) * raw.info.height - 0.5;
        const x0 = Math.max(0, Math.floor(px)), y0 = Math.max(0, Math.floor(py));
        const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(raw.info.height - 1, y0 + 1);
        const fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
        dres[y * ow + x] = (depth[y0 * W + x0] * (1 - fx) + depth[y0 * W + x1] * fx) * (1 - fy) + (depth[y1 * W + x0] * (1 - fx) + depth[y1 * W + x1] * fx) * fy;
      }
    }
    const baked = bakeRelief({ w: ow, h: oh, depth: dres, alpha, cover });
    const file = join(OUT, `${id}.webp`);
    const buf = await sharp(Buffer.from(baked.rgb), { raw: { width: ow, height: oh, channels: 3 } }).webp({ lossless: true, effort: 6 }).toBuffer();
    writeFileSync(file, buf);
    bytes += buf.length;
  }
  console.log(`baked ${ids.length} relief maps, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
