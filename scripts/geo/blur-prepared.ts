/**
 * The blurred placeholders (src/data/geo-shot-blur.json) for a batch's shots
 * before they're uploaded: scripts/geo-blur.mjs makes them from storage, so a
 * shot that isn't there yet would have none, and a round dealing it would come
 * without its placeholder. This makes the same 8-pixel WebP from the encoded
 * file `harvest.ts prepare` kept (.data/harvest/<Region>/prepared/<id>.webp),
 * the exact bytes that will be uploaded. Kept in the data's order, as geo-blur.mjs does.
 *
 *   npx tsx scripts/geo/blur-prepared.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "src/data/geo.json");
const OUT = path.join(ROOT, "src/data/geo-shot-blur.json");
const HARVEST = path.join(ROOT, ".data/harvest");
/** As scripts/geo-blur.mjs. */
const WIDTH = 8;

async function main() {
  const data = JSON.parse(readFileSync(DATA, "utf8")) as { world: { locations: { shots: { id: string }[] }[] } };
  const ids = [...new Set(data.world.locations.flatMap((l) => l.shots.map((s) => s.id)))];
  const out = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, string>;
  const dirs = existsSync(HARVEST) ? readdirSync(HARVEST).map((r) => path.join(HARVEST, r, "prepared")).filter((d) => existsSync(d)) : [];
  let made = 0;
  const missing: string[] = [];
  for (const id of ids) {
    if (out[id]) continue;
    const file = dirs.map((d) => path.join(d, `${id}.webp`)).find((f) => existsSync(f));
    if (!file) {
      missing.push(id);
      continue;
    }
    const tiny = await sharp(readFileSync(file)).resize({ width: WIDTH, kernel: "lanczos3" }).webp({ quality: 60, smartSubsample: true }).toBuffer();
    out[id] = tiny.toString("base64");
    made++;
  }
  const sorted = Object.fromEntries(ids.filter((id) => out[id]).map((id) => [id, out[id]]));
  writeFileSync(OUT, JSON.stringify(sorted) + "\n");
  console.log(`${made} placeholders made from prepared files; ${Object.keys(sorted).length} in all`);
  if (missing.length) console.log(`still without one (not prepared here; run scripts/geo-blur.mjs once they're uploaded): ${missing.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
