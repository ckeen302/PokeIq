/**
 * The reviewed fallback for the 3D style's part masks (see `buildHdFallback`, used by hd.ts for species its own
 * automatic checks leave out): public/shiny-maker/hd/{id}.png (one grey level per part, 0 = drawn as rendered,
 * k = part k − 1, 512 × 512, aligned with public/sizes/art/512/{id}.webp) and each part's reference colours.
 *
 * Every pixel of the HOME render is given to the Pixel part whose (normal, official shiny) colour pair is nearest
 * in OKLab (both colours count: the shiny tells apart parts that look alike in the normal colours), then the labels
 * are cleaned: a majority filter, and connected components too small to be a part join their neighbours.
 * The hand-reviewed species (`hdAllowed`) keep exactly the masks they were reviewed with. Every other species is built
 * with `buildHdAuto` (dark unchanged colours kept as rendered, the palette refined to the render, region voting,
 * the best of a few settings), or with the setting or one-piece fallback its review chose (hd-review.ts).
 * Review sheets: hd-sheet.ts (as shipped) and hd-variants.ts (every setting side by side).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { labDist, rgbToOklab } from "../../src/lib/shiny-maker/color";
import { b64decode, rleDecode, type HdRef, type SpeciesFile } from "../../src/lib/shiny-maker/data";
import { CURATED } from "./curated";
import { HD_FIXES } from "./hd-review";

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

/**
 * `keep`: also offer the outline's (dark, unchanged in the shiny) colours as candidates; pixels that match them best
 * (pupils, dark markings that the shiny leaves alone) get no part and are drawn as rendered. The reviewed species
 * were built without it and keep their masks.
 */
function segmentVote(label: Int16Array, nd: Buffer, sd: Buffer, nLabels: number, k: number) {
  const lab = new Float32Array(N * N * 6);
  for (let i = 0; i < N * N; i++) {
    if (label[i] < 0) continue;
    const a = rgbToOklab(nd[i * 4], nd[i * 4 + 1], nd[i * 4 + 2]);
    const b = sd[i * 4 + 3] >= 128 ? rgbToOklab(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]) : a;
    lab.set([...a, ...b], i * 6);
  }
  const w = (i: number, j: number) => {
    let dn = 0, ds = 0;
    for (let t = 0; t < 3; t++) { dn += (lab[i * 6 + t] - lab[j * 6 + t]) ** 2; ds += (lab[i * 6 + 3 + t] - lab[j * 6 + 3 + t]) ** 2; }
    return Math.sqrt(Math.max(dn, ds));
  };
  const ea: number[] = [], eb: number[] = [], ew: number[] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (label[i] < 0) continue;
      if (x + 1 < N && label[i + 1] >= 0) { ea.push(i); eb.push(i + 1); ew.push(w(i, i + 1)); }
      if (y + 1 < N && label[i + N] >= 0) { ea.push(i); eb.push(i + N); ew.push(w(i, i + N)); }
    }
  const order = Array.from(ew.keys()).sort((p, q) => ew[p] - ew[q]);
  const parent = new Int32Array(N * N).map((_, i) => i), size = new Int32Array(N * N).fill(1), inner = new Float32Array(N * N);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const e of order) {
    const a = find(ea[e]), b = find(eb[e]);
    if (a === b) continue;
    if (ew[e] <= Math.min(inner[a] + k / size[a], inner[b] + k / size[b])) {
      const [big, small] = size[a] >= size[b] ? [a, b] : [b, a];
      parent[small] = big; size[big] += size[small]; inner[big] = ew[e];
    }
  }
  const votes = new Map<number, Int32Array>();
  for (let i = 0; i < N * N; i++) {
    if (label[i] < 0) continue;
    const r = find(i);
    let v = votes.get(r);
    if (!v) votes.set(r, (v = new Int32Array(nLabels)));
    v[label[i]]++;
  }
  const win = new Map<number, number>();
  for (const [r, v] of votes) { let b = 0; for (let t = 1; t < nLabels; t++) if (v[t] > v[b]) b = t; win.set(r, b); }
  for (let i = 0; i < N * N; i++) if (label[i] >= 0) label[i] = win.get(find(i))!;
}

export async function buildHd(id: number, opts: { keep?: boolean; k?: number; wl?: number } = {}) {
  const pxFile = join(OUT, "px", `${id}.json`);
  const nf = join("public/sizes/art/512", `${id}.webp`), sf = join(CACHE, "home-shiny", `${id}.png`);
  if (!existsSync(pxFile) || !existsSync(nf) || !existsSync(sf)) return null;
  const f = JSON.parse(readFileSync(pxFile, "utf8")) as SpeciesFile;
  const [nd, sd] = await Promise.all([raw(nf), raw(sf)]);
  // Candidate slots (not the outline: HOME renders have no drawn outline).
  const cand: { n: Lab; s: Lab; part: number }[] = [];
  const P = f.parts.length, KEEP = P;
  f.parts.forEach((p, pi) => { if (!p.o || opts.keep) for (const s of p.s) { const [a, b] = f.slots[s].split(":"); cand.push({ n: labOfHex(a), s: labOfHex(b), part: p.o ? KEEP : pi }); } });
  if (!cand.some((c) => c.part !== KEEP)) return null;
  const label = new Int16Array(N * N).fill(-1);
  const dists: number[] = [];
  // The render's distinct (normal, shiny) colour pairs, quantised, with their pixel counts.
  const keyOf = new Int32Array(N * N).fill(-1);
  const uniq = new Map<number, number>();
  const un: Lab[] = [], us: Lab[] = [], uw: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (nd[i * 4 + 3] < 128) continue;
    const key = ((nd[i * 4] >> 2) << 18 | (nd[i * 4 + 1] >> 2) << 12 | (nd[i * 4 + 2] >> 2) << 6) * 4096 + ((sd[i * 4] >> 3) << 10 | (sd[i * 4 + 1] >> 3) << 5 | (sd[i * 4 + 2] >> 3));
    let u = uniq.get(key);
    if (u === undefined) {
      u = un.length;
      uniq.set(key, u);
      const n = rgbToOklab(nd[i * 4], nd[i * 4 + 1], nd[i * 4 + 2]) as Lab;
      un.push(n);
      us.push(sd[i * 4 + 3] >= 128 ? (rgbToOklab(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]) as Lab) : n);
      uw.push(0);
    }
    uw[u]++;
    keyOf[i] = u;
  }
  const wl = opts.wl ?? 0.5;
  const assign = () => {
    const ci = new Int32Array(un.length), cd = new Float64Array(un.length);
    for (let u = 0; u < un.length; u++) {
      let best = Infinity, bc = 0;
      for (let c = 0; c < cand.length; c++) {
        const d = Math.max(labDist(un[u], cand[c].n, wl), labDist(us[u], cand[c].s, wl));
        if (d < best) { best = d; bc = c; }
      }
      ci[u] = bc; cd[u] = best;
    }
    return { ci, cd };
  };
  let a = assign();
  const fit = a.cd;
  // Refinement (built with `keep`): each candidate pair moves halfway to the mean of the render's colours it won,
  // so the sprite's palette adapts to the render's lighting; the outline's colours stay put.
  if (opts.keep)
    for (let it = 0; it < 6; it++) {
      const acc = cand.map(() => ({ n: [0, 0, 0], s: [0, 0, 0], w: 0 }));
      for (let u = 0; u < un.length; u++) {
        const t = acc[a.ci[u]], w = uw[u];
        for (let k = 0; k < 3; k++) { t.n[k] += un[u][k] * w; t.s[k] += us[u][k] * w; }
        t.w += w;
      }
      cand.forEach((c, k) => {
        const t = acc[k];
        if (c.part === KEEP || t.w < 20) return;
        c.n = c.n.map((v, j) => (v + t.n[j] / t.w) / 2) as Lab;
        c.s = c.s.map((v, j) => (v + t.s[j] / t.w) / 2) as Lab;
      });
      a = assign();
    }
  for (let i = 0; i < N * N; i++) {
    const u = keyOf[i];
    if (u < 0) continue;
    label[i] = cand[a.ci[u]].part;
    dists.push(fit[u]);
  }
  // Regions (built with `keep`): a render's shading changes gradually while parts meet at sharp edges, so the
  // figure is cut into regions of smoothly changing colour (graph-based segmentation, Felzenszwalb & Huttenlocher
  // 2004, on both renders) and each region takes the part most of its pixels matched.
  if (opts.keep) segmentVote(label, nd, sd, P + 1, opts.k ?? 0.6);
  // Majority filter (5 × 5), twice.
  for (let pass = 0; pass < 2; pass++) {
    const next = label.slice();
    const cnt = new Int32Array(P + 1);
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
        for (let k = 0; k <= P; k++) if (cnt[k] > cnt[bv]) bv = k;
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
    if (members.length < (label[i] === KEEP ? minSize / 4 : minSize) && touch.size) {
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
    if (label[i] < 0 || label[i] === KEEP || nd[i * 4 + 3] < 200) continue;
    if ((i & 3) !== 0) continue; // a quarter of the pixels is plenty for the averages
    nl[label[i]].push(rgbToOklab(nd[i * 4], nd[i * 4 + 1], nd[i * 4 + 2]) as Lab);
    sl[label[i]].push(sd[i * 4 + 3] >= 128 ? (rgbToOklab(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]) as Lab) : nl[label[i]][nl[label[i]].length - 1]);
  }
  const hd: HdRef[] = f.parts.map((_, pi) => [...refOf(nl[pi]), ...refOf(sl[pi])] as HdRef);
  dists.sort((a, b) => a - b);
  const quality = { median: +dists[dists.length >> 1].toFixed(3), p90: +dists[Math.floor(dists.length * 0.9)].toFixed(3), far: +(dists.filter((d) => d > 0.12).length / dists.length).toFixed(3) };
  const png = Buffer.alloc(N * N);
  for (let i = 0; i < N * N; i++) png[i] = label[i] < 0 || label[i] === KEEP ? 0 : label[i] + 1;
  return { f, hd, png, quality };
}

/** Each Pixel part's share of the sprite's figure (outline left out): what the HD parts should roughly reproduce. */
export function spriteShares(f: SpeciesFile): number[] {
  const idx = rleDecode(b64decode(f.px), f.w * f.h);
  const partOf = new Int16Array(f.slots.length).fill(-1);
  f.parts.forEach((p, i) => { if (!p.o) p.s.forEach((s) => (partOf[s] = i)); });
  const c = new Array(f.parts.length).fill(0);
  let t = 0;
  for (const v of idx) if (v >= 0 && partOf[v] >= 0) { c[partOf[v]]++; t++; }
  return c.map((x) => x / Math.max(1, t));
}

/** Each part's share of an HD mask's labelled pixels. */
export function maskShares(png: Uint8Array, parts: number): number[] {
  const c = new Array(parts).fill(0);
  let t = 0;
  for (const v of png) if (v) { c[v - 1]++; t++; }
  return c.map((x) => x / Math.max(1, t));
}

/** How far the HD parts' shares are from the sprite's (L1, 0 = the same, 2 = nothing in common). */
export const shareGap = (a: number[], b: number[]) => +a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0).toFixed(3);

export const VARIANTS = [0.5, 0.25, 0.1].flatMap((wl) => [0.6, 1].map((k) => ({ wl, k })));

/**
 * The automatic HD build for species without a reviewed mask: `keep`, refinement and regions at a few lightness
 * weights (how much a pixel's lightness counts against its colour; the render's lighting is not the sprite's) and
 * region sizes, keeping the one whose parts cover the figure most like the Pixel parts do, so a part is the same
 * part in both styles.
 */
export async function buildHdAuto(id: number) {
  let best: (NonNullable<Awaited<ReturnType<typeof buildHd>>> & { gap: number; variant: { wl: number; k: number } }) | null = null;
  for (const v of VARIANTS) {
    const r = await buildHd(id, { keep: true, ...v });
    if (!r) return null;
    const gap = shareGap(maskShares(r.png, r.f.parts.length), spriteShares(r.f));
    if (!best || gap < best.gap) best = { ...r, gap, variant: v };
  }
  return best;
}

/**
 * The first HD release: hand-curated species whose masks were reviewed on contact sheets, less those whose parts came
 * out muddled with the original method (they now take the automatic build like every other species).
 */
export const HD_REJECTED = new Set([9, 59, 155, 156, 256, 390, 635, 652, 785, 911, 913, 914, 1008]);
export const hdAllowed = (id: number) => id in CURATED && !HD_REJECTED.has(id);
/** Of those, the ones a later review of the 3D style turned down (hd.ts REJECTED): they take the automatic build. */
const HD_REVIEW_DROPPED = new Set([1007]);

/** Good enough to ship: most pixels found a close colour pair. */
export const passes = (q: { median: number; p90: number; far: number }) => q.median < 0.06 && q.p90 < 0.12 && q.far < 0.1;

/** One piece: every pixel of the figure is the species' largest part (the safe fallback, see hd-review.ts). */
export async function buildHdOnePiece(id: number) {
  const r = await buildHd(id, { keep: true });
  if (!r) return null;
  const shares = spriteShares(r.f);
  const main = shares.indexOf(Math.max(...shares));
  for (let i = 0; i < r.png.length; i++) if (r.png[i]) r.png[i] = main + 1;
  // The pixels drawn as rendered stay so (pupils); everything else recolours with the main part.
  const nd = await raw(join("public/sizes/art/512", `${id}.webp`));
  const sd = await raw(join(CACHE, "home-shiny", `${id}.png`));
  const labs: Lab[] = [], labsS: Lab[] = [];
  for (let i = 0; i < N * N; i += 4) {
    if (r.png[i] !== main + 1 || nd[i * 4 + 3] < 200) continue;
    const n = rgbToOklab(nd[i * 4], nd[i * 4 + 1], nd[i * 4 + 2]) as Lab;
    labs.push(n);
    labsS.push(sd[i * 4 + 3] >= 128 ? (rgbToOklab(sd[i * 4], sd[i * 4 + 1], sd[i * 4 + 2]) as Lab) : n);
  }
  r.hd[main] = [...refOf(labs), ...refOf(labsS)] as HdRef;
  return { ...r, gap: 0, variant: null };
}

/**
 * The fallback for 3D masks that hd.ts's automatic checks leave out: the mask the species was reviewed with — the
 * original hand-reviewed release (`hdAllowed`), the setting or one-piece fallback chosen on the contact sheets
 * (hd-review.ts), or else the automatic build, which was reviewed on the sheets too.
 */
export async function buildHdFallback(id: number): Promise<{ png: Buffer; hd: HdRef[]; how: string } | null> {
  if (hdAllowed(id) && !HD_REVIEW_DROPPED.has(id)) {
    const r = await buildHd(id);
    if (r && passes(r.quality)) return { png: r.png, hd: r.hd, how: "reviewed" };
  }
  const fix = HD_FIXES[id];
  const r = fix === "one-piece" ? await buildHdOnePiece(id) : fix ? await buildHd(id, { keep: true, ...fix }) : await buildHdAuto(id);
  if (!r) return null;
  return { png: r.png, hd: r.hd, how: fix === "one-piece" ? "one-piece" : fix ? `fixed ${JSON.stringify(fix)}` : "auto" };
}
