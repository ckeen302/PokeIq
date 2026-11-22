/**
 * Builds the Shiny Pokémon Maker's HD part masks: public/shiny-maker/hd/{id}.png (one grey level per part, 0 =
 * transparent, k = part k − 1, 512 × 512, aligned with public/sizes/art/512/{id}.webp) and each part's HD reference
 * colours (the "hd" field of public/shiny-maker/px/{id}.json).
 *
 * Every pixel of the HOME render is given to the Pixel part whose (normal, official shiny) colour pair is nearest
 * in OKLab (both colours count: the shiny tells apart parts that look alike in the normal colours), then the labels
 * are cleaned: a majority filter, and connected components too small to be a part join their neighbours.
 * A species ships HD only if the fit is good (see `quality`); scripts/shiny-maker/hd-report.json lists the scores.
 *
 *   npx tsx scripts/shiny-maker/hd.ts [ids…]          (--shard i/n to split the work across processes)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { labDist, rgbToOklab } from "../../src/lib/shiny-maker/color";
import type { HdRef, SpeciesFile } from "../../src/lib/shiny-maker/data";

const CACHE = ".cache/shiny-maker";
const OUT = "public/shiny-maker";
const N = 512;

type Lab = [number, number, number];
const labOfHex = (h: string) => { const n = parseInt(h, 16); return rgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255) as Lab; };

async function raw(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().resize(N, N, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== N) throw new Error("size");
  return data;
}

function refOf(labs: Lab[]): [number, number, number] {
  if (!labs.length) return [0.5, 0, 0];
  let L = 0, A = 0, B = 0, C = 0;
  for (const [l, a, b] of labs) { L += l; A += a; B += b; C += Math.hypot(a, b); }
  const n = labs.length;
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [+(L / n).toFixed(4), +(C / n).toFixed(4), +h.toFixed(1)];
}

export async function buildHd(id: number) {
  const pxFile = join(OUT, "px", `${id}.json`);
  const nf = join("public/sizes/art/512", `${id}.webp`), sf = join(CACHE, "home-shiny", `${id}.png`);
  if (!existsSync(pxFile) || !existsSync(nf) || !existsSync(sf)) return null;
  const f = JSON.parse(readFileSync(pxFile, "utf8")) as SpeciesFile;
  const [nd, sd] = await Promise.all([raw(nf), raw(sf)]);
  // Candidate slots (not the outline: HOME renders have no drawn outline).
  const cand: { n: Lab; s: Lab; part: number }[] = [];
  f.parts.forEach((p, pi) => { if (!p.o) for (const s of p.s) { const [a, b] = f.slots[s].split(":"); cand.push({ n: labOfHex(a), s: labOfHex(b), part: pi }); } });
  if (!cand.length) return null;
  const label = new Int16Array(N * N).fill(-1);
  const dists: number[] = [];
  const memo = new Map<number, [number, number]>();
  for (let i = 0; i < N * N; i++) {
    if (nd[i * 4 + 3] < 128) continue;
    const key = ((nd[i * 4] >> 2) << 18 | (nd[i * 4 + 1] >> 2) << 12 | (nd[i * 4 + 2] >> 2) << 6) * 4096 + ((sd[i * 4] >> 3) << 10 | (sd[i * 4 + 1] >> 3) << 5 | (sd[i * 4 + 2] >> 3));
    let m = memo.get(key);
    if (!m) {
      const n = rgbToOklab(nd[i * 4], nd[i * 4 + 1], nd[i * 4 + 2]) as Lab;
      const s = sd[i * 4 + 3] >= 128 ? (rgbToOklab(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]) as Lab) : n;
      let best = Infinity, bp = 0;
      for (const c of cand) {
        const d = Math.max(labDist(n, c.n, 0.5), labDist(s, c.s, 0.5));
        if (d < best) { best = d; bp = c.part; }
      }
      m = [bp, best];
      memo.set(key, m);
    }
    label[i] = m[0];
    dists.push(m[1]);
  }
  // Majority filter (5 × 5), twice.
  const P = f.parts.length;
  for (let pass = 0; pass < 2; pass++) {
    const next = label.slice();
    const cnt = new Int32Array(P);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (label[i] < 0) continue;
        cnt.fill(0);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          const v = label[yy * N + xx];
          if (v >= 0) cnt[v]++;
        }
        let bv = label[i];
        for (let k = 0; k < P; k++) if (cnt[k] > cnt[bv]) bv = k;
        next[i] = bv;
      }
    label.set(next);
  }
  // Connected components below 0.15% of the figure join the neighbour they touch most.
  const total = label.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  const minSize = Math.max(24, total * 0.0015);
  const comp = new Int32Array(N * N).fill(-1);
  const stack: number[] = [];
  let nc = 0;
  for (let i = 0; i < N * N; i++) {
    if (label[i] < 0 || comp[i] >= 0) continue;
    const members: number[] = [];
    const touch = new Map<number, number>();
    comp[i] = nc; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      members.push(j);
      const x = j % N, y = (j / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const k = yy * N + xx;
        if (label[k] < 0) continue;
        if (label[k] === label[i]) { if (comp[k] < 0) { comp[k] = nc; stack.push(k); } }
        else touch.set(label[k], (touch.get(label[k]) ?? 0) + 1);
      }
    }
    nc++;
    if (members.length < minSize && touch.size) {
      const to = [...touch.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const j of members) label[j] = to;
    }
  }
  // Soft edge pixels (alpha 1–127) take the nearest labelled neighbour.
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < N * N; i++) {
      if (label[i] >= 0 || nd[i * 4 + 3] === 0) continue;
      const x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        if (label[yy * N + xx] >= 0) { label[i] = label[yy * N + xx]; break; }
      }
    }
  // Reference colours per part, and the fit.
  const nl: Lab[][] = f.parts.map(() => []), sl: Lab[][] = f.parts.map(() => []);
  for (let i = 0; i < N * N; i++) {
    if (label[i] < 0 || nd[i * 4 + 3] < 200) continue;
    if ((i & 3) !== 0) continue; // a quarter of the pixels is plenty for the averages
    nl[label[i]].push(rgbToOklab(nd[i * 4], nd[i * 4 + 1], nd[i * 4 + 2]) as Lab);
    sl[label[i]].push(sd[i * 4 + 3] >= 128 ? (rgbToOklab(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]) as Lab) : nl[label[i]][nl[label[i]].length - 1]);
  }
  const hd: HdRef[] = f.parts.map((_, pi) => [...refOf(nl[pi]), ...refOf(sl[pi])] as HdRef);
  dists.sort((a, b) => a - b);
  const quality = { median: +dists[dists.length >> 1].toFixed(3), p90: +dists[Math.floor(dists.length * 0.9)].toFixed(3), far: +(dists.filter((d) => d > 0.12).length / dists.length).toFixed(3) };
  const png = Buffer.alloc(N * N);
  for (let i = 0; i < N * N; i++) png[i] = label[i] < 0 ? 0 : label[i] + 1;
  return { f, hd, png, quality };
}

/** Good enough to ship: most pixels found a close colour pair. */
export const passes = (q: { median: number; p90: number; far: number }) => q.median < 0.06 && q.p90 < 0.12 && q.far < 0.1;

async function main() {
  const args = process.argv.slice(2);
  const shardArg = args.indexOf("--shard");
  const [si, sn] = shardArg >= 0 ? args[shardArg + 1].split("/").map(Number) : [0, 1];
  const ids = args.filter((a, i) => /^\d+$/.test(a) && (shardArg < 0 || i !== shardArg + 1)).map(Number);
  const all = ids.length ? ids : Array.from({ length: 1025 }, (_, i) => i + 1);
  mkdirSync(join(OUT, "hd"), { recursive: true });
  mkdirSync(join(CACHE, "hd-report"), { recursive: true });
  const report: Record<number, unknown> = {};
  for (const id of all.filter((_, i) => i % sn === si)) {
    const r = await buildHd(id);
    if (!r) continue;
    const ok = passes(r.quality);
    report[id] = { ...r.quality, ok };
    const file = join(OUT, "hd", `${id}.png`);
    if (ok) {
      await sharp(r.png, { raw: { width: N, height: N, channels: 1 } }).png({ compressionLevel: 9, palette: false }).toFile(file);
      r.f.hd = r.hd;
    } else delete r.f.hd;
    writeFileSync(join(OUT, "px", `${id}.json`), JSON.stringify(r.f));
    if (id % 50 === 0) console.log(id);
  }
  writeFileSync(join(CACHE, "hd-report", `${si}.json`), JSON.stringify(report));
}

if (process.argv[1]?.endsWith("hd.ts")) main();
