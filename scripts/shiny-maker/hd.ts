/**
 * Builds the Shiny Pokémon Maker's part masks for its painted styles:
 *   hd   3D: the Pokémon HOME render (public/sizes/art/512/{id}.webp), mask public/shiny-maker/hd/{id}.png (512 px)
 *   art  Artwork: the official artwork (PokeAPI, 475 px), mask public/shiny-maker/art/{id}.png
 * plus each part's reference colours (the "hd" and "art" fields of public/shiny-maker/px/{id}.json).
 *
 * Every pixel goes to the Pixel part whose (normal, official shiny) colour pair is nearest; masks are then cleaned
 * (a majority filter, small islands join their neighbours). The 3D render is matched to the B/W sprite's palette; the
 * artwork, painted in a lighter, richer palette, is matched to the palette the species' good 3D mask taught (a few
 * colour clusters per part), and must split into parts of about the same sizes as the 3D render's. A style ships for a species only if it scores well on two
 * checks: the fit (most pixels found a close colour pair) and self-consistency (moving each part's normal pixels to
 * that part's shiny colour reproduces the real official shiny closely; a muddled mask does not). The scores are in
 * .cache/shiny-maker/hd-report/.
 * Every species has 3D: one these checks leave out (or REJECTED) takes its reviewed fallback mask instead
 * (hd-auto.ts, with the review's choices in hd-review.ts; NO_FALLBACK=1 skips it).
 *
 *   npx tsx scripts/shiny-maker/hd.ts [--kind hd|art] [--shard i/n] [ids…]      (hd first: art learns from it)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { labDist, rgbToLch, rgbToOklab } from "../../src/lib/shiny-maker/color";
import type { HdRef, SpeciesFile } from "../../src/lib/shiny-maker/data";
import { makeMatcher, matchParts, RefAccumulator } from "../../src/lib/shiny-maker/match";
import { transform } from "../../src/lib/shiny-maker/recolor";
import { buildHdFallback } from "./hd-auto";

const CACHE = ".cache/shiny-maker";
const OUT = "public/shiny-maker";

export type Kind = "hd" | "art";
const SIZE: Record<Kind, number> = { hd: 512, art: 475 };

/**
 * Masks that came out muddled on review of the contact sheets (they pass the automatic checks): kept off.
 */
export const REJECTED: Record<Kind, Set<number>> = {
  hd: new Set([59, 76, 231, 235, 256, 309, 390, 518, 635, 652, 785, 911, 913, 914, 1007, 1008]),
  art: new Set([1, 289, 306, 377, 652]),
};

async function raw(file: string, N: number) {
  const { data } = await sharp(file).ensureAlpha().resize(N, N, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return data;
}

interface Picture { w: number; h: number; frames: { n: Uint8ClampedArray | Buffer; s: Uint8ClampedArray | Buffer }[]; distinctShiny: boolean }

async function picture(kind: Kind, id: number): Promise<Picture | null> {
  const N = SIZE[kind];
  const nf = kind === "hd" ? join("public/sizes/art/512", `${id}.webp`) : join(CACHE, "art", `${id}.png`);
  const sf = kind === "hd" ? join(CACHE, "home-shiny", `${id}.png`) : join(CACHE, "art-shiny", `${id}.png`);
  if (!existsSync(nf) || !existsSync(sf)) return null;
  const [n, s] = await Promise.all([raw(nf, N), raw(sf, N)]);
  return { w: N, h: N, frames: [{ n, s }], distinctShiny: !n.equals(s) };
}

/** Majority filter (5 × 5) and small islands joining their neighbours, in place. */
function clean(label: Int16Array, W: number, H: number, P: number, passes = 2) {
  for (let pass = 0; pass < passes; pass++) {
    const next = label.slice();
    const cnt = new Int32Array(P);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (label[i] < 0) continue;
        cnt.fill(0);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const v = label[yy * W + xx];
          if (v >= 0) cnt[v]++;
        }
        let bv = label[i];
        for (let k = 0; k < P; k++) if (cnt[k] > cnt[bv]) bv = k;
        next[i] = bv;
      }
    label.set(next);
  }
  const total = label.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  const minSize = Math.max(24, total * 0.0015);
  const comp = new Int32Array(W * H).fill(-1);
  const stack: number[] = [];
  let nc = 0;
  for (let i = 0; i < W * H; i++) {
    if (label[i] < 0 || comp[i] >= 0) continue;
    const members: number[] = [];
    const touch = new Map<number, number>();
    comp[i] = nc;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      members.push(j);
      const x = j % W, y = (j / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx;
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
}

type L3 = [number, number, number];
/** k-means over (normal, shiny) OKLab pairs: a few representative colour pairs per part. */
function clusters(samples: { n: L3; s: L3 }[], k: number): { n: L3; s: L3; c: number }[] {
  if (!samples.length) return [];
  const sorted = [...samples].sort((a, b) => a.n[0] - b.n[0]);
  let centers: { n: L3; s: L3; c?: number }[] = Array.from({ length: Math.min(k, sorted.length) }, (_, i) => ({ ...sorted[Math.floor(((i + 0.5) / Math.min(k, sorted.length)) * sorted.length)] }));
  for (let it = 0; it < 8; it++) {
    const acc = centers.map(() => ({ n: [0, 0, 0], s: [0, 0, 0], c: 0 }));
    for (const q of samples) {
      let best = 0, bd = Infinity;
      centers.forEach((c, ci) => { const d = labDist(q.n, c.n, 0.5) + 0.5 * labDist(q.s, c.s, 0.5); if (d < bd) { bd = d; best = ci; } });
      const a = acc[best];
      for (let j = 0; j < 3; j++) { a.n[j] += q.n[j]; a.s[j] += q.s[j]; }
      a.c++;
    }
    centers = acc.filter((a) => a.c > 0).map((a) => ({ n: a.n.map((v) => v / a.c) as L3, s: a.s.map((v) => v / a.c) as L3, c: a.c }));
  }
  return centers as { n: L3; s: L3; c: number }[];
}

const PAL_DIR = join(CACHE, "hdpal");
/** The per-part palette learnt from a species' good 3D mask (written by the hd build), if any. */
function hdPalette(id: number): { n: L3[]; s: L3[]; outline: boolean; w: number[] }[] | null {
  const file = join(PAL_DIR, `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export async function build(kind: Kind, id: number) {
  const pxFile = join(OUT, "px", `${id}.json`);
  if (!existsSync(pxFile)) return null;
  const f = JSON.parse(readFileSync(pxFile, "utf8")) as SpeciesFile;
  const pic = await picture(kind, id);
  if (!pic) return null;
  // The artwork is matched against the palette the 3D render taught (its colours are much closer to it than to the
  // B/W sprite's); without a good 3D mask, against the B/W palette.
  const learnt = kind !== "hd" ? hdPalette(id) : null;
  const parts = learnt && learnt.length === f.parts.length ? learnt : matchParts(f.slots, f.parts);
  const match = makeMatcher(parts);
  const P = f.parts.length;
  const { w: W, h: H } = pic;
  const dists: number[] = [];
  const acc = new RefAccumulator(P);
  const labels: Int16Array[] = [];
  // The animated style samples a few frames (the browser labels every frame the same way).
  const frames = pic.frames;
  for (const fr of frames) {
    const label = new Int16Array(W * H).fill(-1);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (fr.n[o + 3] < 128) continue;
      const [p, d] = match(fr.n[o], fr.n[o + 1], fr.n[o + 2], fr.s[o], fr.s[o + 1], fr.s[o + 2], pic.distinctShiny && fr.s[o + 3] >= 128);
      label[i] = p;
      dists.push(d);
    }
    {
      clean(label, W, H, P);
      // Soft edge pixels take the nearest labelled neighbour.
      for (let pass = 0; pass < 3; pass++)
        for (let i = 0; i < W * H; i++) {
          if (label[i] >= 0 || fr.n[i * 4 + 3] === 0) continue;
          const x = i % W, y = (i / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            if (label[yy * W + xx] >= 0) { label[i] = label[yy * W + xx]; break; }
          }
        }
    }
    for (let i = 0; i < W * H; i += 3) {
      const o = i * 4;
      if (label[i] < 0 || fr.n[o + 3] < 200) continue;
      const shinyOk = fr.s[o + 3] >= 200;
      acc.add(label[i], fr.n[o], fr.n[o + 1], fr.n[o + 2], shinyOk ? fr.s[o] : fr.n[o], shinyOk ? fr.s[o + 1] : fr.n[o + 1], shinyOk ? fr.s[o + 2] : fr.n[o + 2]);
    }
    labels.push(label);
  }
  const refs: HdRef[] = acc.refs();
  let palette: { n: L3[]; s: L3[]; outline: boolean; w: number[] }[] | null = null;
  if (kind === "hd") {
    const per: { n: L3; s: L3 }[][] = f.parts.map(() => []);
    const fr = frames[0], label = labels[0];
    for (let i = 0; i < W * H; i += 7) {
      const o = i * 4, p = label[i];
      if (p < 0 || fr.n[o + 3] < 200) continue;
      per[p].push({ n: rgbToOklab(fr.n[o], fr.n[o + 1], fr.n[o + 2]) as L3, s: rgbToOklab(fr.s[o], fr.s[o + 1], fr.s[o + 2]) as L3 });
    }
    const total = per.reduce((a, x) => a + x.length, 0) || 1;
    palette = f.parts.map((pt, pi) => {
      const c = clusters(per[pi], 4);
      // A part with no pixels in the render (the outline, a hidden detail) keeps its B/W shades, as a tiny share.
      if (!c.length || pt.o) { const bw = matchParts(f.slots, [pt])[0]; return { ...bw, outline: !!pt.o, w: bw.n.map(() => 0.001) }; }
      return { n: c.map((x) => x.n.map((v) => +v.toFixed(4)) as L3), s: c.map((x) => x.s.map((v) => +v.toFixed(4)) as L3), outline: false, w: c.map((x) => +(x.c / total).toFixed(4)) };
    });
  }
  // Self-consistency: each part's normal pixels moved to its shiny reference colour, against the real shiny.
  let err = 0, cnt = 0;
  if (pic.distinctShiny)
    frames.forEach((fr, fi) => {
      const label = labels[fi];
      for (let i = 0; i < W * H; i += 5) {
        const o = i * 4, p = label[i];
        if (p < 0 || fr.n[o + 3] < 200 || fr.s[o + 3] < 200) continue;
        const r = refs[p];
        const out = transform(rgbToLch(fr.n[o], fr.n[o + 1], fr.n[o + 2]), { l: r[0], c: r[1], h: r[2] }, { l: r[3], c: r[4], h: r[5], k: 1 });
        const rr = (out.h * Math.PI) / 180;
        err += labDist([out.l, out.c * Math.cos(rr), out.c * Math.sin(rr)], rgbToOklab(fr.s[o], fr.s[o + 1], fr.s[o + 2]) as [number, number, number], 1);
        cnt++;
      }
    });
  // Part areas against the 3D render's (the same model, another view): far apart means the labels went wrong.
  let shareGap: number | null = null;
  if (learnt) {
    const cnt = new Array(P).fill(0);
    let tot = 0;
    for (const l of labels) for (const v of l) if (v >= 0) { cnt[v]++; tot++; }
    const want = learnt.map((p) => p.w.reduce((a, b) => a + b, 0));
    const wt = want.reduce((a, b) => a + b, 0) || 1;
    shareGap = +(cnt.reduce((a, c, i) => a + Math.abs(c / (tot || 1) - want[i] / wt), 0) / 2).toFixed(3);
  }
  dists.sort((a, b) => a - b);
  const quality = {
    median: +dists[dists.length >> 1].toFixed(3),
    p90: +dists[Math.floor(dists.length * 0.9)].toFixed(3),
    far: +(dists.filter((d) => d > 0.12).length / dists.length).toFixed(3),
    cons: cnt ? +(err / cnt).toFixed(3) : null,
    shareGap,
  };
  const png = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) png[i] = labels[0][i] < 0 ? 0 : labels[0][i] + 1;
  return { f, refs, png, quality, W, H, distinctShiny: pic.distinctShiny, palette, learnt: !!learnt };
}

/** Masks that miss the automatic fit (their palette strays from the B/W sprite's) but were reviewed as good. */
export const ALLOWED: Record<Kind, Set<number>> = { hd: new Set(), art: new Set([6]) };

/** Good enough to ship: most pixels found a close colour pair, and the parts reproduce the official shiny. */
export const passes = (q: { median: number; p90: number; far: number; cons: number | null; shareGap: number | null }, kind: Kind) =>
  q.median < 0.06 && q.p90 < 0.12 && q.far < 0.1 && (q.cons === null || q.cons < CONS_MAX) && (q.shareGap === null || q.shareGap < SHARE_GAP_MAX);

/** Largest total difference in part areas from the 3D render's that the artwork may show. */
export const SHARE_GAP_MAX = Number(process.env.SHARE_GAP_MAX ?? 0.25);

/** Mean OKLab error of the predicted official shiny (set from the report: it keeps the reviewed bad masks out). */
export const CONS_MAX = Number(process.env.CONS_MAX ?? 0.06);

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const kind = (opt("--kind") ?? "hd") as Kind;
  const [si, sn] = (opt("--shard") ?? "0/1").split("/").map(Number);
  const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const all = ids.length ? ids : Array.from({ length: 1025 }, (_, i) => i + 1);
  mkdirSync(join(OUT, kind), { recursive: true });
  mkdirSync(join(CACHE, "hd-report"), { recursive: true });
  const report: Record<number, unknown> = {};
  for (const id of all.filter((_, i) => i % sn === si)) {
    let fb: Awaited<ReturnType<typeof buildHdFallback>> = null;
    const r = await build(kind, id);
    const pxFile = join(OUT, "px", `${id}.json`);
    const file = join(OUT, kind, `${id}.png`);
    if (!r) {
      if (existsSync(pxFile)) {
        const f = JSON.parse(readFileSync(pxFile, "utf8")) as SpeciesFile;
        if (f[kind]) { delete f[kind]; writeFileSync(pxFile, JSON.stringify(f)); }
      }
      rmSync(file, { force: true });
      continue;
    }
    const ok = (process.env.FORCE === "1" || passes(r.quality, kind) || ALLOWED[kind].has(id)) && (process.env.NO_REJECT === "1" || !REJECTED[kind].has(id));
    report[id] = { ...r.quality, ok };
    if (kind === "hd") {
      mkdirSync(PAL_DIR, { recursive: true });
      if (ok && r.palette) writeFileSync(join(PAL_DIR, `${id}.json`), JSON.stringify(r.palette));
      else rmSync(join(PAL_DIR, `${id}.json`), { force: true });
    }
    if (ok) {
      await sharp(r.png, { raw: { width: r.W, height: r.H, channels: 1 } }).png({ compressionLevel: 9 }).toFile(file);
      r.f[kind] = r.refs;
    } else if (kind === "hd" && process.env.NO_FALLBACK !== "1" && (fb = await buildHdFallback(id))) {
      // Every species has 3D: the ones these checks leave out take their reviewed mask (hd-auto.ts, hd-review.ts).
      await sharp(fb.png, { raw: { width: 512, height: 512, channels: 1 } }).png({ compressionLevel: 9 }).toFile(file);
      r.f.hd = fb.hd;
      report[id] = { ...r.quality, ok: true, fallback: fb.how };
    } else {
      delete r.f[kind];
      rmSync(file, { force: true });
    }
    writeFileSync(pxFile, JSON.stringify(r.f));
    if (id % 100 === 0) console.log(kind, id);
  }
  writeFileSync(join(CACHE, "hd-report", `${kind}-${si}.json`), JSON.stringify(report));
}

if (process.argv[1]?.endsWith("hd.ts")) main();
