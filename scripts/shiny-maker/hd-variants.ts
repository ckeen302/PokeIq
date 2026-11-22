/**
 * Review aid for fixing an automatic HD mask: per species the Pixel parts in false colours, then the HD parts in
 * false colours for each build setting (hd.ts's VARIANTS plus FIX_EXTRA), each labelled with its setting and how far
 * its part shares are from the sprite's. A setting that looks right goes into hd-review.ts as that species' fix.
 * Writes .cache/shiny-maker/hd-variants/{first}-{last}.png
 *   npx tsx scripts/shiny-maker/hd-variants.ts 9,10,11
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { rgbToLch } from "../../src/lib/shiny-maker/color";
import { b64decode, rleDecode, type SpeciesFile } from "../../src/lib/shiny-maker/data";
import { buildHd, maskShares, shareGap, spriteShares, VARIANTS } from "./hd-auto";

export const FIX_EXTRA = [{ wl: 1, k: 0.6 }, { wl: 0.5, k: 0.3 }];
const N = 512, T = 165, FALSE = ["#ff3b30", "#34c759", "#0a84ff", "#ffcc00", "#bf5af2", "#ff9f0a", "#64d2ff", "#ff2d92"];
const ALL = [...VARIANTS, ...FIX_EXTRA];
const CELL_W = (ALL.length + 1) * T, CELL_H = T + 22;
const rgbOf = (h: string) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

async function main() {
  const ids = process.argv[2].split(",").map(Number);
  const comps: OverlayOptions[] = [];
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k], y = k * CELL_H;
    const f = JSON.parse(readFileSync(`public/shiny-maker/px/${id}.json`, "utf8")) as SpeciesFile;
    // Pixel tile.
    const idx = rleDecode(b64decode(f.px), f.w * f.h);
    const partOf = new Int16Array(f.slots.length);
    f.parts.forEach((p, i) => p.s.forEach((s) => (partOf[s] = i)));
    const S = Math.max(f.w, f.h), pb = Buffer.alloc(S * S * 4), ox = (S - f.w) >> 1, oy = (S - f.h) >> 1;
    for (let i = 0; i < f.w * f.h; i++) {
      const v = idx[i];
      if (v < 0) continue;
      const pi = partOf[v], o = (((i / f.w) | 0) + oy) * S * 4 + ((i % f.w) + ox) * 4;
      const [r, g, b] = f.parts[pi].o ? [40, 40, 40] : rgbOf(FALSE[pi % 8]);
      pb[o] = r; pb[o + 1] = g; pb[o + 2] = b; pb[o + 3] = 255;
    }
    comps.push({ input: await sharp(pb, { raw: { width: S, height: S, channels: 4 } }).resize(T, T, { kernel: "nearest" }).png().toBuffer(), left: 0, top: y + 20 });
    const ss = spriteShares(f);
    const labels = [`#${id} ${f.name}`];
    for (const [vi, v] of ALL.entries()) {
      const r = (await buildHd(id, { keep: true, ...v }))!;
      const nd = (await sharp(join("public/sizes/art/512", `${id}.webp`)).ensureAlpha().resize(N, N, { fit: "fill" }).raw().toBuffer());
      const buf = Buffer.alloc(N * N * 4);
      for (let i = 0; i < N * N; i++) {
        const o = i * 4, lab = r.png[i] - 1;
        if (nd[o + 3] === 0) continue;
        buf[o + 3] = nd[o + 3];
        const l = rgbToLch(nd[o], nd[o + 1], nd[o + 2]).l;
        if (lab < 0) { buf[o] = buf[o + 1] = buf[o + 2] = Math.round(l * 200); continue; }
        const [cr, cg, cb] = rgbOf(FALSE[lab % 8]), s = 0.25 + 0.95 * l;
        buf[o] = Math.min(255, cr * s); buf[o + 1] = Math.min(255, cg * s); buf[o + 2] = Math.min(255, cb * s);
      }
      comps.push({ input: await sharp(buf, { raw: { width: N, height: N, channels: 4 } }).resize(T, T).png().toBuffer(), left: (vi + 1) * T, top: y + 20 });
      labels.push(`${String.fromCharCode(65 + vi)} ${v.wl}/${v.k} gap ${shareGap(maskShares(r.png, f.parts.length), ss)}`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_W}" height="20">${labels
      .map((l, i) => `<text x="${i * T + 4}" y="15" font-family="monospace" font-size="12" fill="#fff">${l.replace(/&/g, "&amp;")}</text>`)
      .join("")}</svg>`;
    comps.push({ input: Buffer.from(svg), left: 0, top: y });
  }
  mkdirSync(".cache/shiny-maker/hd-variants", { recursive: true });
  const out = join(".cache/shiny-maker/hd-variants", `${ids[0]}-${ids[ids.length - 1]}.png`);
  await sharp({ create: { width: CELL_W, height: ids.length * CELL_H, channels: 4, background: "#3a3950" } }).composite(comps).png().toFile(out);
  console.log(out);
}
main();
