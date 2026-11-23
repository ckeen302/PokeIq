/**
 * Uploads hand-vetted screenshots for curation.json's `added`: each local file
 * is re-encoded like every other shot (encodeShot: 3D captures up to 1600 px
 * wide, WebP), optionally cropped first (to cut off a minimap), and uploaded
 * with upsert off, so nothing already in the bucket is ever overwritten.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/geo/upload-additions.ts [plan.json …]
 *   npx tsx scripts/geo/upload-additions.ts --check [plan.json …]   # every planned id is in the bucket
 *   npx tsx scripts/geo/upload-additions.ts --to-dir <folder> [plan.json …]   # a local fake store (testing)
 *
 * With no plan named, it takes every plan in scripts/geo/upload-plans/ that
 * still has something to upload, so the owner's step is one command.
 * `--to-dir` writes <folder>/geo/<id>.webp instead of uploading (serve the
 * folder and set NEXT_PUBLIC_MEDIA_BASE to it to play the shots locally); it
 * never marks a plan as uploaded.
 *
 * plan.json: [{ "path"|"url": "local file or the wiki file's URL", "sha256"?, "game": "Sword / Shield",
 *               "crop"?: {left,top,width,height}, "id"?, "uploaded"? }]
 *
 * An item with a `url` is downloaded from the wiki at upload time and checked
 * against its `sha256` (the exact file that was reviewed), so a batch's plan
 * carries no image files: only where each one is and what it must be.
 *
 * An item with an `id` was given its random id in advance (the batch's
 * geo.json and curation.json already use it): it goes up under that id. An
 * item without one gets a fresh random id here, as before. Either way the
 * item is marked `uploaded` once it's in, so a re-run only sends the rest.
 *
 * The items of every plan given are uploaded together in one shuffled order:
 * Storage answers with each file's upload time (Last-Modified), so files sent
 * a region at a time would let that time narrow down the region (see
 * src/lib/geo-storage.ts). Give it every batch that's ready in one run.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, encodeShot } from "./bulbapedia";
import { httpGet } from "./http";

interface Item {
  path?: string;
  url?: string;
  sha256?: string;
  game: string;
  crop?: { left: number; top: number; width: number; height: number };
  id?: string;
  uploaded?: boolean;
}

const PUBLIC_BASE = () => JSON.parse(readFileSync(path.join(process.cwd(), "src/data/geo.json"), "utf8")).storageBase as string;

const PLANS_DIR = path.join(process.cwd(), "scripts/geo/upload-plans");

/** Every plan in scripts/geo/upload-plans/ with an item not uploaded yet. */
export function pendingPlans(dir = PLANS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f))
    .filter((f) => (JSON.parse(readFileSync(f, "utf8")) as Item[]).some((i) => !i.uploaded));
}

/** A WebP file's chunk names (RIFF): an encoded shot must be the picture alone, with no EXIF, XMP or ICC profile. */
export function webpChunks(buf: Buffer): string[] {
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") throw new Error("not a WebP file");
  const out: string[] = [];
  for (let i = 12; i + 8 <= buf.length; ) {
    const size = buf.readUInt32LE(i + 4);
    out.push(buf.toString("latin1", i, i + 4));
    i += 8 + size + (size & 1);
  }
  return out;
}

/** Throws if an encoded shot carries anything but image data (a place name in its metadata would give the round away). */
export function assertNoMetadata(webp: Buffer) {
  const extra = webpChunks(webp).filter((c) => !["VP8 ", "VP8L", "VP8X", "ALPH"].includes(c));
  if (extra.length) throw new Error(`the encoded file carries metadata (${extra.join(", ")})`);
}

/** Fisher–Yates with a cryptographic source. */
function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function check(plans: string[]) {
  const base = PUBLIC_BASE();
  let missing = 0;
  for (const planPath of plans) {
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as Item[];
    for (const item of plan) {
      if (!item.id) {
        console.log(`  ? ${item.path ?? item.url}: no id yet`);
        missing++;
        continue;
      }
      const res = await fetch(`${base}/${item.id}.webp`, { method: "HEAD" });
      if (!res.ok) {
        console.log(`  ! ${item.id}: ${res.status}`);
        missing++;
      }
    }
  }
  console.log(missing ? `${missing} planned shots are not in the bucket yet` : "every planned shot is in the bucket");
  if (missing) process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const toDirAt = args.indexOf("--to-dir");
  const toDir = toDirAt >= 0 ? args[toDirAt + 1] : undefined;
  if (toDirAt >= 0 && !toDir) throw new Error("--to-dir needs a folder");
  const named = args.filter((a, i) => !a.startsWith("--") && !(toDirAt >= 0 && i === toDirAt + 1));
  if (args.includes("--check")) {
    const all = named.length ? named : readdirSync(PLANS_DIR).filter((f) => f.endsWith(".json")).map((f) => path.join(PLANS_DIR, f));
    return check(all);
  }
  const plans = named.length ? named : pendingPlans();
  if (!plans.length) {
    console.log("Nothing to upload: every plan in scripts/geo/upload-plans/ is already up.");
    return;
  }
  console.log(`plans: ${plans.map((p) => path.relative(process.cwd(), p)).join(", ")}`);
  let storage: { upload(name: string, body: Buffer, o: object): Promise<{ error: { message: string } | null }> };
  if (toDir) {
    const geo = path.join(path.resolve(toDir), "geo");
    mkdirSync(geo, { recursive: true });
    storage = {
      async upload(name, body) {
        const file = path.join(geo, name);
        if (existsSync(file)) return { error: { message: "The resource already exists" } };
        writeFileSync(file, body);
        return { error: null };
      },
    };
  } else {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --to-dir <folder> to test against a local folder).");
    storage = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
  }
  const loaded = plans.map((p) => ({ file: p, plan: JSON.parse(readFileSync(p, "utf8")) as Item[] }));
  // Older plans: an item with an id and no `uploaded` flag was uploaded by the earlier version of this script.
  for (const { plan } of loaded) for (const item of plan) if (item.id && item.uploaded === undefined) item.uploaded = true;
  const queue = shuffle(loaded.flatMap(({ file, plan }) => plan.filter((i) => !i.uploaded).map((item) => ({ file, plan, item }))));
  let done = 0;
  for (const { file, plan, item } of queue) {
    const where = item.path ?? item.url ?? "";
    const source = item.path ? readFileSync(item.path) : await httpGet(item.url!);
    const sha = createHash("sha256").update(source).digest("hex");
    if (item.sha256 && sha !== item.sha256) {
      console.log(`  ! ${item.id ?? where}: the file changed since it was reviewed (sha256 ${sha.slice(0, 12)}…), skipped`);
      continue;
    }
    const { width = 0, height = 0 } = await sharp(source).metadata();
    const crop = item.crop ?? { left: 0, top: 0, width, height };
    const webp = await encodeShot(source, item.game, crop);
    assertNoMetadata(webp);
    const id = item.id ?? randomBytes(9).toString("base64url");
    const { error } = await storage.upload(`${id}.webp`, webp, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (error) {
      console.log(`  ! ${item.id ?? where}: ${error.message}`);
      continue;
    }
    done++;
    if (toDir) continue; // a test run never marks the plan
    item.id = id;
    item.uploaded = true;
    writeFileSync(file, JSON.stringify(plan, null, 1) + "\n");
  }
  const all = loaded.flatMap(({ plan }) => plan);
  console.log(`${done} uploaded, ${all.filter((i) => i.uploaded).length}/${all.length} in the plans are in the bucket`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
