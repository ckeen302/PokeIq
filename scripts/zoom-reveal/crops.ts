/**
 * Precomputes Zoom Reveal's start crops for every Pokémon's official artwork
 * into src/data/zoom-reveal-crops.json (server-only: it is keyed by species).
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/zoom-reveal/crops.ts [--ids 1,25,150] [--sheet out-dir]
 *
 * Each artwork is padded to a square and scaled to ANALYSIS_SIZE, then
 * src/lib/zoom-reveal-crop.ts scores every candidate square for detail.
 * `--sheet` also writes each Pokémon's candidates as PNGs for checking by eye.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { artworkUrl } from "../../src/lib/pokemon/pokedex";
import { pickCrops, type CropCandidate } from "../../src/lib/zoom-reveal-crop";

const ANALYSIS_SIZE = 192;
const OUT = path.resolve(import.meta.dirname, "../../src/data/zoom-reveal-crops.json");

async function fetchArt(id: number): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(artworkUrl(id), { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/** The artwork on a square transparent canvas (official art already is one; this guards the odd one out). */
export async function squareArt(art: Buffer): Promise<{ data: Buffer; size: number }> {
  const { width = 0, height = 0 } = await sharp(art).metadata();
  const size = Math.max(width, height);
  const data = await sharp(art)
    .ensureAlpha()
    .extend({
      left: Math.floor((size - width) / 2),
      right: Math.ceil((size - width) / 2),
      top: Math.floor((size - height) / 2),
      bottom: Math.ceil((size - height) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return { data, size };
}

async function cropsFor(id: number, sheet?: string): Promise<CropCandidate[]> {
  const { data, size } = await squareArt(await fetchArt(id));
  const raw = await sharp(data).resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { kernel: "cubic" }).ensureAlpha().raw().toBuffer();
  const crops = pickCrops(new Uint8Array(raw), ANALYSIS_SIZE);
  if (sheet) {
    await Promise.all(
      crops.map((c, i) =>
        sharp(data)
          .extract({ left: Math.round(c.x * size), top: Math.round(c.y * size), width: Math.round(c.s * size), height: Math.round(c.s * size) })
          .resize(160, 160)
          .flatten({ background: "#1e293b" })
          .png()
          .toFile(path.join(sheet, `${id}-${i}.png`))
      )
    );
  }
  return crops;
}

async function main() {
  const args = process.argv.slice(2);
  const idsArg = args.includes("--ids") ? args[args.indexOf("--ids") + 1] : null;
  const sheet = args.includes("--sheet") ? path.resolve(args[args.indexOf("--sheet") + 1]) : undefined;
  if (sheet) await mkdir(sheet, { recursive: true });
  const ids = idsArg ? idsArg.split(",").map(Number) : Array.from({ length: 1025 }, (_, i) => i + 1);

  const existing = idsArg
    ? (JSON.parse(await readFile(OUT, "utf8").catch(() => "{}")).crops ?? {})
    : {};
  const out: Record<string, number[][]> = { ...existing };
  let next = 0;
  let done = 0;
  const failed: number[] = [];
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const crops = await cropsFor(id, sheet);
          if (!crops.length) failed.push(id);
          out[id] = crops.map((c) => [c.x, c.y, c.s, c.opaque, c.colours, c.edges]);
        } catch (err) {
          console.error(`#${id}:`, err);
          failed.push(id);
        }
        if (++done % 100 === 0) console.log(`${done}/${ids.length}`);
      }
    })
  );
  if (failed.length) {
    console.error("No crop for:", failed.join(","));
    process.exitCode = 1;
  }
  const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])));
  await writeFile(OUT, JSON.stringify({ v: 1, fields: ["x", "y", "s", "opaque", "colours", "edges"], crops: sorted }) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} Pokémon to ${path.relative(process.cwd(), OUT)}`);
}

void main();
