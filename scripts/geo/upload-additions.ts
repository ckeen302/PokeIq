/**
 * The owner's one step for a batch of new PokéGuessr screenshots. From a fresh
 * checkout of the batch's branch, with nothing but the two Supabase values:
 *
 *   npm ci --ignore-scripts
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/geo/upload-additions.ts
 *
 * then commit the changed data files (it prints the exact git command).
 *
 * What it does, for every entry in scripts/geo/curation.json's `pending`:
 *   1. fetches the picture from the source recorded for it (the wiki's file
 *      page; no screenshot is ever committed to git), and refuses it if the
 *      file's sha256 isn't the one the checker looked at
 *   2. applies its crop (`crop`, else the source's "view cut at"), re-encodes it
 *      like every other shot (encodeShot: WebP, sprite games scaled up sharp,
 *      3D captures up to 1600 px wide); the output carries no metadata at all
 *      (no EXIF, XMP or ICC: sharp writes none unless asked)
 *   3. gives it a fresh random id and uploads it with upsert off (nothing in
 *      the bucket can be overwritten), in a shuffled order across the batch, so
 *      the files' upload times say nothing about their region
 *   4. moves the entry to `added` under its id as soon as it is up, so a run
 *      that stops half-way picks up where it left off
 *   5. once all are up: applies the curation to src/data/geo.json (and
 *      shot-sources.json), adds the ids to the "only ever added" fixture,
 *      measures each shot for geo-shot-meta.json, and writes any verified spot
 *      to geo-shot-spots.json
 *
 * Options:
 *   --dry-run        fetch, check, crop and encode only; prints the plan, changes nothing
 *   --to-dir <dir>   a local fake store instead of Supabase: <dir>/geo/<id>.webp
 *                    (serve <dir> and set NEXT_PUBLIC_MEDIA_BASE to it to play the shots locally)
 *   --keep <dir>     also keep each encoded file as <dir>/<key>.webp (for reviewing)
 *
 * A `pending` entry (written by whoever collected the shot, checked before upload):
 *   {
 *     "key": "p-3fk2a9",                 temporary handle, random (says nothing about the place)
 *     "region": "Alola", "name": "Route 1", "parent"?: "…",
 *     "game": "Sun / Moon",
 *     "source": "https://www.pokewiki.de/wiki/Datei:…png",   the wiki's file page
 *     "image"?: "https://…/file.png",    the file itself, when the source isn't a wiki file page
 *     "crop"?: { "left": 0, "top": 0, "width": 400, "height": 210 },   in the source file's pixels
 *     "sha256"?: "…",                    of the source file as checked
 *     "spot"?: [x, y, weight, "method", verified],   as geo-shot-spots.json has it
 *     "checked"?: "what it was checked against"
 *   }
 */
import { randomBytes, randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, encodeShot } from "./bulbapedia";
import type { Addition, Curation } from "./curate";
import { measure } from "./shot-measure";
import { type Box, fetchSource, sha256, sourceWithCut } from "./shot-source";
import { familyEra, familyOfGame } from "../../src/lib/geo-families";
import { heuristicDifficulty, type ShotMetaFile } from "../../src/lib/geo-difficulty";

export interface Pending {
  key: string;
  region: string;
  name: string;
  parent?: string;
  game: string;
  source: string;
  image?: string;
  crop?: Box;
  sha256?: string;
  spot?: [number, number, number, string, boolean];
  checked?: string;
}

const ROOT = process.cwd();
const CURATION = path.join(ROOT, "scripts/geo/curation.json");
const DATA = path.join(ROOT, "src/data/geo.json");
const META = path.join(ROOT, "src/data/geo-shot-meta.json");
const SPOTS = path.join(ROOT, "src/data/geo-shot-spots.json");
const PROTECTED = path.join(ROOT, "tests/fixtures/geo-shot-ids-protected.json");
/** Where a run keeps each uploaded file until the data is written (outside git: .data is ignored). */
const WORK = path.join(ROOT, ".data/geo-upload");

const readJson = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
/** curation.json's own layout: one-space indent, no trailing newline. */
const writeCuration = (c: Curation & { pending?: Pending[] }) => {
  if (c.pending && !c.pending.length) delete c.pending;
  writeFileSync(CURATION, JSON.stringify(c, null, 1));
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A Fisher–Yates shuffle with crypto randomness. */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A new shot id: 12 random base64url characters, like every other. */
export const newId = () => randomBytes(9).toString("base64url");

/** One shot that is up: its id, and its spot to write once the data is. */
interface Uploaded {
  id: string;
  spot?: Pending["spot"];
}

interface Store {
  name: string;
  put(id: string, body: Buffer): Promise<void>;
}

function supabaseStore(): Store {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --dry-run / --to-dir <folder>).");
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
  return {
    name: `Supabase Storage (${new URL(url).host}, bucket "${BUCKET}")`,
    async put(id, body) {
      const { error } = await bucket.upload(`${id}.webp`, body, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (error) throw new Error(error.message);
    },
  };
}

function folderStore(dir: string): Store {
  const geo = path.join(path.resolve(dir), "geo");
  mkdirSync(geo, { recursive: true });
  return {
    name: `local folder ${geo}`,
    async put(id, body) {
      const file = path.join(geo, `${id}.webp`);
      if (existsSync(file)) throw new Error("already there");
      writeFileSync(file, body);
    },
  };
}

/** Fetches, checks and encodes one pending shot. */
export async function prepare(p: Pending): Promise<{ webp: Buffer; source: string; crop: Box; size: { width: number; height: number }; hash: string }> {
  const { bytes, cut, page } = await fetchSource(p.source, p.image);
  const hash = sha256(bytes);
  if (p.sha256 && p.sha256 !== hash) throw new Error(`the source file changed since it was checked (sha256 ${hash.slice(0, 12)}…, checked ${p.sha256.slice(0, 12)}…)`);
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new Error("the source isn't a readable image");
  const size = { width: meta.width, height: meta.height };
  const crop = p.crop ?? cut ?? { left: 0, top: 0, ...size };
  if (crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1 || crop.left + crop.width > size.width || crop.top + crop.height > size.height) {
    throw new Error(`crop ${JSON.stringify(crop)} is outside the ${size.width}×${size.height} file`);
  }
  const webp = await encodeShot(bytes, p.game, crop);
  return { webp, source: sourceWithCut(page, crop, size), crop, size, hash };
}

/** Checks a pending list before anything is fetched. */
export function validate(pending: Pending[], taken: Set<string>): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const p of pending) {
    const at = p.key ?? JSON.stringify(p).slice(0, 60);
    if (!p.key) problems.push(`${at}: no key`);
    else if (keys.has(p.key)) problems.push(`${at}: key used twice`);
    keys.add(p.key);
    if (taken.has(p.key)) problems.push(`${at}: the key is already a shot id`);
    for (const f of ["region", "name", "game", "source"] as const) if (!p[f]) problems.push(`${at}: no ${f}`);
    if (p.game && !familyOfGame(p.game)) problems.push(`${at}: "${p.game}" isn't a known game label`);
  }
  return problems;
}

/** Writes everything that follows from the ids: geo.json, sources, the protected fixture, meta, spots. */
function writeData(log: Record<string, Uploaded>, meta: ShotMetaFile) {
  const uploaded = Object.values(log);
  // geo.json and shot-sources.json, exactly as any curation change is applied.
  execFileSync("npx", ["tsx", "scripts/geo/curate.ts"], { stdio: "inherit", cwd: ROOT });
  const geo = readJson<{ world: { locations: { name: string; region: string; parent?: string; shots: { id: string }[] }[] } }>(DATA);
  const live = new Set(geo.world.locations.flatMap((l) => l.shots.map((s) => s.id)));
  const missing = uploaded.filter((u) => !live.has(u.id));
  if (missing.length) throw new Error(`curate.ts didn't place ${missing.map((m) => m.id).join(", ")}`);
  // Every shot in the data is in the "only ever added" fixture (tests/geo-shots-kept.test.ts).
  const protectedIds = readJson<string[]>(PROTECTED);
  const known = new Set(protectedIds);
  for (const u of uploaded) if (!known.has(u.id)) protectedIds.push(u.id);
  writeFileSync(PROTECTED, JSON.stringify(protectedIds, null, 1) + "\n");
  writeFileSync(META, JSON.stringify(meta));
  if (uploaded.some((u) => u.spot)) {
    const spots = readJson<Record<string, unknown>>(SPOTS);
    for (const u of uploaded) if (u.spot) spots[u.id] = u.spot;
    const body = Object.entries(spots)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(",\n");
    writeFileSync(SPOTS, `{\n${body}\n}\n`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const toDir = arg("--to-dir");
  const keep = arg("--keep");
  const curation = readJson<Curation & { pending?: Pending[] }>(CURATION);
  const pending = curation.pending ?? [];
  const geo = readJson<{ world: { locations: { name: string; region: string; parent?: string; shots: { id: string }[] }[] } }>(DATA);
  const taken = new Set([...geo.world.locations.flatMap((l) => l.shots.map((s) => s.id)), ...curation.added.map((a) => a.id)]);
  const problems = validate(pending, taken);
  if (problems.length) throw new Error(`curation.json's pending list has problems:\n  ${problems.join("\n  ")}`);
  const store = dryRun ? null : toDir ? folderStore(toDir) : supabaseStore();
  if (keep) mkdirSync(keep, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  console.log(`${pending.length} shots pending${store ? ` → ${store.name}` : " (dry run: nothing is uploaded or written)"}`);

  // Shots whose upload finished in an earlier run that stopped before the data was written.
  const workLog = path.join(WORK, "uploaded.json");
  const log: Record<string, Uploaded> = existsSync(workLog) && !dryRun ? readJson(workLog) : {};
  const meta = readJson<ShotMetaFile>(META);
  const placeShots = new Map<string, number>();
  for (const l of geo.world.locations) placeShots.set(`${l.region}|${l.parent ?? l.name}`, (placeShots.get(`${l.region}|${l.parent ?? l.name}`) ?? 0) + l.shots.length);
  for (const p of pending) placeShots.set(`${p.region}|${p.parent ?? p.name}`, (placeShots.get(`${p.region}|${p.parent ?? p.name}`) ?? 0) + 1);

  let uploaded = 0;
  const failed: string[] = [];
  let n = 0;
  for (const p of shuffle(pending)) {
    n++;
    try {
      const shot = await prepare(p);
      const family = familyOfGame(p.game)!;
      const m = await measure(shot.webp, familyEra(family));
      if (keep) writeFileSync(path.join(keep, `${p.key}.webp`), shot.webp);
      const line = `${m.width}×${m.height}${m.flags ? ` flags ${m.flags}` : ""}, ${Math.round(shot.webp.length / 1024)} KB`;
      if (!store) {
        console.log(`  ${n}/${pending.length} ${p.key}: ok (${line})`);
        continue;
      }
      const id = log[p.key]?.id ?? newId();
      if (!log[p.key]) await store.put(id, shot.webp);
      log[p.key] = { id, ...(p.spot ? { spot: p.spot } : {}) };
      writeFileSync(workLog, JSON.stringify(log, null, 1));
      const d = heuristicDifficulty({ name: p.name, parent: p.parent, family, flags: m.flags, detail: m.detail, placeShots: placeShots.get(`${p.region}|${p.parent ?? p.name}`) ?? 1 });
      meta.shots[id] = [m.width, m.height, m.flags, Math.round(d * 10)];
      // Into `added` straight away: a rerun after a failure never uploads it twice.
      const addition: Addition = { id, region: p.region, name: p.name, ...(p.parent ? { parent: p.parent } : {}), game: p.game, source: shot.source, ...(p.checked ? { checked: p.checked } : {}) };
      curation.added.push(addition);
      curation.pending = (curation.pending ?? []).filter((x) => x.key !== p.key);
      writeCuration(curation);
      writeFileSync(META, JSON.stringify(meta));
      uploaded++;
      console.log(`  ${n}/${pending.length} uploaded (${line})`);
    } catch (err) {
      failed.push(`${p.key}: ${(err as Error).message}`);
      console.log(`  ! ${n}/${pending.length} ${p.key}: ${(err as Error).message}`);
    }
  }
  if (!store) {
    console.log(`\ndry run: ${pending.length - failed.length} ready, ${failed.length} failed`);
    if (failed.length) process.exitCode = 1;
    return;
  }
  const total = Object.keys(log).length;
  if (total) writeData(log, meta);
  if (failed.length) {
    console.log(`\n${uploaded} uploaded; ${failed.length} failed and are still pending:\n  ${failed.join("\n  ")}`);
    console.log("Run the same command again to retry them (nothing already uploaded goes up twice).");
    process.exitCode = 1;
  } else {
    writeFileSync(workLog, "{}");
    console.log(`\nAll ${total} uploaded and written into the data.`);
  }
  if (total) {
    console.log("Next:\n  npx vitest run tests/geo-shots-kept.test.ts tests/geo-leak.test.ts tests/geo-families.test.ts");
    console.log(`  git add scripts/geo/curation.json scripts/geo/shot-sources.json src/data/geo.json src/data/geo-shot-meta.json src/data/geo-shot-spots.json tests/fixtures/geo-shot-ids-protected.json`);
    console.log(`  git commit -m "PokéGuessr: upload ${total} new screenshots" && git push`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
