/**
 * Builds the globe's land mask, public/geo/maps/globe-mask.png and its lossless twin globe-mask.webp (the landing's):
 * the atlas mask laid flat (the land's shading and coastlines on the padded equirectangular texture, as first
 * committed in b23f92f0), stretched north–south the way src/lib/globe/geo.ts puts the atlas on the globe (the land
 * from GLOBE_LAND_N to GLOBE_LAND_S). Each row is resampled from the flat mask; columns (longitude) are unchanged.
 *
 *   npx tsx scripts/globe/gen-mask.ts
 *
 * Rerun it whenever the stretch in geo.ts changes (then scripts/globe/gen-map.ts too). It always starts from the flat
 * mask, so running it twice changes nothing.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { unstretchLat } from "../../src/lib/globe/geo";

/** The commit holding the flat (unstretched) mask. */
const FLAT = "b23f92f0:public/geo/maps/globe-mask.png";

const root = path.resolve(__dirname, "../..");
const flat = execFileSync("git", ["show", FLAT], { cwd: root, maxBuffer: 64 << 20 });

void (async () => {
  const { data, info } = await sharp(flat).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const out = Buffer.alloc(W * H * C);
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180;
    // The flat row this globe row comes from (fractional: blended between its two neighbours).
    const r = ((90 - unstretchLat(lat)) / 180) * H - 0.5;
    const r0 = Math.floor(r), f = r - r0;
    const row = (k: number) => (k >= 0 && k < H ? k : -1);
    const a = row(r0), b = row(r0 + 1);
    for (let i = 0; i < W * C; i++) {
      const va = a < 0 ? 0 : data[a * W * C + i], vb = b < 0 ? 0 : data[b * W * C + i];
      out[j * W * C + i] = Math.round(va * (1 - f) + vb * f);
    }
  }
  const img = () => sharp(out, { raw: { width: W, height: H, channels: C } });
  const png = path.join(root, "public/geo/maps/globe-mask.png"), webp = path.join(root, "public/geo/maps/globe-mask.webp");
  const a = await img().png({ compressionLevel: 9 }).toFile(png);
  const b = await img().webp({ lossless: true, effort: 6 }).toFile(webp);
  console.log(`wrote ${path.relative(root, png)} (${a.size} bytes), ${path.relative(root, webp)} (${b.size} bytes)`);
})();
