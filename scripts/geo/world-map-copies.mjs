/**
 * The world map's pre-shrunk copies: half (2,925 px) and a quarter (1,463 px)
 * of public/geo/maps/world.webp. The guess map and the atlas draw the quarter
 * copy until they're zoomed in far enough to need more, so a phone never
 * decodes the 15-megapixel original just to show the whole world.
 *
 *   node scripts/geo/world-map-copies.mjs     # after world.webp changes
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/geo/maps");
const src = path.join(DIR, "world.webp");
const { width } = await sharp(src).metadata();
for (const div of [2, 4]) {
  const w = Math.round(width / div);
  const out = path.join(DIR, `world-${w}.webp`);
  const info = await sharp(src).resize({ width: w, kernel: "lanczos3" }).webp({ quality: 86, effort: 6 }).toFile(out);
  console.log(`${path.basename(out)}: ${info.width}×${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
}
