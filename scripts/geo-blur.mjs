/**
 * PokéGuessr placeholders: an 8-pixel-wide WebP of every screenshot (a few
 * dozen bytes), shown blurred under a round's picture until it has decoded.
 * Incremental: only screenshots missing from src/data/geo-shot-blur.json are
 * fetched, so run it again after new screenshots are added.
 *
 *   node scripts/geo-blur.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import sharp from "sharp";

const DATA = "src/data/geo.json";
const OUT = "src/data/geo-shot-blur.json";
const WIDTH = 8;
const CONCURRENCY = 12;

const data = JSON.parse(readFileSync(DATA, "utf8"));
const base = data.storageBase ?? `${process.env.SUPABASE_URL}/storage/v1/object/public/geo`;
const ids = [...new Set(data.world.locations.flatMap((l) => l.shots.map((s) => s.id)))];
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = ids.filter((id) => !out[id]);
console.log(`${ids.length} screenshots, ${todo.length} to do`);

let done = 0;
let failed = 0;
async function one(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${base}/${id}.webp`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const img = sharp(Buffer.from(await res.arrayBuffer()));
      const tiny = await img.resize({ width: WIDTH, kernel: "lanczos3" }).webp({ quality: 60, smartSubsample: true }).toBuffer();
      out[id] = tiny.toString("base64");
      return;
    } catch (err) {
      if (attempt === 2) {
        failed++;
        console.warn(`${id}: ${err.message}`);
      }
    }
  }
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      await one(queue.shift());
      if (++done % 200 === 0) console.log(`${done}/${todo.length}`);
    }
  })
);
// Data order, so diffs stay small.
const sorted = Object.fromEntries(ids.filter((id) => out[id]).map((id) => [id, out[id]]));
writeFileSync(OUT, JSON.stringify(sorted) + "\n");
console.log(`wrote ${Object.keys(sorted).length} placeholders (${failed} failed)`);
