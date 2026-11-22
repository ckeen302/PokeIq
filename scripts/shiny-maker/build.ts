/**
 * Builds the Shiny Pokémon Maker's Pixel data: public/shiny-maker/px/{id}.json per species and
 * public/shiny-maker/species.json (the picker's list), from the sprites scripts/shiny-maker/fetch.ts downloaded.
 *
 * Slots: every distinct (normal colour, official shiny colour) pair of a sprite's pixels. The official shiny of a
 * B/W sprite is a palette swap, so rendering each slot's shiny colour reproduces it exactly ("exact").
 * Parts: slots grouped by average-linkage clustering on OKLab distance of BOTH colours of the pair (a part's shades
 * share a hue, and the official shiny moves them together), with lightness down-weighted (shades differ in
 * lightness) and touching slots pulled together (spatial adjacency). Dark unchanged slots on the silhouette's edge
 * are the Outline. Hand-curated species (curated.ts) name their parts and say which shades belong where.
 *
 *   npx tsx scripts/shiny-maker/build.ts [ids…]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { labDist, rgbToOklab } from "../../src/lib/shiny-maker/color";
import { b64encode, rleEncode, DATA_VERSION, type PartDef, type SpeciesFile } from "../../src/lib/shiny-maker/data";
import { CURATED } from "./curated";

const CACHE = ".cache/shiny-maker";
const OUT = "public/shiny-maker";
const MAX_PARTS = 6;

type Lab = [number, number, number];
export interface BuiltSlot {
  n: number; // normal rgb as int
  s: number; // shiny rgb as int
  nLab: Lab;
  sLab: Lab;
  count: number;
  edge: number; // pixels touching transparency
  sumY: number;
}

const hex6 = (n: number) => n.toString(16).padStart(6, "0");
const labOf = (n: number) => rgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255) as Lab;

export async function readRaw(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export interface Sprite {
  id: number;
  w: number;
  h: number;
  index: Int16Array; // cropped, -1 transparent
  slots: BuiltSlot[];
  adj: number[][]; // touching pixel pairs between slots
  exact: boolean;
}

export async function loadSprite(id: number): Promise<Sprite | null> {
  const nf = join(CACHE, "bw", `${id}.png`), sf = join(CACHE, "bw-shiny", `${id}.png`);
  if (!existsSync(nf)) return null;
  const n = await readRaw(nf);
  const s = existsSync(sf) ? await readRaw(sf) : null;
  const W = n.w, H = n.h;
  let exact = !!s && s.w === W && s.h === H;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (n.data[o + 3] >= 128) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      if (exact && s && (s.data[o + 3] >= 128) !== (n.data[o + 3] >= 128)) exact = false;
    }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const keyToSlot = new Map<string, number>();
  const slots: BuiltSlot[] = [];
  const index = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = ((y + y0) * W + x + x0) * 4;
      if (n.data[o + 3] < 128) continue;
      const nc = (n.data[o] << 16) | (n.data[o + 1] << 8) | n.data[o + 2];
      const sc = exact && s && s.data[o + 3] >= 128 ? (s.data[o] << 16) | (s.data[o + 1] << 8) | s.data[o + 2] : nc;
      const key = `${nc}:${sc}`;
      let k = keyToSlot.get(key);
      if (k === undefined) {
        k = slots.length;
        keyToSlot.set(key, k);
        slots.push({ n: nc, s: sc, nLab: labOf(nc), sLab: labOf(sc), count: 0, edge: 0, sumY: 0 });
      }
      index[y * w + x] = k;
      slots[k].count++;
      slots[k].sumY += y / h;
    }
  const adj = slots.map(() => new Array(slots.length).fill(0));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : index[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = at(x, y);
      if (k < 0) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const q = at(x + dx, y + dy);
        if (q < 0) edge = true;
        else if (q !== k) adj[k][q]++;
      }
      if (edge) slots[k].edge++;
    }
  return { id, w, h, index, slots, adj, exact };
}

const isDark = (l: Lab) => l[0] < 0.25 && Math.hypot(l[1], l[2]) < 0.06;

/** Slot groups (lists of slot indices), largest first, the outline (if any) flagged. */
export function cluster(sp: Sprite, threshold = 0.085): { groups: number[][]; outline: number } {
  const { slots, adj } = sp;
  const total = slots.reduce((a, s) => a + s.count, 0);
  // The outline: dark, the same in the shiny, mostly on the silhouette's edge (or the darkest big dark slot).
  const outlineSlots = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => isDark(s.nLab) && labDist(s.nLab, s.sLab) < 0.03 && s.edge / s.count > 0.1)
    .map(({ i }) => i);
  const rest = slots.map((_, i) => i).filter((i) => !outlineSlots.includes(i));
  const perim = slots.map((_, i) => adj[i].reduce((a, b) => a + b, 0) + slots[i].edge);
  const dist = (a: number, b: number) => {
    const A = slots[a], B = slots[b];
    let d = Math.max(labDist(A.nLab, B.nLab, 0.4), labDist(A.sLab, B.sLab, 0.4));
    const touch = (adj[a][b] + adj[b][a]) / 2 / Math.max(1, Math.min(perim[a], perim[b]));
    d *= 1 - 0.5 * Math.min(1, touch * 2.5);
    return d;
  };
  const groups = rest.map((i) => [i]);
  const gd = (g: number[], h: number[]) => {
    let s = 0, w = 0;
    for (const a of g) for (const b of h) { const ww = slots[a].count * slots[b].count; s += dist(a, b) * ww; w += ww; }
    return s / w;
  };
  const size = (g: number[]) => g.reduce((a, i) => a + slots[i].count, 0);
  const merge = (limit: number, sizeAware: boolean) => {
    for (;;) {
      let best = Infinity, bi = -1, bj = -1;
      for (let i = 0; i < groups.length; i++)
        for (let j = i + 1; j < groups.length; j++) {
          let d = gd(groups[i], groups[j]);
          // Tiny groups merge more readily (a stray shade is not a part).
          if (sizeAware) d *= Math.min(size(groups[i]), size(groups[j])) / total < 0.012 ? 0.5 : 1;
          if (d < best) { best = d; bi = i; bj = j; }
        }
      if (bi < 0 || best > limit) return;
      groups[bi] = [...groups[bi], ...groups[bj]];
      groups.splice(bj, 1);
    }
  };
  merge(threshold, true);
  // Too many parts: raise the bar until they fit.
  let t = threshold;
  const budget = MAX_PARTS - (outlineSlots.length ? 1 : 0);
  while (groups.length > budget) {
    t *= 1.15;
    merge(t, true);
    if (t > 4) break;
  }
  groups.sort((a, b) => size(b) - size(a));
  if (outlineSlots.length) groups.push(outlineSlots);
  return { groups, outline: outlineSlots.length ? groups.length - 1 : -1 };
}

const GENERIC = ["Main", "Secondary", "Accent", "Detail", "Trim", "Extra"];

export function autoParts(sp: Sprite): PartDef[] {
  const { groups, outline } = cluster(sp);
  let g = 0;
  return groups.map((s, i) => (i === outline ? { n: "Outline", s, o: 1 as const } : { n: GENERIC[g++] ?? `Part ${g}`, s }));
}

/** Curated parts: each lists its shades by normal colour; any slot left out joins the part it touches most. */
export function curatedParts(sp: Sprite, spec: [string, string][]): PartDef[] {
  const byColour = new Map<number, number[]>();
  sp.slots.forEach((s, i) => byColour.set(s.n, [...(byColour.get(s.n) ?? []), i]));
  const partOf = new Array(sp.slots.length).fill(-1);
  const parts: PartDef[] = spec.map(([n, cols], pi) => {
    const s: number[] = [];
    for (const c of cols.split(/\s+/).filter(Boolean)) for (const i of byColour.get(parseInt(c, 16)) ?? []) if (partOf[i] < 0) { partOf[i] = pi; s.push(i); }
    return /^outline$/i.test(n) ? { n, s, o: 1 as const } : { n, s };
  });
  for (let i = 0; i < sp.slots.length; i++) {
    if (partOf[i] >= 0) continue;
    let best = -1, bw = -1;
    for (let j = 0; j < sp.slots.length; j++) if (partOf[j] >= 0 && sp.adj[i][j] > bw) { bw = sp.adj[i][j]; best = partOf[j]; }
    if (best < 0) best = 0;
    partOf[i] = best;
    parts[best].s.push(i);
  }
  return parts.filter((p) => p.s.length);
}

async function main() {
  const dex = JSON.parse(readFileSync("src/data/pokedex.json", "utf8")) as { id: number; name: string; types: string[] }[];
  const anim = new Set<number>(JSON.parse(readFileSync(join(CACHE, "anim.json"), "utf8")));
  mkdirSync(join(OUT, "px"), { recursive: true });
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  const list: [number, string, string][] = [];
  let exact = 0, bytes = 0;
  for (const p of dex) {
    if (p.id > 1025) continue;
    const want = !only.length || only.includes(p.id);
    const sp = want ? await loadSprite(p.id) : null;
    const file = join(OUT, "px", `${p.id}.json`);
    if (!sp) {
      if (existsSync(file)) list.push([p.id, p.name, p.types[0]]);
      else if (want) console.warn(`no sprite for ${p.id}`);
      continue;
    }
    const spec = CURATED[p.id];
    const parts = spec ? curatedParts(sp, spec) : autoParts(sp);
    const prev = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SpeciesFile) : null;
    const out: SpeciesFile = {
      v: DATA_VERSION,
      id: p.id,
      name: p.name,
      types: p.types,
      w: sp.w,
      h: sp.h,
      slots: sp.slots.map((s) => `${hex6(s.n)}:${hex6(s.s)}`),
      px: b64encode(rleEncode(Array.from(sp.index, (v) => v + 1))),
      parts,
      exact: sp.exact,
      ...(anim.has(p.id) && { anim: 1 as const }),
      // HD masks are built by hd.ts against these parts; keep them only while the parts are unchanged.
      ...(prev?.hd && JSON.stringify(prev.parts) === JSON.stringify(parts) && { hd: prev.hd }),
    };
    const json = JSON.stringify(out);
    writeFileSync(file, json);
    bytes += json.length;
    if (sp.exact) exact++;
    list.push([p.id, p.name, p.types[0]]);
  }
  list.sort((a, b) => a[0] - b[0]);
  writeFileSync(join(OUT, "species.json"), JSON.stringify(list));
  console.log(`built; exact palette swaps: ${exact}; bytes: ${bytes}`);
}

if (process.argv[1]?.endsWith("build.ts")) main();
