/**
 * Contact sheets for reviewing HD masks as they ship (public/shiny-maker/hd/{id}.png and the "hd" references in
 * px/{id}.json): per species the Pixel parts in false colours (what the HD parts should match), the HOME render,
 * the official shiny render, the HD parts in false colours (shaded by the render's lightness; pixels drawn as
 * rendered, such as pupils, in grey) and an automatic recolour (every part moved to a far-off hue through the same
 * transform the HD shader runs), with each part's name and its share of the sprite and of the render.
 * Writes .cache/shiny-maker/hd-sheets/{first}-{last}.png
 *   npx tsx scripts/shiny-maker/hd-sheet.ts 1 12        (or a list: --ids 6,25,133; TILE=380 for bigger tiles)
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { lchToRgb, rgbToLch } from "../../src/lib/shiny-maker/color";
import { b64decode, rleDecode, type SpeciesFile } from "../../src/lib/shiny-maker/data";
import { transform } from "../../src/lib/shiny-maker/recolor";
import { maskShares, spriteShares } from "./hd";

const N = 512, T = Number(process.env.TILE ?? 200), TEXT_W = 250, CELL_W = 5 * T + TEXT_W, CELL_H = T + 6;
const FALSE = ["#ff3b30", "#34c759", "#0a84ff", "#ffcc00", "#bf5af2", "#ff9f0a", "#64d2ff", "#ff2d92"];
const rgbOf = (h: string) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (h: string) => { const [r, g, b] = rgbOf(h); return (r * 0.3 + g * 0.59 + b * 0.11) / 255; };

async function raw(file: string, ch = 4) {
  const img = sharp(file);
  const { data } = await (ch === 4 ? img.ensureAlpha() : img.extractChannel(0)).resize(N, N, { fit: "fill", kernel: ch === 4 ? "lanczos3" : "nearest" }).raw().toBuffer({ resolveWithObject: true });
  return data;
}

const tileOf = (buf: Buffer, w = N, h = N, nearest = false) =>
  sharp(buf, { raw: { width: w, height: h, channels: 4 } }).resize(T, T, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: nearest ? "nearest" : "lanczos3" }).png().toBuffer();

function pixelTile(f: SpeciesFile) {
  const idx = rleDecode(b64decode(f.px), f.w * f.h);
  const partOf = new Int16Array(f.slots.length);
  f.parts.forEach((p, i) => p.s.forEach((s) => (partOf[s] = i)));
  const S = Math.max(f.w, f.h), buf = Buffer.alloc(S * S * 4);
  const ox = (S - f.w) >> 1, oy = (S - f.h) >> 1;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const v = idx[y * f.w + x];
      if (v < 0) continue;
      const pi = partOf[v], o = ((y + oy) * S + x + ox) * 4;
      const [cr, cg, cb] = f.parts[pi].o ? [40, 40, 40] : rgbOf(FALSE[pi % FALSE.length]);
      const k = 0.35 + 0.9 * lum(f.slots[v].split(":")[0]);
      buf[o] = Math.min(255, cr * k); buf[o + 1] = Math.min(255, cg * k); buf[o + 2] = Math.min(255, cb * k); buf[o + 3] = 255;
    }
  return tileOf(buf, S, S, true);
}

async function main() {
  const a = process.argv.slice(2);
  let ids: number[];
  if (a[0] === "--ids") ids = a[1].split(",").map(Number);
  else { const from = Number(a[0] ?? 1), to = Number(a[1] ?? from + 11); ids = Array.from({ length: to - from + 1 }, (_, i) => from + i); }
  const cols = 2, rows = Math.ceil(ids.length / cols);
  const comps: OverlayOptions[] = [];
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    const x = (k % cols) * CELL_W, y = Math.floor(k / cols) * CELL_H;
    const f = JSON.parse(readFileSync(`public/shiny-maker/px/${id}.json`, "utf8")) as SpeciesFile;
    const maskFile = `public/shiny-maker/hd/${id}.png`;
    const nd = await raw(join("public/sizes/art/512", `${id}.webp`));
    const sd = await raw(join(".cache/shiny-maker/home-shiny", `${id}.png`));
    const tiles = [await pixelTile(f), await tileOf(nd), await tileOf(sd)];
    const lines = [`#${id} ${f.name}`];
    if (f.hd && existsSync(maskFile)) {
      const m = await raw(maskFile, 1);
      const fc = Buffer.alloc(N * N * 4), rc = Buffer.alloc(N * N * 4);
      for (let i = 0; i < N * N; i++) {
        const o = i * 4, lab = m[i] - 1;
        if (nd[o + 3] === 0) continue;
        const src = rgbToLch(nd[o], nd[o + 1], nd[o + 2]);
        fc[o + 3] = rc[o + 3] = nd[o + 3];
        if (lab < 0 || f.parts[lab]?.o) {
          fc[o] = fc[o + 1] = fc[o + 2] = Math.round(src.l * 200);
          rc[o] = nd[o]; rc[o + 1] = nd[o + 1]; rc[o + 2] = nd[o + 2];
          continue;
        }
        const [cr, cg, cb] = rgbOf(FALSE[lab % FALSE.length]);
        const s = 0.25 + 0.95 * src.l;
        fc[o] = Math.min(255, cr * s); fc[o + 1] = Math.min(255, cg * s); fc[o + 2] = Math.min(255, cb * s);
        const ref = f.hd[lab];
        const t = { l: Math.min(0.85, Math.max(0.35, ref[0])), c: Math.max(0.13, ref[1]), h: (ref[2] + 120 + lab * 97) % 360, k: 1 };
        const out = transform(src, { l: ref[0], c: ref[1], h: ref[2] }, t);
        const [q, w, e] = lchToRgb(out.l, out.c, out.h);
        rc[o] = q; rc[o + 1] = w; rc[o + 2] = e;
      }
      tiles.push(await tileOf(fc), await tileOf(rc));
      const ss = spriteShares(f), ms = maskShares(m, f.parts.length);
      lines.push("part  sprite% / HD%");
      f.parts.forEach((p, pi) => { if (!p.o) lines.push(`${pi} ${p.n.slice(0, 12).padEnd(12)} ${(ss[pi] * 100).toFixed(0).padStart(3)} /${(ms[pi] * 100).toFixed(0).padStart(3)}`); });
    } else lines.push("no HD");
    tiles.forEach((input, ti) => comps.push({ input, left: x + ti * T, top: y + 3 }));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_W}" height="${CELL_H}">${lines
      .map((l, li) => `<text x="6" y="${18 + li * 18}" font-family="monospace" font-size="${li ? 13 : 15}" xml:space="preserve" fill="${li > 1 ? FALSE[Number(l.split(" ")[0]) % FALSE.length] : "#fff"}">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`)
      .join("")}</svg>`;
    comps.push({ input: Buffer.from(svg), left: x + 5 * T, top: y });
  }
  mkdirSync(".cache/shiny-maker/hd-sheets", { recursive: true });
  const out = join(".cache/shiny-maker/hd-sheets", `${ids[0]}-${ids[ids.length - 1]}.png`);
  await sharp({ create: { width: cols * CELL_W, height: rows * CELL_H, channels: 4, background: "#3a3950" } }).composite(comps).png().toFile(out);
  console.log(out);
}
main();
