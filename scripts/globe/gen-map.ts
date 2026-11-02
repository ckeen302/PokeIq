/**
 * Builds public/geo/maps/globe-gens.png: for every texel of the globe, the
 * generation of the region it belongs to (gray level = generation × 25), so
 * the globe's era filter can fade regions in on the GPU.
 *
 *   npx tsx scripts/globe/gen-map.ts
 *
 * A texel belongs to the region of the nearest labelled atlas point (every
 * town, route, landmark and region label in public/atlas/atlas.json, distance
 * measured on the sphere), and a region's generation comes from the
 * Pokédex's version table (src/lib/globe/era.ts). Rerun it when the atlas
 * gains places.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { regionGeneration } from "../../src/lib/globe/era";
import { uvOf, type Atlas } from "../../src/lib/globe/geo";

export const GEN_MAP_W = 1024;
export const GEN_MAP_H = 512;
export const GEN_STEP = 25;

const root = path.resolve(__dirname, "../..");
const atlas = JSON.parse(fs.readFileSync(path.join(root, "public/atlas/atlas.json"), "utf8")) as Atlas;

const parentOf = new Map(atlas.regions.map((r) => [r.name, r.parent ?? r.name]));
const pts: { lon: number; lat: number; gen: number }[] = [];
for (const p of [...atlas.markers, ...atlas.places, ...atlas.regions.map((r) => ({ ...r, region: r.name }))]) {
  const region = parentOf.get(p.region) ?? p.region;
  const gen = regionGeneration(region);
  if (gen === null) throw new Error(`no generation for ${region}`);
  const [u, v] = uvOf(p.x, p.y, atlas.W, atlas.H);
  pts.push({ lon: u * Math.PI * 2, lat: (0.5 - v) * Math.PI, gen });
}
const px = pts.map((p) => [Math.cos(p.lat) * Math.cos(p.lon), Math.cos(p.lat) * Math.sin(p.lon), Math.sin(p.lat)]);

const out = Buffer.alloc(GEN_MAP_W * GEN_MAP_H);
for (let j = 0; j < GEN_MAP_H; j++) {
  const lat = (0.5 - (j + 0.5) / GEN_MAP_H) * Math.PI;
  const cl = Math.cos(lat), sl = Math.sin(lat);
  for (let i = 0; i < GEN_MAP_W; i++) {
    const lon = ((i + 0.5) / GEN_MAP_W) * Math.PI * 2;
    const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = sl;
    let best = -2, gen = 0;
    for (let k = 0; k < px.length; k++) {
      const d = x * px[k][0] + y * px[k][1] + z * px[k][2];
      if (d > best) { best = d; gen = pts[k].gen; }
    }
    out[j * GEN_MAP_W + i] = gen * GEN_STEP;
  }
}
const file = path.join(root, "public/geo/maps/globe-gens.png");
void sharp(out, { raw: { width: GEN_MAP_W, height: GEN_MAP_H, channels: 1 } })
  .png({ compressionLevel: 9, palette: false })
  .toFile(file)
  .then((i) => console.log(`wrote ${path.relative(root, file)} (${i.size} bytes)`));
