/**
 * Builds the PokéGuessr dataset from Bulbapedia / Bulbagarden Archives.
 *
 * For every region, the Archives hold one town-map image per location with
 * that location highlighted (e.g. "Kanto Pallet Town Map.png"). All of a
 * region's maps share one base image, so:
 *   1. the per-pixel median across them reconstructs the clean region map;
 *   2. the pixels where each image differs from that base are its highlight,
 *      which gives the location's exact pin (and, for routes, its whole path).
 * Each location's wiki infobox then lists in-game screenshots from every game
 * it appears in; those are re-encoded under random ids (so image URLs reveal
 * nothing) and uploaded to the public "geo" bucket in Supabase Storage. The
 * id → location mapping lives in src/data/geo.json, which only the server reads.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:geo                 # all regions
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:geo -- kanto johto  # selected regions
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const UA = "PokeIQ-ingest/1.0 (https://pokeiq.vercel.app; cadenkeen@gmail.com)";
const ARCHIVES = "https://archives.bulbagarden.net/w/api.php";
const WIKI = "https://bulbapedia.bulbagarden.net/w/api.php";
const OUT_DATA = path.join(process.cwd(), "src/data/geo.json");
const OUT_PUBLIC = path.join(process.cwd(), "public/geo");

interface RegionConfig {
  id: string;
  name: string;
  /** Longest side the map is stored at (big HD maps are downscaled). */
  maxSide: number;
}

/*
 * Kanto is the region whose Bulbapedia data is complete and consistent: one
 * shared town-map base, a clean highlight per location and screenshots from
 * five games, every pin checked by eye. Other regions need per-region work
 * first (Kalos's maps are mixed with Lumiose street maps, Alola's are per
 * island, Galar's and Paldea's are crops at varying offsets), so they aren't
 * listed until their data has been verified the same way.
 */
const REGIONS: RegionConfig[] = [{ id: "kanto", name: "Kanto", maxSide: 400 }];

const MAX_SHOTS = 4;
const SHOT_WIDTH = 640;
const BUCKET = "geo";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: screenshots are uploaded to Supabase Storage.");
  process.exit(1);
}
const storage = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }).storage;

async function ensureBucket() {
  const { data } = await storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ["image/webp"] });
  if (error) throw new Error(`create bucket: ${error.message}`);
}

async function upload(id: string, body: Buffer) {
  const { error } = await storage
    .from(BUCKET)
    .upload(`${id}.webp`, body, { contentType: "image/webp", cacheControl: "31536000", upsert: true });
  if (error) throw new Error(`upload ${id}: ${error.message}`);
}
const MAX_MASK_POINTS = 300;

export interface GeoShot {
  id: string;
  game: string;
}

export interface GeoLocation {
  name: string;
  /** Normalised [x, y] centre of the highlight. */
  pin: [number, number];
  /** Normalised points covering the highlight (scoring = distance to the nearest). */
  mask: [number, number][];
  shots: GeoShot[];
}

export interface GeoRegion {
  id: string;
  name: string;
  map: { src: string; width: number; height: number };
  locations: GeoLocation[];
}

// ---------------------------------------------------------------------------
// HTTP helpers (polite: sequential, small delay, retries)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (err) {
      if (attempt >= 3) throw err;
    }
    await sleep(1000 * 2 ** attempt);
  }
}

async function api<T>(base: string, params: Record<string, string>): Promise<T> {
  await sleep(150);
  const res = await fetchRetry(`${base}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`);
  return (await res.json()) as T;
}

async function download(url: string): Promise<Buffer> {
  await sleep(100);
  return Buffer.from(await (await fetchRetry(url)).arrayBuffer());
}

/** Resolves File: names to their upload URLs, 50 at a time. */
async function fileUrls(files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const r = await api<{
      query: { normalized?: { from: string; to: string }[]; pages: { title: string; imageinfo?: { url: string }[] }[] };
    }>(ARCHIVES, { action: "query", titles: batch.map((f) => `File:${f}`).join("|"), prop: "imageinfo", iiprop: "url" });
    const back = new Map((r.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of r.query.pages) {
      const url = p.imageinfo?.[0]?.url;
      if (!url) continue;
      const original = (back.get(p.title) ?? p.title).replace(/^File:/, "");
      out.set(original.replace(/ /g, "_"), url);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Maps → base image + highlights
// ---------------------------------------------------------------------------

async function listMapFiles(region: string): Promise<{ name: string; width: number; height: number }[]> {
  const out: { name: string; width: number; height: number }[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const r = await api<{
      query: { allimages: { name: string; width: number; height: number }[] };
      continue?: { aicontinue: string };
    }>(ARCHIVES, { action: "query", list: "allimages", aiprefix: `${region}_`, ailimit: "500", aiprop: "size", ...cont });
    out.push(...r.query.allimages.filter((i) => i.name.endsWith("_Map.png")));
    if (!r.continue) return out;
    cont = { aicontinue: r.continue.aicontinue };
  }
}

/** The most common map size wins; near-identical sizes (±1px) count as the same. */
function dominantSize(files: { width: number; height: number }[]): { width: number; height: number } {
  const counts = new Map<string, number>();
  for (const f of files) {
    const key = `${f.width}x${f.height}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [width, height] = best.split("x").map(Number);
  return { width, height };
}

interface Highlight {
  pin: [number, number];
  mask: [number, number][];
}

function analyse(images: Buffer[], width: number, height: number): { base: Buffer; highlights: (Highlight | null)[] } {
  const n = images.length;
  const px = width * height;
  const base = Buffer.alloc(px * 3);
  const column = new Uint8Array(n);
  for (let i = 0; i < px * 3; i++) {
    for (let k = 0; k < n; k++) column[k] = images[k][i];
    column.sort();
    base[i] = column[n >> 1];
  }

  const highlights = images.map((img) => {
    const points: [number, number][] = [];
    for (let p = 0; p < px; p++) {
      const d =
        Math.abs(img[p * 3] - base[p * 3]) + Math.abs(img[p * 3 + 1] - base[p * 3 + 1]) + Math.abs(img[p * 3 + 2] - base[p * 3 + 2]);
      if (d > 60) points.push([p % width, Math.floor(p / width)]);
    }
    // Nothing highlighted, or a different map edition (most pixels differ): unusable.
    if (points.length < 3 || points.length > px * 0.12) return null;
    const cx = points.reduce((s, [x]) => s + x, 0) / points.length;
    const cy = points.reduce((s, [, y]) => s + y, 0) / points.length;
    // The pin is the highlighted pixel closest to the centroid (stays on curved routes).
    let pin = points[0];
    let best = Infinity;
    for (const pt of points) {
      const dd = (pt[0] - cx) ** 2 + (pt[1] - cy) ** 2;
      if (dd < best) {
        best = dd;
        pin = pt;
      }
    }
    const step = Math.max(1, Math.ceil(points.length / MAX_MASK_POINTS));
    const norm = ([x, y]: [number, number]): [number, number] => [
      Math.round(((x + 0.5) / width) * 10000) / 10000,
      Math.round(((y + 0.5) / height) * 10000) / 10000,
    ];
    return { pin: norm(pin), mask: points.filter((_, i) => i % step === 0).map(norm) };
  });
  return { base, highlights };
}

// ---------------------------------------------------------------------------
// Location pages → screenshots
// ---------------------------------------------------------------------------

const GAME_CODES: Record<string, string> = {
  RB: "Red / Blue",
  RBY: "Red / Blue / Yellow",
  RGBY: "Red / Green / Blue / Yellow",
  GSC: "Gold / Silver / Crystal",
  RSE: "Ruby / Sapphire / Emerald",
  RS: "Ruby / Sapphire",
  E: "Emerald",
  FRLG: "FireRed / LeafGreen",
  DPPt: "Diamond / Pearl / Platinum",
  DP: "Diamond / Pearl",
  Pt: "Platinum",
  HGSS: "HeartGold / SoulSilver",
  BW: "Black / White",
  B2W2: "Black 2 / White 2",
  XY: "X / Y",
  ORAS: "Omega Ruby / Alpha Sapphire",
  SM: "Sun / Moon",
  USUM: "Ultra Sun / Ultra Moon",
  PE: "Let's Go, Pikachu! / Eevee!",
  LGPE: "Let's Go, Pikachu! / Eevee!",
  SwSh: "Sword / Shield",
  BDSP: "Brilliant Diamond / Shining Pearl",
  LA: "Legends: Arceus",
  SV: "Scarlet / Violet",
};

function gameOf(file: string): string {
  const code = file.replace(/\.(png|jpg|jpeg|gif)$/i, "").split(/[ _]/).pop() ?? "";
  return GAME_CODES[code] ?? code;
}

/** Raw infobox image fields (image, imageI, imageII, …) from a page's lead section. */
function infoboxImageValues(wikitext: string): string[] {
  const values: string[] = [];
  for (const m of wikitext.matchAll(/^\|\s*image[A-Za-z0-9]*\s*=\s*(.+)$/gim)) {
    const value = m[1].replace(/<!--[\s\S]*?-->/g, "").trim();
    if (value) values.push(value);
  }
  return values;
}

/**
 * Turns infobox values into file names. Some pages pick the image with
 * parser functions (season, time of day), so those are expanded by the wiki.
 */
async function infoboxImages(wikitext: string): Promise<string[]> {
  const files: string[] = [];
  for (const value of infoboxImageValues(wikitext)) {
    let text = value;
    if (text.includes("{{")) {
      const r = await api<{ expandtemplates?: { wikitext: string } }>(WIKI, {
        action: "expandtemplates",
        text,
        prop: "wikitext",
      });
      text = r.expandtemplates?.wikitext ?? "";
    }
    text = text.replace(/\[\[|\]\]|^File:/g, "").trim();
    if (/\.(png|jpe?g)$/i.test(text) && !/[{}|<>]/.test(text)) files.push(text.replace(/ /g, "_"));
  }
  return [...new Set(files)];
}

/** Finds the location's wiki page (trying likely titles, then search) and returns its title and lead wikitext. */
async function locationPage(name: string, region: string): Promise<{ title: string; wikitext: string } | null> {
  const candidates = [`${region} ${name}`, name, `${name} (${region})`];
  const r = await api<{ query: { pages: { title: string; missing?: boolean }[]; redirects?: { from: string; to: string }[] } }>(WIKI, {
    action: "query",
    titles: candidates.join("|"),
    redirects: "1",
  });
  const resolved = new Map((r.query.redirects ?? []).map((x) => [x.from, x.to]));
  let title = candidates
    .map((c) => resolved.get(c) ?? c)
    .find((c) => r.query.pages.some((p) => p.title === c && !p.missing));
  if (!title) {
    // File names drop punctuation ("Digletts Cave", "Mt Moon"): fall back to search.
    const found = await api<{ query: { search: { title: string }[] } }>(WIKI, {
      action: "query",
      list: "search",
      srsearch: `${name} ${region}`,
      srlimit: "1",
    });
    title = found.query.search[0]?.title;
  }
  if (!title) return null;
  const parsed = await api<{ parse?: { title: string; wikitext: string } }>(WIKI, {
    action: "parse",
    page: title,
    prop: "wikitext",
    section: "0",
    redirects: "1",
  });
  return parsed.parse ? { title: parsed.parse.title, wikitext: parsed.parse.wikitext } : null;
}

// ---------------------------------------------------------------------------

async function buildLocations(region: RegionConfig, names: string[], highlights: (Highlight | null)[]): Promise<GeoLocation[]> {
  const locations: GeoLocation[] = [];
  for (let i = 0; i < names.length; i++) {
    const hl = highlights[i];
    if (!hl) {
      console.log(`  skip ${names[i]}: no clean highlight`);
      continue;
    }
    const page = await locationPage(names[i], region.name);
    const images = page ? await infoboxImages(page.wikitext) : [];
    if (!page || !images.length) {
      console.log(`  skip ${names[i]}: no screenshots`);
      continue;
    }
    const chosen = images.slice(0, MAX_SHOTS);
    const shotUrls = await fileUrls(chosen);
    const shots: GeoShot[] = [];
    for (const file of chosen) {
      const url = shotUrls.get(file);
      if (!url) continue;
      try {
        const id = randomBytes(9).toString("base64url");
        const webp = await sharp(await download(url))
          .resize({ width: SHOT_WIDTH, withoutEnlargement: true })
          .webp({ quality: 66, effort: 6 })
          .toBuffer();
        await upload(id, webp);
        shots.push({ id, game: gameOf(file) });
      } catch (err) {
        console.log(`  ! ${file}: ${(err as Error).message}`);
      }
    }
    if (!shots.length) continue;
    locations.push({ name: page.title, pin: hl.pin, mask: hl.mask, shots });
    console.log(`  ✓ ${page.title} (${shots.length} shots)`);
  }
  return locations;
}

async function saveMap(id: string, base: Buffer, width: number, height: number) {
  mkdirSync(path.join(OUT_PUBLIC, "maps"), { recursive: true });
  await sharp(base, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT_PUBLIC, "maps", `${id}.png`));
  return { src: `/geo/maps/${id}.png`, width, height };
}

async function ingestRegion(region: RegionConfig): Promise<GeoRegion> {
  console.log(`\n== ${region.name}`);
  const all = await listMapFiles(region.name);
  const size = dominantSize(all);
  const files = all.filter((f) => Math.abs(f.width - size.width) <= 1 && Math.abs(f.height - size.height) <= 1);
  console.log(`  ${files.length} location maps at ${size.width}×${size.height}`);

  const scale = Math.min(1, region.maxSide / Math.max(size.width, size.height));
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const urls = await fileUrls(files.map((f) => f.name));
  const raws: Buffer[] = [];
  const names: string[] = [];
  for (const f of files) {
    const url = urls.get(f.name);
    if (!url) continue;
    const img = await download(url);
    raws.push(
      await sharp(img)
        .resize(width, height, { fit: "fill", kernel: scale < 1 ? "lanczos3" : "nearest" })
        .flatten({ background: "#000000" })
        .removeAlpha()
        .raw()
        .toBuffer()
    );
    names.push(f.name.replace(new RegExp(`^${region.name}_`), "").replace(/_Map\.png$/, "").replace(/_/g, " "));
  }

  const { base, highlights } = analyse(raws, width, height);
  const map = await saveMap(region.id, base, width, height);
  return { id: region.id, name: region.name, map, locations: await buildLocations(region, names, highlights) };
}

async function main() {
  const wanted = process.argv.slice(2).map((s) => s.toLowerCase());
  const regions = wanted.length ? REGIONS.filter((r) => wanted.includes(r.id)) : REGIONS;
  const existing: { storageBase: string; regions: GeoRegion[] } = existsSync(OUT_DATA)
    ? JSON.parse(readFileSync(OUT_DATA, "utf8"))
    : { storageBase: "", regions: [] };
  existing.storageBase = `${supabaseUrl}/storage/v1/object/public/${BUCKET}`;
  await ensureBucket();

  for (const region of regions) {
    const old = existing.regions.find((r) => r.id === region.id);
    const built = await ingestRegion(region);
    // Re-ingesting a region replaces its old screenshots.
    const stale = (old?.locations ?? []).flatMap((l) => l.shots.map((s) => `${s.id}.webp`));
    for (let i = 0; i < stale.length; i += 100) await storage.from(BUCKET).remove(stale.slice(i, i + 100));
    existing.regions = [...existing.regions.filter((r) => r.id !== region.id), built];
    existing.regions.sort((a, b) => REGIONS.findIndex((r) => r.id === a.id) - REGIONS.findIndex((r) => r.id === b.id));
    writeFileSync(OUT_DATA, JSON.stringify(existing));
    console.log(`  → ${built.locations.length} locations`);
  }
}

void main();
