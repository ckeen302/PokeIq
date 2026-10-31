/**
 * Exact spots for the fixed-camera 3D remakes' shots (see spots3d-lib.ts):
 *
 *   npx tsx scripts/geo/spots3d.ts match <cache-dir> [family]   flatten + match every shot, write <cache-dir>/matches-<family>.json
 *   npx tsx scripts/geo/spots3d.ts sheet <cache-dir> <out-dir> [family] [n]   overlay review sheets
 *
 * <cache-dir> holds rips/ (spots3d-rips.ts) and shots/ (the game's own
 * copies of the screenshots, fetched from the storage bucket on first use).
 * Nothing here is committed; spots3d-world.ts turns accepted matches into
 * src/data/geo-shot-spots-3d.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import geo from "../../src/data/geo.json";
import { GEO_STORAGE_BASE } from "../../src/lib/geo-storage";
import { RIP_SETS, ripPath } from "./spots3d-rips";
import { confidenceOf, confident, features, flatten, maskTextBox, nccMap, shrink, topTwo, type Camera, type Raster } from "./spots3d-lib";
import { rasterPng, readRaster } from "./spots3d-io";

/** Each family's camera (fitted by `fit`), message box and match gate. */
export const FAMILY: Record<string, { cam: Camera; aspect: number; box: { x0: number; x1: number; y0: number; y1: number }; gate: { min: number; margin: number } }> = {
  bdsp: {
    cam: { width: 1280, height: 720, a: 65, b: 60, c: 0.015, v0: 408 },
    aspect: 16 / 9,
    box: { x0: 0.17, x1: 0.83, y0: 0.74, y1: 0.97 },
    gate: { min: 0.6, margin: 0.12 },
  },
};
/** Pixels per tile the matching runs at, and how far around the player the flat view reaches (tiles). */
const PX = 2;
const REACH = { up: 7, down: 6, side: 12 };

export interface Match {
  id: string;
  loc: string;
  rip: string;
  /** The player's tile centre in the rip, in rip pixels (16 per tile). */
  at: [number, number];
  ripSize: [number, number];
  score: number;
  second: number | null;
  ok: boolean;
  confidence: number;
  note?: string;
}

type Loc = { name: string; region: string; shots: { id: string; family: string }[] };
const LOCATIONS = (geo as unknown as { world: { locations: Loc[] } }).world.locations;

async function shotRaster(dir: string, id: string): Promise<Raster> {
  const file = path.join(dir, "shots", `${id}.webp`);
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    const res = await fetch(`${GEO_STORAGE_BASE}/${id}.webp`);
    if (!res.ok) throw new Error(`${res.status} ${id}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readRaster(file);
}

/** Scales a shot to the camera's reference width (a 1600×900 capture is the same view as 1280×720). */
async function toReference(img: Raster, file: string, width: number): Promise<Raster> {
  if (img.w === width) return img;
  const buf = await sharp(file).resize(width).png().toBuffer();
  return readRaster(buf);
}

/** The finer resolution a match is refined at, within a tile and a half of where it was found. */
const FINE = 4;
const ripCache = new Map<string, Raster>();
async function ripFeatures(dir: string, file: string, px = PX): Promise<Raster> {
  const k = `${file}@${px}`;
  let r = ripCache.get(k);
  if (!r) {
    r = features(shrink(await readRaster(ripPath(dir, file)), 16 / px));
    ripCache.set(k, r);
  }
  return r;
}

export async function matchShot(dir: string, family: string, id: string, loc: string, cam?: Camera): Promise<Match | null> {
  const fam = { ...FAMILY[family], ...(cam ? { cam } : {}) };
  const files = (RIP_SETS[family]?.places[loc] ?? []).filter((f) => existsSync(ripPath(dir, f)));
  if (!files.length) return null;
  let shot = await shotRaster(dir, id);
  // Only whole, uncropped frames: a crop moves the player off the centre the camera model expects.
  if (Math.abs(shot.w / shot.h - fam.aspect) > 0.02) return { id, loc, rip: "", at: [0, 0], ripSize: [0, 0], score: 0, second: null, ok: false, confidence: 0, note: `cropped ${shot.w}×${shot.h}` };
  shot = await toReference(shot, path.join(dir, "shots", `${id}.webp`), fam.cam.width);
  const boxed = maskTextBox(shot, fam.box);
  const t = flatten(shot, fam.cam, PX, REACH);
  const tf = features(t.flat);
  let out: Match | null = null;
  for (const file of files) {
    const r = await ripFeatures(dir, file);
    const [best, second] = topTwo(nccMap(r, tf, t.origin), 4 * PX);
    if (!best || (out && best.score <= out.score)) continue;
    // Refine at FINE px per tile, near the coarse peak.
    const rf = await ripFeatures(dir, file, FINE);
    const tfine = flatten(shot, fam.cam, FINE, REACH);
    const c = [((best.x + 0.5) / PX) * FINE, ((best.y + 0.5) / PX) * FINE];
    const reach = Math.ceil(1.5 * FINE);
    const [fine] = topTwo(nccMap(rf, features(tfine.flat), tfine.origin, 0.4, { x0: Math.floor(c[0] - reach), y0: Math.floor(c[1] - reach), x1: Math.ceil(c[0] + reach), y1: Math.ceil(c[1] + reach) }), 0);
    const at: [number, number] = fine ? [((fine.x + 0.5) / FINE) * 16, ((fine.y + 0.5) / FINE) * 16] : [((best.x + 0.5) / PX) * 16, ((best.y + 0.5) / PX) * 16];
    out = {
      id,
      loc,
      rip: file,
      at,
      ripSize: [r.w * (16 / PX), r.h * (16 / PX)],
      score: Math.round(best.score * 1000) / 1000,
      second: second ? Math.round(second.score * 1000) / 1000 : null,
      ok: confident(best, second, fam.gate),
      confidence: confidenceOf(best, second),
      note: boxed ? "message box hidden" : undefined,
    };
  }
  return out;
}

async function matchAll(dir: string, family: string) {
  const out: Match[] = [];
  const want = new Set(Object.keys(RIP_SETS[family]?.places ?? {}));
  const todo = LOCATIONS.flatMap((l) => (want.has(l.name) ? l.shots.filter((s) => s.family === family).map((s) => ({ id: s.id, loc: l.name })) : []));
  let i = 0;
  for (const s of todo) {
    const m = await matchShot(dir, family, s.id, s.loc);
    if (m) out.push(m);
    if (++i % 20 === 0) console.log(`  ${i}/${todo.length}`);
  }
  writeFileSync(path.join(dir, `matches-${family}.json`), JSON.stringify(out, null, 1));
  const ok = out.filter((m) => m.ok).length;
  console.log(`${family}: ${todo.length} shots in mapped places, ${out.length} matched, ${ok} confident`);
}

/** Review sheets: each shot beside the map around its spot (a red ring on the player's tile). */
async function sheets(dir: string, outDir: string, family: string, n: number, which: "ok" | "rejected" | "all") {
  mkdirSync(outDir, { recursive: true });
  const matches = (JSON.parse(readFileSync(path.join(dir, `matches-${family}.json`), "utf8")) as Match[]).filter((m) => m.rip && (which === "all" || (which === "ok") === m.ok));
  const pick = matches.filter((_, i) => i % Math.max(1, Math.floor(matches.length / n)) === 0).slice(0, n);
  const W = 420;
  const H = 236;
  const tiles: OverlayOptions[] = [];
  for (const [k, m] of pick.entries()) {
    const shot = await sharp(path.join(dir, "shots", `${m.id}.webp`)).resize(W, H, { fit: "contain", background: "#000" }).png().toBuffer();
    // The map around the spot, 24×13.5 tiles (about what the shot shows), scaled to the same box.
    const meta = await sharp(ripPath(dir, m.rip)).metadata();
    const cw = 24 * 16;
    const chh = 13.5 * 16;
    const left = Math.round(m.at[0] - cw / 2);
    const top = Math.round(m.at[1] - chh * 0.55);
    const pad = { l: Math.max(0, -left), t: Math.max(0, -top), r: Math.max(0, left + cw - meta.width!), b: Math.max(0, top + chh - meta.height!) };
    const padded = await sharp(ripPath(dir, m.rip)).ensureAlpha().extend({ left: pad.l, top: pad.t, right: pad.r, bottom: pad.b, background: "#202020" }).png().toBuffer();
    const crop = await sharp(padded)
      .extract({ left: left + pad.l, top: top + pad.t, width: cw, height: Math.round(chh) })
      .resize(W, H, { kernel: "nearest" })
      .png()
      .toBuffer();
    const s = W / cw;
    const cx = (m.at[0] - left) * s;
    const cy = (m.at[1] - top) * s;
    const label = `${m.id} ${m.loc} ${m.ok ? "OK" : "rej"} s=${m.score} 2nd=${m.second ?? "-"} ${m.note ?? ""}`.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const ring = Buffer.from(
      `<svg width="${W}" height="${H + 18}"><rect width="${W}" height="18" fill="#fff"/><text x="4" y="13" font-size="11" font-family="sans-serif">${label}</text><circle cx="${cx}" cy="${cy + 18}" r="${8 * s * 1.6}" fill="none" stroke="#f00" stroke-width="3"/></svg>`,
    );
    const y = k * (H + 22);
    tiles.push({ input: shot, left: 0, top: y + 18 }, { input: crop, left: W + 6, top: y + 18 }, { input: ring, left: W + 6, top: y });
  }
  const out = path.join(outDir, `${family}-${which}.png`);
  await sharp({ create: { width: 2 * W + 6, height: Math.max(1, pick.length * (H + 22)), channels: 3, background: "#fff" } })
    .composite(tiles)
    .png()
    .toFile(out);
  console.log("wrote", out, pick.length);
}

async function main() {
  const [cmd, dir, ...rest] = process.argv.slice(2);
  if (cmd === "match") await matchAll(dir, rest[0] ?? "bdsp");
  else if (cmd === "sheet") await sheets(dir, rest[0], rest[1] ?? "bdsp", Number(rest[2] ?? 12), (rest[3] as "ok" | "rejected" | "all") ?? "ok");
  else if (cmd === "flat") {
    const [family, id] = rest;
    const fam = FAMILY[family];
    const shot = await shotRaster(dir, id);
    maskTextBox(shot, fam.box);
    writeFileSync(path.join(dir, `flat-${id}.png`), await rasterPng(flatten(shot, fam.cam, 16, REACH).flat));
  } else if (cmd === "fit") {
    // Fits the camera: the settings under which the given shots (confident matches, not the known-answer set) match best.
    const [family, idsFile] = rest;
    const ids = JSON.parse(readFileSync(idsFile, "utf8")) as { id: string; loc: string }[];
    const base = FAMILY[family].cam;
    const rows: string[] = [];
    for (const b of (process.env.FIT_B ?? "44,52,60").split(",").map(Number))
      for (const c of (process.env.FIT_C ?? "0.015,0.03,0.045").split(",").map(Number))
        for (const v0 of (process.env.FIT_V0 ?? "376,392,408").split(",").map(Number)) {
          const cam = { ...base, b, c, v0 };
          let sum = 0;
          for (const s of ids) sum += (await matchShot(dir, family, s.id, s.loc, cam))?.score ?? 0;
          rows.push(`${(sum / ids.length).toFixed(4)} b=${b} c=${c} v0=${v0}`);
          console.log(rows[rows.length - 1]);
        }
    console.log(rows.sort().reverse().slice(0, 8).join("\n"));
  } else throw new Error("usage: spots3d.ts match|sheet|flat|fit …");
}

if (process.argv[1]?.endsWith("spots3d.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
