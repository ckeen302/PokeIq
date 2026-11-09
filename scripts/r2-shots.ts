/**
 * Copies PokéGuessr's screenshots from Supabase Storage to a Cloudflare R2
 * bucket (no egress fees), under the same paths (`geo/<id>.webp`), so the
 * move is one setting: NEXT_PUBLIC_MEDIA_BASE (src/lib/geo-storage). The
 * steps around it are in docs/r2-shots.md.
 *
 *   npx tsx scripts/r2-shots.ts --dry-run --limit 20   # download a sample, plan, upload nothing
 *   npx tsx scripts/r2-shots.ts                        # download all, upload all, verify
 *   npx tsx scripts/r2-shots.ts --resume               # carry on after a stop, same order
 *   npx tsx scripts/r2-shots.ts --verify-only          # HEAD a random sample of the bucket
 *
 * 1. Lists every shot id in src/data/geo.json.
 * 2. Downloads each from the public Supabase URL into the cache dir
 *    (.data/r2-shots by default; files already there with the recorded size
 *    are kept, and every download is checked against its Content-Length and,
 *    where Supabase's ETag is an MD5, against that).
 * 3. Uploads them through R2's S3 API in one fully shuffled order (a random
 *    seed, kept in the state file so --resume follows the same order), so
 *    when a file went up says nothing about which region it shows. Only
 *    Content-Type and Cache-Control are set: no custom metadata, no file
 *    names, and EXIF/XMP chunks (if a file has any) are dropped first.
 * 4. HEADs a random sample through R2_PUBLIC_BASE and checks the headers:
 *    type, caching, size, no metadata, and that Last-Modified (if R2 still
 *    sends it) doesn't group by region.
 *
 * Supabase is only read. Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE (the bucket's public root,
 * e.g. https://media.example.com; not needed for --dry-run), and optionally
 * R2_ENDPOINT (the S3 API root; by default https://<account>.r2.cloudflarestorage.com).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import geo from "../src/data/geo.json";
import { GEO_STORAGE_BASE } from "../src/lib/geo-storage";
import { Rng } from "../src/lib/rng";
import { sha256Hex, signV4 } from "./r2/sigv4";
import {
  SHOT_CACHE_CONTROL,
  SHOT_CONTENT_TYPE,
  checkHead,
  listShots,
  newSeed,
  shotKey,
  shuffledOrder,
  spreadReport,
  stripWebpMetadata,
  webpChunks,
  type GeoData,
  type ShotRef,
} from "./r2/shots";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (name: string, fallback: number) => {
  const v = option(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} wants a number`);
  return n;
};

const DRY_RUN = flag("dry-run");
const RESUME = flag("resume");
const VERIFY_ONLY = flag("verify-only");
const LIMIT = num("limit", Infinity);
const CONCURRENCY = Math.max(1, num("concurrency", 8));
const SAMPLE = num("sample", 300);
const CACHE = path.resolve(option("cache") ?? ".data/r2-shots");
const STATE_FILE = path.join(CACHE, "state.json");

if (flag("help")) {
  console.log(readFileSync(process.argv[1], "utf8").split("*/")[0]);
  console.log("Options: --dry-run --resume --verify-only --limit N --concurrency N (8) --sample N (300) --cache DIR --seed N");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// State (in the cache dir, never committed: .data/ is ignored)
// ---------------------------------------------------------------------------

interface State {
  /** The upload order's seed (this run's, or the run --resume carries on). */
  seed: number;
  /** Bytes of each downloaded original. */
  sizes: Record<string, number>;
  /** Ids uploaded in this seed's run, with the bytes that went up. */
  uploaded: Record<string, number>;
  startedAt?: string;
  finishedAt?: string;
}

function loadState(): State | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return null;
  }
}
let saveTimer: NodeJS.Timeout | null = null;
function saveState(state: State, now = false) {
  const write = () => {
    saveTimer = null;
    writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
    renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  };
  if (now) {
    if (saveTimer) clearTimeout(saveTimer);
    write();
  } else saveTimer ??= setTimeout(write, 1000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries) throw new Error(`${what}: ${(e as Error).message}`);
      await sleep(500 * 2 ** attempt);
    }
  }
}

/** Runs `fn` over `items` with `limit` at a time, taking them in order. */
async function pool<T>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

function progress(label: string, done: number, total: number, t0: number) {
  if (done !== total && done % 100 !== 0) return;
  const s = (Date.now() - t0) / 1000;
  console.log(`  ${label} ${done}/${total} (${s.toFixed(1)} s)`);
}

const cachePath = (id: string) => path.join(CACHE, `${id}.webp`);

// ---------------------------------------------------------------------------
// 1-2. List and download
// ---------------------------------------------------------------------------

async function download(ref: ShotRef, state: State): Promise<"cached" | "downloaded"> {
  const file = cachePath(ref.id);
  const known = state.sizes[ref.id];
  if (known !== undefined && existsSync(file) && statSync(file).size === known) return "cached";
  await withRetry(`download ${ref.id}`, async () => {
    const res = await fetch(`${GEO_STORAGE_BASE}/${ref.id}.webp`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const length = res.headers.get("content-length");
    if (length !== null && Number(length) !== body.length) throw new Error(`got ${body.length} bytes of ${length}`);
    const etag = (res.headers.get("etag") ?? "").replace(/^W\//, "").replace(/"/g, "");
    if (/^[0-9a-f]{32}$/.test(etag) && createHash("md5").update(body).digest("hex") !== etag) throw new Error("MD5 doesn't match the ETag");
    if (body.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP");
    writeFileSync(`${file}.part`, body);
    renameSync(`${file}.part`, file);
    state.sizes[ref.id] = body.length;
  });
  saveState(state);
  return "downloaded";
}

// ---------------------------------------------------------------------------
// 3. Upload
// ---------------------------------------------------------------------------

interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
  /** The S3 API root (R2_ENDPOINT overrides it, e.g. for an EU-jurisdiction bucket). */
  endpoint: string;
}

function r2Env(): R2Env {
  const need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE"] as const;
  const missing = need.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`set ${missing.join(", ")} (see docs/r2-shots.md), or pass --dry-run`);
  return {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET!,
    publicBase: process.env.R2_PUBLIC_BASE!.replace(/\/+$/, ""),
    endpoint: (process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, ""),
  };
}

/** The bytes that go up: the original, minus any EXIF/XMP chunks. */
const uploadBody = (id: string) => stripWebpMetadata(readFileSync(cachePath(id)));

async function put(env: R2Env, id: string, body: Buffer) {
  const url = `${env.endpoint}/${env.bucket}/${shotKey(id)}`;
  const signed = signV4({
    method: "PUT",
    url,
    headers: { "content-type": SHOT_CONTENT_TYPE, "cache-control": SHOT_CACHE_CONTROL },
    payloadHash: sha256Hex(body),
    accessKeyId: env.accessKeyId,
    secretAccessKey: env.secretAccessKey,
    region: "auto",
  });
  // fetch sets Host and Content-Length itself (both as signed / sent).
  const headers: Record<string, string> = { ...signed.headers };
  delete headers.host;
  const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// 4. Verify
// ---------------------------------------------------------------------------

async function verify(env: R2Env, refs: readonly ShotRef[], state: State) {
  const sample = new Rng(newSeed()).sample(refs, Math.min(SAMPLE, refs.length));
  console.log(`Verifying ${sample.length} random shots at ${env.publicBase}/geo/…`);
  const results: { ref: ShotRef; lastModified: number | null }[] = [];
  const failures: string[] = [];
  let withEtag = 0;
  await pool(sample, CONCURRENCY, async (ref) => {
    const res = await withRetry(`HEAD ${ref.id}`, () =>
      fetch(`${env.publicBase}/${shotKey(ref.id)}`, { method: "HEAD", signal: AbortSignal.timeout(20_000) }),
    );
    const check = checkHead(res.status, res.headers, state.uploaded[ref.id]);
    if (res.headers.get("etag")) withEtag++;
    if (check.problems.length) failures.push(`${ref.id}: ${check.problems.join("; ")}`);
    results.push({ ref, lastModified: check.lastModified });
  });
  const spread = spreadReport(results);
  console.log(`  header problems: ${failures.length}`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  console.log(`  with ETag: ${withEtag}/${sample.length} (a hash of the bytes: says nothing about the place)`);
  if (spread.withLastModified === 0) {
    console.log("  Last-Modified: not sent. Nothing to group by.");
  } else {
    console.log(`  Last-Modified: on ${spread.withLastModified}/${sample.length}, spread ${spread.spreadSeconds.toFixed(0)} s`);
    console.log(`  rank correlation with the data's (region-grouped) order: ${spread.orderCorrelation} (0 is ideal)`);
    const regions = Object.entries(spread.regionPositions).sort((a, b) => a[1] - b[1]);
    console.log(`  each region's mean place in the run, 0 = start, 1 = end (about 0.5 when shuffled): ${regions.map(([r, m]) => `${r} ${m}`).join(", ")}`);
    console.log(`  region grouping, permutation test: p = ${spread.regionP} (tiny means grouped)`);
    console.log(spread.grouped ? "  !! Upload times look grouped by region: do NOT turn on NEXT_PUBLIC_GEO_SHOTS_DIRECT." : "  Upload times don't group by region.");
  }
  const ok = failures.length === 0 && !spread.grouped;
  console.log(ok ? "Verified." : "Verification FAILED.");
  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const all = listShots(geo as unknown as GeoData);
  const prior = loadState();
  const seedOption = option("seed");
  const state: State =
    RESUME || VERIFY_ONLY
      ? (prior ?? { seed: newSeed(), sizes: {}, uploaded: {} })
      : { seed: seedOption !== undefined ? Number(seedOption) >>> 0 : newSeed(), sizes: prior?.sizes ?? {}, uploaded: {} };
  if (RESUME && !prior) console.log("No earlier run in the cache: starting a fresh one.");

  // The upload order. --limit takes its start, so a sample is random too and
  // a resumed sample is the same one.
  const order = shuffledOrder(all, state.seed);
  const refs = Number.isFinite(LIMIT) ? order.slice(0, LIMIT) : order;
  console.log(`${all.length} screenshots in src/data/geo.json${refs.length < all.length ? `, taking the first ${refs.length} of this run's shuffled order` : ""}.`);

  if (VERIFY_ONLY) {
    const uploaded = all.filter((r) => state.uploaded[r.id] !== undefined);
    const ok = await verify(r2Env(), uploaded.length ? uploaded : all, state);
    process.exit(ok ? 0 : 1);
  }
  const env = DRY_RUN ? null : r2Env();

  console.log(`Downloading to ${CACHE} …`);
  const t0 = Date.now();
  let fresh = 0;
  let bytes = 0;
  let done = 0;
  const failed: string[] = [];
  await pool(refs, CONCURRENCY, async (ref) => {
    try {
      if ((await download(ref, state)) === "downloaded") fresh++;
      bytes += state.sizes[ref.id];
    } catch (e) {
      failed.push((e as Error).message);
    }
    progress("downloaded", ++done, refs.length, t0);
  });
  saveState(state, true);
  const dlSeconds = (Date.now() - t0) / 1000;
  console.log(`  ${refs.length - failed.length}/${refs.length} in the cache (${fresh} fetched now, ${(bytes / 1e6).toFixed(1)} MB, ${dlSeconds.toFixed(1)} s).`);
  for (const f of failed.slice(0, 20)) console.log(`  ! ${f}`);
  if (failed.length) throw new Error(`${failed.length} downloads failed: run again (it carries on where it stopped).`);

  // Metadata: drop EXIF/XMP if any file has them.
  const chunkKinds = new Map<string, number>();
  let stripped = 0;
  for (const ref of refs) {
    const original = readFileSync(cachePath(ref.id));
    for (const c of new Set(webpChunks(original))) chunkKinds.set(c, (chunkKinds.get(c) ?? 0) + 1);
    if (stripWebpMetadata(original) !== original) stripped++;
  }
  console.log(`  WebP chunks: ${[...chunkKinds].map(([c, n]) => `${c.trim()} ×${n}`).join(", ")}; ${stripped} carry EXIF/XMP, dropped on upload.`);

  const todo = refs.filter((r) => state.uploaded[r.id] === undefined);
  console.log(`Upload order: shuffled with seed ${state.seed}; first five ${refs.slice(0, 5).map((r) => r.id).join(", ")}.`);
  const avg = bytes / refs.length;
  console.log(`  ${todo.length} to upload (${((todo.length * avg) / 1e6).toFixed(0)} MB).`);

  if (DRY_RUN || !env) {
    const regions = new Map<string, number>();
    refs.slice(0, Math.ceil(refs.length / 10)).forEach((r) => regions.set(r.region, (regions.get(r.region) ?? 0) + 1));
    console.log(`  the first tenth of the order spans ${regions.size} regions.`);
    console.log("Dry run: nothing uploaded.");
    return;
  }

  state.startedAt ??= new Date().toISOString();
  saveState(state, true);
  console.log(`Uploading to R2 bucket ${env.bucket}, ${CONCURRENCY} at a time …`);
  const t1 = Date.now();
  let up = 0;
  const upFailed: string[] = [];
  await pool(todo, CONCURRENCY, async (ref) => {
    try {
      const body = uploadBody(ref.id);
      await withRetry(`upload ${ref.id}`, () => put(env, ref.id, body));
      state.uploaded[ref.id] = body.length;
      saveState(state);
    } catch (e) {
      upFailed.push((e as Error).message);
    }
    progress("uploaded", ++up, todo.length, t1);
  });
  state.finishedAt = new Date().toISOString();
  saveState(state, true);
  const upSeconds = (Date.now() - t1) / 1000;
  console.log(`  ${todo.length - upFailed.length}/${todo.length} uploaded in ${upSeconds.toFixed(0)} s.`);
  for (const f of upFailed.slice(0, 20)) console.log(`  ! ${f}`);
  if (upFailed.length) throw new Error(`${upFailed.length} uploads failed: run again with --resume.`);

  const ok = await verify(env, refs, state);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
