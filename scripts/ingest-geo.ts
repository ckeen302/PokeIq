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
 * Buildings, Gyms and landmarks (Silph Co., Pewter Gym, S.S. Anne…) have no
 * highlight of their own, but their infobox names the town or route they sit
 * in; they become extra locations that share that parent's pin and area.
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
  /**
   * Game codes set in this region. Pages also show other regions' namesakes
   * (Sinnoh's Pal Park, Alola's Route 1), so screenshots from any other game
   * are dropped.
   */
  games: string[];
}

/*
 * Kanto is the region whose Bulbapedia data is complete and consistent: one
 * shared town-map base, a clean highlight per location and screenshots from
 * five games, every pin checked by eye. Other regions need per-region work
 * first (Kalos's maps are mixed with Lumiose street maps, Alola's are per
 * island, Galar's and Paldea's are crops at varying offsets), so they aren't
 * listed until their data has been verified the same way.
 */
const REGIONS: RegionConfig[] = [
  { id: "kanto", name: "Kanto", maxSide: 400, games: ["RB", "RBY", "RGBY", "Y", "GSC", "FRLG", "HGSS", "PE", "LGPE"] },
];

/** Screenshots kept per pinned location / per building. */
const MAX_SHOTS = 6;
const MAX_BUILDING_SHOTS = 4;
const SHOT_WIDTH = 640;
/** Smaller sources are sprites or icons, never a view of a place (a Game Boy screen is 160×144). */
const MIN_SOURCE_SIDE = 120;
/** Where to look for buildings, besides the pages each pinned location links to. */
const BUILDING_CATEGORIES = (region: string) => [`Category:${region} locations`, `Category:${region} Gyms`];
/** Infoboxes used by building / landmark pages (towns and routes have their own). */
const BUILDING_TEMPLATES = ["Template:Infobox location", "Template:GymInfobox"];
/** Source -> uploaded id, so re-runs reuse uploads instead of re-encoding everything. */
const SHOT_CACHE = path.join(process.cwd(), ".data", "geo-shot-cache.json");
/**
 * Files that look like screenshots by name but aren't usable in-game views
 * of the place (found by reviewing contact sheets of every new shot).
 */
const DENYLIST = new Set<string>([
  "Celadon_Game_Corner_7_GSC.png", // a slot-machine reel, not the building
  "Celadon_Game_Corner_7_Y.png", // same reel symbol
  "Route_22_Rival_battle_RBY.png", // mostly a dialogue box
  "Vermilion_City_port_HGSS.png", // mostly a (Japanese) dialogue box
  "Cerulean_City_Slowbro_SonicBoom_FRLG.png", // mostly a dialogue box
]);
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
  /** For buildings and landmarks: the pinned location they sit in (pin and mask are copied from it). */
  parent?: string;
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
  Y: "Yellow",
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

/**
 * The game code in a screenshot's file name: usually last ("Pewter Gym
 * Exterior LGPE.png"), sometimes first ("FL Safari Zone.png"). Null for
 * anything without a known code (anime stills, artwork, manga panels, maps).
 */
function codeOf(file: string): string | null {
  const tokens = file.replace(/\.(png|jpe?g|gif)$/i, "").split(/[ _]/).filter(Boolean);
  return [tokens.at(-1), tokens[0]].find((t): t is string => !!t && !!GAME_CODES[t]) ?? null;
}

function gameOf(file: string): string | null {
  const code = codeOf(file);
  return code ? GAME_CODES[code] : null;
}

const isLetsGo = (file: string) => gameOf(file)?.startsWith("Let's Go") ?? false;

/** Lower-case words (accents and punctuation dropped), for loose name matching. */
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Whole-word prefix match, so "Route 1" never matches "Route 10 PE.png". */
function startsWithWords(file: string, prefix: string): boolean {
  const f = words(file);
  const p = words(prefix);
  return p.length > 0 && p.join("").length >= 4 && p.every((w, i) => f[i] === w);
}

/** Exact-name lookup key. */
const squash = (s: string) => words(s).join("");

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

/**
 * Gallery screenshots on a page that follow the "<Place> … <GAME>.png" naming
 * (e.g. "Pewter Gym interior FRLG.png"). Only files whose name starts with one
 * of `prefixes` and carries a known game code are kept, which rules out
 * sprites, artwork and anime stills.
 */
async function galleryImages(title: string, prefixes: string[]): Promise<string[]> {
  const r = await api<{ parse?: { images: string[] } }>(WIKI, { action: "parse", page: title, prop: "images", redirects: "1" });
  return (r.parse?.images ?? []).filter((f) => /\.(png|jpe?g)$/i.test(f) && gameOf(f) && prefixes.some((p) => startsWithWords(f, p)));
}

/** The place name an infobox image is of: "Lavender Tower Exterior LGPE.png" → "Lavender Tower". */
function imageStem(file: string): string {
  return file
    .replace(/\.(png|jpe?g)$/i, "")
    .split(/[ _]/)
    .filter((t) => !GAME_CODES[t] && !/^(exterior|interior|entrance|inside|outside|\d+f|b\d+f)$/i.test(t))
    .join(" ");
}

/** Infobox shots first, then gallery shots; Let's Go first within each (if `letsGoFirst`). */
function rankShots(region: RegionConfig, infobox: string[], gallery: string[], letsGoFirst: boolean): string[] {
  const usable = (f: string) => region.games.includes(codeOf(f) ?? "") && !DENYLIST.has(f.replace(/ /g, "_"));
  const ordered = [...new Set([...infobox, ...gallery].map((f) => f.replace(/ /g, "_")))].filter(usable);
  if (!letsGoFirst) return ordered;
  return [...ordered.filter(isLetsGo), ...ordered.filter((f) => !isLetsGo(f))];
}

interface ShotStore {
  /** Source file → uploaded id, from earlier runs. */
  cache: Record<string, string>;
  /** Ids referenced by the current data (safe to reuse). */
  live: Set<string>;
}

async function collectShots(files: string[], max: number, store: ShotStore): Promise<GeoShot[]> {
  const urls = await fileUrls(files);
  const shots: GeoShot[] = [];
  for (const file of files) {
    if (shots.length >= max) break;
    const game = gameOf(file);
    const cached = store.cache[file];
    if (game && cached && store.live.has(cached)) {
      shots.push({ id: cached, game });
      continue;
    }
    const url = urls.get(file);
    if (!url || !game) continue;
    try {
      const source = await download(url);
      const { width = 0, height = 0 } = await sharp(source).metadata();
      if (Math.max(width, height) < MIN_SOURCE_SIDE) {
        console.log(`  ! ${file}: too small to be a screenshot (${width}×${height})`);
        continue;
      }
      const id = randomBytes(9).toString("base64url");
      const webp = await sharp(source)
        .resize({ width: SHOT_WIDTH, withoutEnlargement: true })
        .webp({ quality: 66, effort: 6 })
        .toBuffer();
      await upload(id, webp);
      store.cache[file] = id;
      shots.push({ id, game });
    } catch (err) {
      console.log(`  ! ${file}: ${(err as Error).message}`);
    }
  }
  return shots;
}

async function buildLocations(
  region: RegionConfig,
  names: string[],
  highlights: (Highlight | null)[],
  store: ShotStore
): Promise<GeoLocation[]> {
  const locations: GeoLocation[] = [];
  for (let i = 0; i < names.length; i++) {
    const hl = highlights[i];
    if (!hl) {
      console.log(`  skip ${names[i]}: no clean highlight`);
      continue;
    }
    const page = await locationPage(names[i], region.name);
    const infobox = page ? await infoboxImages(page.wikitext) : [];
    if (!page || !infobox.length) {
      console.log(`  skip ${names[i]}: no screenshots`);
      continue;
    }
    const gallery = await galleryImages(page.title, [page.title, names[i], ...infobox.map(imageStem)]);
    // Infobox order is one per game; extra gallery views fill up to the cap.
    const shots = await collectShots(rankShots(region, infobox, gallery, false), MAX_SHOTS, store);
    if (!shots.length) continue;
    locations.push({ name: page.title, pin: hl.pin, mask: hl.mask, shots });
    console.log(`  ✓ ${page.title} (${shots.length} shots)`);
  }
  return locations;
}

/** Page titles in the given categories (main namespace only). */
async function categoryPages(category: string): Promise<string[]> {
  const out: string[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const r = await api<{ query: { categorymembers: { title: string; ns: number }[] }; continue?: { cmcontinue: string } }>(WIKI, {
      action: "query",
      list: "categorymembers",
      cmtitle: category,
      cmlimit: "500",
      ...cont,
    });
    out.push(...r.query.categorymembers.filter((m) => m.ns === 0).map((m) => m.title));
    if (!r.continue) return out;
    cont = { cmcontinue: r.continue.cmcontinue };
  }
}

/** Keeps only pages that use a building / landmark infobox (50 titles per request). */
async function withBuildingInfobox(titles: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < titles.length; i += 50) {
    const r = await api<{ query: { pages: { title: string; missing?: boolean; templates?: { title: string }[] }[] } }>(WIKI, {
      action: "query",
      titles: titles.slice(i, i + 50).join("|"),
      prop: "templates",
      tltemplates: BUILDING_TEMPLATES.join("|"),
      tllimit: "500",
    });
    out.push(...r.query.pages.filter((p) => !p.missing && p.templates?.length).map((p) => p.title));
  }
  return out;
}

/**
 * The first place an infobox `location` field refers to, as a page title:
 * "[[Saffron City]]" → "Saffron City", "{{rt|10|Kanto}}" → "Kanto Route 10",
 * plain "Pewter City" → "Pewter City". A place "on" something wins over one
 * it's only near.
 */
function firstLocationRef(wikitext: string): string | null {
  const field = wikitext.match(/^\|\s*location\s*=\s*(.+)$/m)?.[1]?.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!field) return null;
  const refs: { at: number; title: string }[] = [];
  for (const m of field.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) refs.push({ at: m.index ?? 0, title: m[1].trim() });
  for (const m of field.matchAll(/\{\{rt\|(\d+)\|([^}|]+)[^}]*\}\}/gi)) refs.push({ at: m.index ?? 0, title: `${m[2].trim()} Route ${m[1]}` });
  // "Northeast of [[Cerulean City]] on {{rt|25|Kanto}}": the place is on the second one.
  const on = refs.find((r) => /\bon\s*$/i.test(field.slice(0, r.at)));
  if (on) return on.title;
  if (refs.length) return refs.sort((a, b) => a.at - b.at)[0].title;
  // A bare place name with no markup at all.
  return /^[\p{L}\p{N} .'-]+$/u.test(field) ? field : null;
}

/**
 * Buildings, Gyms and landmarks inside pinned locations. Candidates come from
 * the region's location categories and every page the pinned locations link
 * to; a candidate counts when its infobox `location` points (first) at a
 * pinned location and it has game screenshots.
 */
async function buildBuildings(region: RegionConfig, pinned: GeoLocation[], store: ShotStore): Promise<GeoLocation[]> {
  console.log(`  -- buildings and landmarks`);
  const candidates = new Set<string>();
  for (const cat of BUILDING_CATEGORIES(region.name)) for (const t of await categoryPages(cat)) candidates.add(t);
  for (const loc of pinned) {
    const r = await api<{ parse?: { links: { title: string; ns: number; exists?: boolean }[] } }>(WIKI, {
      action: "parse",
      page: loc.name,
      prop: "links",
      redirects: "1",
    });
    for (const l of r.parse?.links ?? []) if (l.ns === 0 && l.exists) candidates.add(l.title);
  }
  const pinnedNames = new Set(pinned.map((l) => l.name));
  const titles = (await withBuildingInfobox([...candidates].filter((t) => !pinnedNames.has(t)))).sort();
  console.log(`  ${candidates.size} candidate pages, ${titles.length} with a building infobox`);

  // Resolve location references (and their redirects) to pinned locations.
  const byKey = new Map(pinned.map((l) => [squash(l.name), l]));
  const findPinned = (ref: string) => byKey.get(squash(ref)) ?? byKey.get(squash(`${region.name} ${ref}`));

  const out: GeoLocation[] = [];
  for (const title of titles) {
    const parsed = await api<{ parse?: { title: string; wikitext: string } }>(WIKI, {
      action: "parse",
      page: title,
      prop: "wikitext",
      section: "0",
      redirects: "1",
    });
    if (!parsed.parse || pinnedNames.has(parsed.parse.title)) continue;
    const ref = firstLocationRef(parsed.parse.wikitext);
    let parent = ref ? findPinned(ref) : undefined;
    if (ref && !parent) {
      const r = await api<{ query: { redirects?: { to: string }[] } }>(WIKI, { action: "query", titles: ref, redirects: "1" });
      const to = r.query.redirects?.[0]?.to;
      parent = to ? findPinned(to) : undefined;
    }
    if (!parent) continue;
    const infobox = await infoboxImages(parsed.parse.wikitext);
    const gallery = await galleryImages(parsed.parse.title, [parsed.parse.title, ...infobox.map(imageStem)]);
    const files = rankShots(region, infobox, gallery, true);
    if (!files.length) continue;
    const shots = await collectShots(files, MAX_BUILDING_SHOTS, store);
    if (!shots.length) continue;
    out.push({ name: parsed.parse.title, parent: parent.name, pin: parent.pin, mask: parent.mask, shots });
    console.log(`  ✓ ${parsed.parse.title} → ${parent.name} (${shots.length} shots)`);
  }
  return out;
}

async function saveMap(id: string, base: Buffer, width: number, height: number) {
  mkdirSync(path.join(OUT_PUBLIC, "maps"), { recursive: true });
  await sharp(base, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT_PUBLIC, "maps", `${id}.png`));
  return { src: `/geo/maps/${id}.png`, width, height };
}

async function ingestRegion(region: RegionConfig, store: ShotStore): Promise<GeoRegion> {
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
  const pinned = await buildLocations(region, names, highlights, store);
  const buildings = await buildBuildings(region, pinned, store);
  return { id: region.id, name: region.name, map, locations: [...pinned, ...buildings] };
}

async function main() {
  const wanted = process.argv.slice(2).map((s) => s.toLowerCase());
  const regions = wanted.length ? REGIONS.filter((r) => wanted.includes(r.id)) : REGIONS;
  const existing: { storageBase: string; regions: GeoRegion[] } = existsSync(OUT_DATA)
    ? JSON.parse(readFileSync(OUT_DATA, "utf8"))
    : { storageBase: "", regions: [] };
  existing.storageBase = `${supabaseUrl}/storage/v1/object/public/${BUCKET}`;
  await ensureBucket();
  const store: ShotStore = {
    cache: existsSync(SHOT_CACHE) ? JSON.parse(readFileSync(SHOT_CACHE, "utf8")) : {},
    live: new Set(existing.regions.flatMap((r) => r.locations.flatMap((l) => l.shots.map((s) => s.id)))),
  };

  for (const region of regions) {
    const old = existing.regions.find((r) => r.id === region.id);
    const built = await ingestRegion(region, store);
    mkdirSync(path.dirname(SHOT_CACHE), { recursive: true });
    writeFileSync(SHOT_CACHE, JSON.stringify(store.cache));
    // Screenshots the new data no longer uses are deleted; reused ones stay.
    const kept = new Set(built.locations.flatMap((l) => l.shots.map((s) => s.id)));
    const stale = (old?.locations ?? []).flatMap((l) => l.shots.map((s) => s.id)).filter((id) => !kept.has(id)).map((id) => `${id}.webp`);
    for (let i = 0; i < stale.length; i += 100) await storage.from(BUCKET).remove(stale.slice(i, i + 100));
    existing.regions = [...existing.regions.filter((r) => r.id !== region.id), built];
    existing.regions.sort((a, b) => REGIONS.findIndex((r) => r.id === a.id) - REGIONS.findIndex((r) => r.id === b.id));
    writeFileSync(OUT_DATA, JSON.stringify(existing));
    const buildings = built.locations.filter((l) => l.parent).length;
    console.log(`  → ${built.locations.length - buildings} pinned locations + ${buildings} buildings and landmarks`);
  }
}

void main();
