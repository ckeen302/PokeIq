/**
 * Silhouette lookalike index — which Pokémon are easiest to confuse in
 * "Who's That Pokémon?"
 *
 *   npm run lookalikes        (one-off, ~5 min on CPU; not part of the app runtime)
 *
 * Pipeline:
 *   1. Render every official artwork as a pure silhouette (black on white,
 *      trimmed and centred, 224×224) — exactly what quiz players see.
 *   2. Embed each silhouette, and its mirror image, with DINOv2-small, a
 *      self-supervised vision transformer whose features capture shape and
 *      structure, via Transformers.js (ONNX on CPU). Original and mirrored
 *      embeddings are averaged so a Pokémon facing left matches one facing
 *      right.
 *   3. Exact k-nearest-neighbour search by cosine similarity over the 1,025
 *      L2-normalised 384-d vectors; keep the top 12 per species.
 *
 * Output: src/data/lookalikes.json — { [id]: [[otherId, cosine×1000], …] }.
 * Used for genuinely hard Who's That Pokémon distractors and the Pokédex's
 * "easily confused with" panel.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { pipeline, RawImage } from "@huggingface/transformers";

const MODEL = "Xenova/dinov2-small";
const SIZE = 224;
const TOP_K = 12;
const CACHE_DIR = path.join(os.tmpdir(), "pokeiq-artwork");
const OUT = path.join(process.cwd(), "src/data/lookalikes.json");

const pokedex = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/data/pokedex.json"), "utf8")) as { id: number }[];

async function artwork(id: number): Promise<Buffer> {
  const file = path.join(CACHE_DIR, `${id}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      return buf;
    }
    if (attempt >= 4) throw new Error(`${id}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

/** Black-on-white silhouette as an RGB RawImage (optionally mirrored). */
async function silhouette(id: number, mirrored: boolean): Promise<RawImage> {
  const alpha = await sharp(await artwork(id)).ensureAlpha().extractChannel(3).toBuffer();
  let img = sharp(alpha)
    .trim({ threshold: 10 })
    .resize(SIZE - 24, SIZE - 24, { fit: "contain", background: { r: 0, g: 0, b: 0 } })
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0 } })
    .negate(); // shape black, background white
  if (mirrored) img = img.flop();
  const { data, info } = await img.toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels as 3);
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ids = pokedex.map((p) => p.id);

  console.log(`Loading ${MODEL}…`);
  const extractor = await pipeline("image-feature-extraction", MODEL, { dtype: "fp32" });

  const embeddings = new Map<number, Float32Array>();
  const started = Date.now();
  for (const id of ids) {
    const vectors: Float32Array[] = [];
    for (const mirrored of [false, true]) {
      const out = await extractor(await silhouette(id, mirrored));
      // [1, 1 + patches, 384]: token 0 is the CLS summary of the whole image.
      vectors.push(normalize((out.data as Float32Array).slice(0, out.dims[2])));
    }
    embeddings.set(id, normalize(vectors[0].map((x, i) => x + vectors[1][i])));
    if (embeddings.size % 100 === 0) {
      const rate = embeddings.size / ((Date.now() - started) / 1000);
      console.log(`  ${embeddings.size}/${ids.length} (${rate.toFixed(1)}/s)`);
    }
  }

  console.log("Nearest-neighbour search…");
  const out: Record<number, [number, number][]> = {};
  for (const a of ids) {
    const va = embeddings.get(a)!;
    const scored: [number, number][] = [];
    for (const b of ids) {
      if (a === b) continue;
      const vb = embeddings.get(b)!;
      let dot = 0;
      for (let i = 0; i < va.length; i++) dot += va[i] * vb[i];
      scored.push([b, dot]);
    }
    scored.sort((x, y) => y[1] - x[1]);
    out[a] = scored.slice(0, TOP_K).map(([b, s]) => [b, Math.round(s * 1000)]);
  }

  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`✓ wrote ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
