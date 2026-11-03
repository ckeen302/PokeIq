/**
 * The pictures the 3D figures on /pokedex/sizes load, as static files the
 * CDN serves straight away (a static file never waits on /api/sizes/home
 * waking up and transcoding on a cold edge):
 *
 * 1. public/sizes/art/<256|512>/<id>.webp: every figure's Pokémon HOME render
 *    at the two sizes the figures use (256 px on the light quality, 512 px
 *    otherwise). The same picture as /api/sizes/home/<id>?s=<size>, byte for
 *    byte (src/lib/server/sizes-art).
 * 2. The far atlas: two sheets holding every figure at once, for the
 *    low-detail relief figures far from the camera. art-<hash>.webp has each
 *    render cropped to its visible box and fitted into a 64 px cell (feet on
 *    the cell's floor); depth-<hash>.webp has its relief map (public/sizes/
 *    depth: front, back, coverage) fitted the same way into a 32 px cell.
 *    Cells run in art-id order; src/data/sizes-far.json lists them.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/sizes-art.ts           (missing renders only, then the atlas)
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/sizes-art.ts --force   (every render again)
 *
 * Re-run after scripts/sizes-data.ts and scripts/sizes-depth.ts add figures.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import ART from "../src/data/sizes-art.json";
import { homeRenderUrl } from "../src/lib/pokemon/art";
import { STATIC_HOME_SIZES, transcodeHome } from "../src/lib/server/sizes-art";
import { FAR } from "../src/lib/sizes/far";

type Box = [number, number, number, number, number];
const BOXES = ART as unknown as Record<string, Box>;
const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/sizes/art");
const FAR_OUT = path.join(ROOT, "public/sizes/far");
const DEPTH = path.join(ROOT, "public/sizes/depth");
const MANIFEST = path.join(ROOT, "src/data/sizes-far.json");
const force = process.argv.includes("--force");

async function fetchPng(id: number): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(homeRenderUrl(id)).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4 || res?.status === 404) throw new Error(`HOME render ${id}: ${res?.status ?? "network error"}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function renders(ids: number[]) {
  for (const size of STATIC_HOME_SIZES) fs.mkdirSync(path.join(OUT, String(size)), { recursive: true });
  const file = (id: number, size: number) => path.join(OUT, String(size), `${id}.webp`);
  const todo = ids.filter((id) => force || STATIC_HOME_SIZES.some((s) => !fs.existsSync(file(id, s))));
  let bytes = 0;
  for (let i = 0; i < todo.length; i += 12) {
    await Promise.all(
      todo.slice(i, i + 12).map(async (id) => {
        const png = await fetchPng(id);
        for (const size of STATIC_HOME_SIZES) {
          const webp = await transcodeHome(png, size);
          fs.writeFileSync(file(id, size), webp);
          bytes += webp.length;
        }
      })
    );
    process.stdout.write(`\rrenders ${Math.min(i + 12, todo.length)}/${todo.length}`);
  }
  console.log(`\n${todo.length} renders written (${Math.round(bytes / 1024)} KB); ${ids.length} figures in all.`);
}

const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 10);

async function atlas(ids: number[]) {
  fs.mkdirSync(FAR_OUT, { recursive: true });
  const cols = FAR.cols;
  const rows = Math.ceil(ids.length / cols);
  const artW = cols * FAR.art.cell, artH = rows * FAR.art.cell;
  const depW = cols * FAR.depth.cell, depH = rows * FAR.depth.cell;
  const artParts: { input: Buffer; left: number; top: number }[] = [];
  const depParts: { input: Buffer; left: number; top: number }[] = [];
  for (const [k, id] of ids.entries()) {
    const [bx, by, bw, bh] = BOXES[id];
    const a = FAR.rect(k, bw, bh, FAR.art);
    const crop = await sharp(fs.readFileSync(path.join(OUT, "512", `${id}.webp`)))
      .extract({ left: Math.round(bx), top: Math.round(by), width: Math.max(1, Math.round(bw)), height: Math.max(1, Math.round(bh)) })
      .resize(a.w, a.h, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    artParts.push({ input: crop, left: a.x, top: a.y });
    const d = FAR.rect(k, bw, bh, FAR.depth);
    const dep = await sharp(fs.readFileSync(path.join(DEPTH, `${id}.webp`)))
      .removeAlpha()
      .resize(d.w, d.h, { fit: "fill", kernel: "linear" })
      .png()
      .toBuffer();
    depParts.push({ input: dep, left: d.x, top: d.y });
  }
  const artSheet = await sharp({ create: { width: artW, height: artH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(artParts)
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toBuffer();
  const depSheet = await sharp({ create: { width: depW, height: depH, channels: 3, background: { r: 128, g: 128, b: 0 } } })
    .composite(depParts)
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  // Hashed names: the sheets are immutable, and the manifest (bundled with the page) always names the pair it was made with.
  for (const f of fs.readdirSync(FAR_OUT)) if (/^(art|depth)-[0-9a-f]+\.webp$/.test(f)) fs.rmSync(path.join(FAR_OUT, f));
  const artName = `art-${hash(artSheet)}.webp`, depName = `depth-${hash(depSheet)}.webp`;
  fs.writeFileSync(path.join(FAR_OUT, artName), artSheet);
  fs.writeFileSync(path.join(FAR_OUT, depName), depSheet);
  const manifest = { art: `/sizes/far/${artName}`, depth: `/sizes/far/${depName}`, artW, artH, depthW: depW, depthH: depH, ids };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest) + "\n");
  console.log(`far atlas: ${ids.length} figures, art ${artW}×${artH} (${Math.round(artSheet.length / 1024)} KB), depth ${depW}×${depH} (${Math.round(depSheet.length / 1024)} KB)`);
}

async function main() {
  const ids = Object.keys(BOXES).map(Number).sort((a, b) => a - b);
  await renders(ids);
  await atlas(ids);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
