/**
 * The pure parts of scripts/r2-shots.ts: which screenshots exist, the order
 * they go up in, what metadata they carry, and what a served copy may say.
 */
import { Rng } from "../../src/lib/rng";
import { GEO_SHOT_ROUTE_ID_RE } from "../../src/lib/geo-storage";

export interface GeoData {
  world: { locations: { name: string; region?: string; shots: { id: string }[] }[] };
}

export interface ShotRef {
  id: string;
  /** The region it's in: only used to check, afterwards, that upload times don't cluster by region. */
  region: string;
  /** Its position in geo.json (grouped by place, so by region). */
  index: number;
}

/** Every screenshot the game deals or still serves (retired ones included: games under way keep them), each once. */
export function listShots(data: GeoData, extraIds: Iterable<string> = []): ShotRef[] {
  const seen = new Set<string>();
  const out: ShotRef[] = [];
  const add = (id: string, region: string) => {
    if (seen.has(id)) return;
    if (!GEO_SHOT_ROUTE_ID_RE.test(id)) throw new Error(`not a screenshot id: ${JSON.stringify(id)}`);
    seen.add(id);
    out.push({ id, region, index: out.length });
  };
  for (const location of data.world.locations) for (const shot of location.shots) add(shot.id, location.region ?? "?");
  for (const id of extraIds) add(id, "?");
  return out;
}

/** The key a shot lives under, the same path as on Supabase (src/lib/geo-storage). */
export const shotKey = (id: string) => `geo/${id}.webp`;

/** A fresh random seed for a run (kept in the state file so --resume follows the same order). */
export const newSeed = () => Math.floor(Math.random() * 2 ** 32);

/** The upload order: a full Fisher–Yates shuffle, so when a file went up says nothing about where it is. */
export const shuffledOrder = <T>(items: readonly T[], seed: number): T[] => new Rng(seed).shuffle(items);

// ---------------------------------------------------------------------------
// WebP metadata
// ---------------------------------------------------------------------------

/** WebP chunks that hold free-form metadata (camera data, editing history, comments). */
const METADATA_CHUNKS = new Set(["EXIF", "XMP "]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

/**
 * The WebP without its EXIF and XMP chunks (the pixels and colour profile stay
 * exactly as they are), or the same buffer when it has none. Throws on a file
 * that isn't a well-formed WebP.
 */
export function stripWebpMetadata(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("not a WebP file");
  }
  const chunks: Buffer[] = [];
  let removed = false;
  let off = 12;
  while (off < buf.length) {
    if (off + 8 > buf.length) throw new Error("truncated WebP chunk header");
    const fourcc = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const end = off + 8 + size + (size & 1);
    if (off + 8 + size > buf.length) throw new Error(`truncated WebP chunk ${fourcc}`);
    if (METADATA_CHUNKS.has(fourcc)) removed = true;
    else chunks.push(buf.subarray(off, Math.min(end, buf.length)));
    off = end;
  }
  if (!removed) return buf;
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const vp8x = body.toString("ascii", 0, 4) === "VP8X" ? 8 : -1;
  if (vp8x >= 0) body[vp8x] &= ~(VP8X_EXIF | VP8X_XMP);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "ascii");
  return Buffer.concat([head, body]);
}

/** The chunk names in a WebP, in order (for the dry run's report). */
export function webpChunks(buf: Buffer): string[] {
  const out: string[] = [];
  for (let off = 12; off + 8 <= buf.length; ) {
    const size = buf.readUInt32LE(off + 4);
    out.push(buf.toString("ascii", off, off + 4));
    off += 8 + size + (size & 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a served copy may say
// ---------------------------------------------------------------------------

export const SHOT_CONTENT_TYPE = "image/webp";
export const SHOT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Headers that could carry something about the file beyond its bytes:
 * custom metadata, and names that hold a path or original file name.
 */
const SUSPECT_HEADER = /^(x-amz-meta-|x-goog-meta-|x-ms-meta-|x-amz-tagging|x-amz-version-id)|^content-disposition$|^x-amz-website-redirect-location$/;

export interface HeadCheck {
  problems: string[];
  /** ms since epoch, or null when the response has no Last-Modified (the best case). */
  lastModified: number | null;
}

/** What's wrong with a served shot's HEAD response, given the bytes that were uploaded. */
export function checkHead(status: number, headers: Headers, expectedBytes?: number): HeadCheck {
  const problems: string[] = [];
  if (status !== 200) problems.push(`status ${status}`);
  const type = headers.get("content-type");
  if (type !== SHOT_CONTENT_TYPE) problems.push(`content-type ${type}`);
  const cache = headers.get("cache-control");
  if (cache !== SHOT_CACHE_CONTROL) problems.push(`cache-control ${cache}`);
  const length = headers.get("content-length");
  if (expectedBytes !== undefined && length !== null && Number(length) !== expectedBytes) {
    problems.push(`content-length ${length}, uploaded ${expectedBytes}`);
  }
  headers.forEach((_value, name) => {
    if (SUSPECT_HEADER.test(name.toLowerCase())) problems.push(`header ${name}`);
  });
  const lm = headers.get("last-modified");
  const lastModified = lm ? Date.parse(lm) : null;
  return { problems, lastModified: lastModified !== null && Number.isNaN(lastModified) ? null : lastModified };
}

/** Spearman rank correlation of two equal-length series (ties get their mean rank). */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const a = ranks(xs);
  const b = ranks(ys);
  const mean = (a.length - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - mean) * (b[i] - mean);
    da += (a[i] - mean) ** 2;
    db += (b[i] - mean) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export interface SpreadReport {
  /** How many of the sample carried Last-Modified. */
  withLastModified: number;
  /** Seconds between the earliest and latest Last-Modified. */
  spreadSeconds: number;
  /** Rank correlation of upload time with geo.json order (grouped by region): near 0 when shuffled. */
  orderCorrelation: number;
  /** Per region: its shots' mean upload-time rank, 0 (start of the run) to 1 (end); about 0.5 each when shuffled. */
  regionPositions: Record<string, number>;
  /** How often shuffled region labels group at least as strongly (Kruskal–Wallis permutation test): tiny means grouped. */
  regionP: number;
  /** True when the times look grouped by region or follow the data's order. */
  grouped: boolean;
}

/** Ranks with ties at their mean rank (Last-Modified has 1-second steps, so a fast upload ties a lot). */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

/** Kruskal–Wallis H (without the tie correction, which the permutation test makes unnecessary). */
function kruskalH(rankValues: readonly number[], groups: readonly string[]): number {
  const sums = new Map<string, [number, number]>();
  rankValues.forEach((r, i) => {
    const g = sums.get(groups[i]) ?? [0, 0];
    g[0] += r;
    g[1]++;
    sums.set(groups[i], g);
  });
  const n = rankValues.length;
  const mean = (n - 1) / 2;
  let h = 0;
  for (const [sum, count] of sums.values()) h += count * (sum / count - mean) ** 2;
  return h;
}

/**
 * Whether upload times give anything away. A shuffled upload leaves every
 * region spread over the whole run (so a permutation test finds nothing) and
 * no correlation with the data's order; a region-at-a-time upload puts each
 * region in its own slice.
 */
export function spreadReport(sample: readonly { ref: ShotRef; lastModified: number | null }[], seed = 1): SpreadReport {
  const timed = sample.filter((s): s is { ref: ShotRef; lastModified: number } => s.lastModified !== null);
  const times = timed.map((s) => s.lastModified);
  const span = timed.length ? Math.max(...times) - Math.min(...times) : 0;
  if (timed.length < 3 || span === 0) {
    return { withLastModified: timed.length, spreadSeconds: span / 1000, orderCorrelation: 0, regionPositions: {}, regionP: 1, grouped: false };
  }
  const orderCorrelation = spearman(
    timed.map((s) => s.ref.index),
    times,
  );
  const r = ranks(times);
  const regions = timed.map((s) => s.ref.region);
  const observed = kruskalH(r, regions);
  const rng = new Rng(seed);
  const TRIALS = 2000;
  let atLeast = 0;
  for (let t = 0; t < TRIALS; t++) if (kruskalH(r, rng.shuffle(regions)) >= observed - 1e-9) atLeast++;
  const regionP = (atLeast + 1) / (TRIALS + 1);

  const positions = new Map<string, [number, number]>();
  r.forEach((rank, i) => {
    const g = positions.get(regions[i]) ?? [0, 0];
    g[0] += rank / (r.length - 1);
    g[1]++;
    positions.set(regions[i], g);
  });
  const regionPositions = Object.fromEntries([...positions].map(([k, [sum, count]]) => [k, Math.round((sum / count) * 100) / 100]));
  const limit = 3 / Math.sqrt(timed.length); // ~3 standard errors of a zero correlation
  return {
    withLastModified: timed.length,
    spreadSeconds: span / 1000,
    orderCorrelation: Math.round(orderCorrelation * 1000) / 1000,
    regionPositions,
    regionP: Math.round(regionP * 10000) / 10000,
    grouped: Math.abs(orderCorrelation) > limit || regionP < 0.001,
  };
}
