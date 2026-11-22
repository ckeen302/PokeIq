/**
 * Contact sheets for reviewing parts: per species the normal sprite, the official shiny and its parts in false
 * colours, with each part's name and shades listed. Writes .cache/shiny-maker/sheets/{from}-{to}.png
 *   npx tsx scripts/shiny-maker/sheet.ts 1 24        (or a list: --ids 6,25,133)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { b64decode, rleDecode, type SpeciesFile } from "../../src/lib/shiny-maker/data";

const FALSE = ["#ff3b30", "#34c759", "#0a84ff", "#ffcc00", "#bf5af2", "#ff9f0a", "#64d2ff", "#ff2d92"];
const S = 2, CELL_W = 3 * 96 * S + 380, CELL_H = 96 * S + 16;

function tile(f: SpeciesFile, mode: "n" | "s" | "p"): Buffer {
  const idx = rleDecode(b64decode(f.px), f.w * f.h);
  const partOf = new Map<number, number>();
  f.parts.forEach((p, i) => p.s.forEach((s) => partOf.set(s, i)));
  const W = 96, buf = Buffer.alloc(W * W * 4);
  const ox = Math.floor((W - f.w) / 2), oy = Math.floor((W - f.h) / 2);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const v = idx[y * f.w + x];
      if (v < 0 || x + ox >= W || y + oy >= W) continue;
      const [a, b] = f.slots[v].split(":");
      let hx = mode === "n" ? a : mode === "s" ? b : FALSE[partOf.get(v)! % FALSE.length].slice(1);
      if (mode === "p") {
        // Shade the false colour by the normal colour's lightness so ramps stay readable.
        const n = parseInt(a, 16), l = (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255;
        const c = parseInt(hx, 16);
        const k = 0.35 + 0.9 * l;
        hx = [16, 8, 0].map((sh) => Math.min(255, Math.round(((c >> sh) & 255) * k)).toString(16).padStart(2, "0")).join("");
      }
      const o = ((y + oy) * W + x + ox) * 4, c = parseInt(hx, 16);
      buf[o] = (c >> 16) & 255; buf[o + 1] = (c >> 8) & 255; buf[o + 2] = c & 255; buf[o + 3] = 255;
    }
  return buf;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function main() {
  const a = process.argv.slice(2);
  let ids: number[];
  if (a[0] === "--ids") ids = a[1].split(",").map(Number);
  else { const from = Number(a[0] ?? 1), to = Number(a[1] ?? from + 23); ids = Array.from({ length: to - from + 1 }, (_, i) => from + i); }
  const files = ids.map((id) => JSON.parse(readFileSync(`public/shiny-maker/px/${id}.json`, "utf8")) as SpeciesFile);
  const cols = 2, rows = Math.ceil(files.length / cols);
  const comps: OverlayOptions[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i], x = (i % cols) * CELL_W, y = Math.floor(i / cols) * CELL_H;
    for (const [k, m] of (["n", "s", "p"] as const).entries()) {
      const img = await sharp(tile(f, m), { raw: { width: 96, height: 96, channels: 4 } }).resize(96 * S, 96 * S, { kernel: "nearest" }).png().toBuffer();
      comps.push({ input: img, left: x + k * 96 * S, top: y + 8 });
    }
    const lines = [`#${f.id} ${f.name}${f.exact ? "" : " (not exact)"}`, ...f.parts.map((p, pi) => `${pi} ${p.n}: ${p.s.map((s) => f.slots[s].split(":")[0]).join(" ")}`)];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="${CELL_H}">${lines
      .map((l, li) => `<text x="6" y="${22 + li * 21}" font-family="monospace" font-size="${li ? 13 : 16}" fill="${li ? FALSE[(li - 1) % FALSE.length] : "#fff"}">${esc(l)}</text>`)
      .join("")}</svg>`;
    comps.push({ input: Buffer.from(svg), left: x + 3 * 96 * S, top: y });
  }
  mkdirSync(".cache/shiny-maker/sheets", { recursive: true });
  const out = join(".cache/shiny-maker/sheets", `${ids[0]}-${ids[ids.length - 1]}.png`);
  await sharp({ create: { width: cols * CELL_W, height: rows * CELL_H, channels: 4, background: "#1c1b29" } }).composite(comps).png().toFile(out);
  console.log(out);
}
main();
