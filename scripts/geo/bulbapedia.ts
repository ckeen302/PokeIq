/**
 * Shared Bulbapedia / Bulbagarden Archives helpers for the PokéGuessr ingest
 * scripts: polite HTTP, location pages, their in-game screenshots, and
 * uploading those screenshots (re-encoded under random ids) to Supabase Storage.
 */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { httpGet, wikiApi } from "./http";

export { UA } from "./http";

export const ARCHIVES = "https://archives.bulbagarden.net/w/api.php";
export const WIKI = "https://bulbapedia.bulbagarden.net/w/api.php";
export const BUCKET = "geo";

/** Part of every upload's cache key: bumping it re-encodes and re-uploads every screenshot. */
export const ENCODING = "v2";
/** 3D captures are kept up to this width (a 1080p capture is scaled down a little). */
const PHOTO_WIDTH = 1600;
/** Sprite graphics are scaled up by a whole number until the longer side is at least this, every pixel kept sharp. */
const PIXEL_SIDE = 1200;
const MAX_PIXEL_SIDE = 2400;
/** The Game Boy, Game Boy Advance and DS games: sprite graphics. */
const PIXEL_GAME = /^(Red|Yellow|Gold|Silver|Crystal|Ruby|Sapphire|Emerald|FireRed|Diamond|Pearl|Platinum|HeartGold|Black)\b/;
/** Let's Go's location cards: 396 × 228 with a white frame and a glow, which are cut off. */
const CARD_INSET = 14;
/** Smaller sources are sprites or icons, never a view of a place (a Game Boy screen is 160×144). */
const MIN_SOURCE_SIDE = 120;
/** Long strips (a whole route, a lift shaft) are cut to their middle: a view of the place, not a sliver. */
const MAX_WIDE = 2.4;
const MAX_TALL = 1.5;
/** Infoboxes used by building / landmark pages (towns and routes have their own). */
const BUILDING_TEMPLATES = ["Template:Infobox location", "Template:GymInfobox"];

export interface GeoShot {
  id: string;
  game: string;
  /** The game family (scripts/geo/curate.ts gives every shot its own). */
  family?: string;
}

/** The part of a width × height image to keep: all of it, or the middle of a long strip. */
export function viewCrop(width: number, height: number): { left: number; top: number; width: number; height: number } {
  if (width > height * MAX_WIDE) {
    const w = Math.round(height * MAX_WIDE);
    return { left: Math.round((width - w) / 2), top: 0, width: w, height };
  }
  if (height > width * MAX_TALL) {
    const h = Math.round(width * MAX_TALL);
    return { left: 0, top: Math.round((height - h) / 2), width, height: h };
  }
  return { left: 0, top: 0, width, height };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function geoStorage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: screenshots are uploaded to Supabase Storage.");
    process.exit(1);
  }
  const storage = createClient(url, key, { auth: { persistSession: false } }).storage;
  return {
    baseUrl: `${url}/storage/v1/object/public/${BUCKET}`,
    async ensureBucket() {
      const { data } = await storage.getBucket(BUCKET);
      if (data) return;
      const { error } = await storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ["image/webp"] });
      if (error) throw new Error(`create bucket: ${error.message}`);
    },
    async upload(id: string, body: Buffer) {
      const { error } = await storage
        .from(BUCKET)
        .upload(`${id}.webp`, body, { contentType: "image/webp", cacheControl: "31536000", upsert: true });
      if (error) throw new Error(`upload ${id}: ${error.message}`);
    },
    async remove(ids: string[]) {
      for (let i = 0; i < ids.length; i += 100) await storage.from(BUCKET).remove(ids.slice(i, i + 100).map((id) => `${id}.webp`));
    },
  };
}
export type GeoStorage = ReturnType<typeof geoStorage>;

// ---------------------------------------------------------------------------
// HTTP helpers (polite: through curl, a gap between requests to a host, retries; see ./http)
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Archives' own API sits behind a browser check from some networks. Its
 * listings (categories, files by prefix) are then skipped with a warning, and
 * the run goes on with Bulbapedia (which serves the Archives' file info as its
 * shared repository) and the other wikis. Returns null when blocked.
 */
let archivesBlocked = false;
export async function archivesApi<T>(params: Record<string, string>): Promise<T | null> {
  if (archivesBlocked) return null;
  try {
    return await api<T>(ARCHIVES, params);
  } catch (err) {
    if (!/^403 /.test((err as Error).message)) throw err;
    archivesBlocked = true;
    console.warn("  ! The Archives' API is blocked from here: its category and prefix listings are skipped this run.");
    return null;
  }
}

export async function api<T>(base: string, params: Record<string, string>): Promise<T> {
  return wikiApi<T>(base, params);
}

export async function download(url: string): Promise<Buffer> {
  return httpGet(url);
}

/** Resolves File: names to their upload URLs, 50 at a time. */
export async function fileInfo(files: string[]): Promise<Map<string, { url: string; width: number; height: number }>> {
  const out = new Map<string, { url: string; width: number; height: number }>();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const r = await api<{
      query: { normalized?: { from: string; to: string }[]; pages: { title: string; imageinfo?: { url: string; width: number; height: number }[] }[] };
    }>(WIKI, { action: "query", titles: batch.map((f) => `File:${f}`).join("|"), prop: "imageinfo", iiprop: "url|size" });
    const back = new Map((r.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of r.query.pages) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const original = (back.get(p.title) ?? p.title).replace(/^File:/, "");
      out.set(original.replace(/ /g, "_"), { url: info.url, width: info.width, height: info.height });
    }
  }
  return out;
}

export async function fileUrls(files: string[]): Promise<Map<string, string>> {
  return new Map([...(await fileInfo(files))].map(([file, info]) => [file, info.url]));
}

// ---------------------------------------------------------------------------
// Game codes in file names
// ---------------------------------------------------------------------------

export const GAME_CODES: Record<string, string> = {
  RB: "Red / Blue",
  RBY: "Red / Blue / Yellow",
  RGBY: "Red / Green / Blue / Yellow",
  Y: "Yellow",
  GS: "Gold / Silver",
  GSC: "Gold / Silver / Crystal",
  C: "Crystal",
  RSE: "Ruby / Sapphire / Emerald",
  RS: "Ruby / Sapphire",
  E: "Emerald",
  SE: "Sapphire / Emerald",
  FRLG: "FireRed / LeafGreen",
  DPPt: "Diamond / Pearl / Platinum",
  DP: "Diamond / Pearl",
  Pt: "Platinum",
  HGSS: "HeartGold / SoulSilver",
  BW: "Black / White",
  B: "Black / White",
  W: "Black / White",
  B2W2: "Black 2 / White 2",
  B2: "Black 2 / White 2",
  W2: "Black 2 / White 2",
  BWB2W2: "Black / White / Black 2 / White 2",
  XY: "X / Y",
  ORAS: "Omega Ruby / Alpha Sapphire",
  OR: "Omega Ruby",
  AS: "Alpha Sapphire",
  SM: "Sun / Moon",
  USUM: "Ultra Sun / Ultra Moon",
  SMUSUM: "Sun / Moon / Ultra Sun / Ultra Moon",
  PE: "Let's Go, Pikachu! / Eevee!",
  LGPE: "Let's Go, Pikachu! / Eevee!",
  SwSh: "Sword / Shield",
  BDSP: "Brilliant Diamond / Shining Pearl",
  LA: "Legends: Arceus",
  ZA: "Legends: Z-A",
  SV: "Scarlet / Violet",
};

/**
 * The game code in a screenshot's file name: usually last ("Pewter Gym
 * Exterior LGPE.png"), sometimes first ("FL Safari Zone.png"). Null for
 * anything without a known code (anime stills, artwork, manga panels, maps).
 */
export function codeOf(file: string): string | null {
  const tokens = file.replace(/\.(png|jpe?g|gif)$/i, "").split(/[ _]/).filter(Boolean);
  return [tokens.at(-1), tokens[0]].find((t): t is string => !!t && !!GAME_CODES[t]) ?? null;
}

export function gameOf(file: string): string | null {
  const code = codeOf(file);
  return code ? GAME_CODES[code] : null;
}

export const isLetsGo = (file: string) => gameOf(file)?.startsWith("Let's Go") ?? false;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Lower-case words (accents and punctuation dropped), for loose name matching. */
export const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Whole-word prefix match, so "Route 1" never matches "Route 10 PE.png". */
export function startsWithWords(file: string, prefix: string): boolean {
  const f = words(file);
  const p = words(prefix);
  return p.length > 0 && p.join("").length >= 4 && p.every((w, i) => f[i] === w);
}

/** Exact-name lookup key. */
export const squash = (s: string) => words(s).join("");

// ---------------------------------------------------------------------------
// Pages and screenshots
// ---------------------------------------------------------------------------

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
export async function infoboxImages(wikitext: string): Promise<string[]> {
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

/**
 * Finds a location's wiki page (trying `candidates` in order, then search) and
 * returns its title and lead wikitext.
 */
export async function locationPage(candidates: string[], search: string): Promise<{ title: string; wikitext: string } | null> {
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
      srsearch: search,
      srlimit: "1",
    });
    title = found.query.search[0]?.title;
  }
  if (!title) return null;
  return leadSection(title);
}

export async function leadSection(title: string): Promise<{ title: string; wikitext: string } | null> {
  const parsed = await api<{ parse?: { title: string; wikitext: string } }>(WIKI, {
    action: "parse",
    page: title,
    prop: "wikitext",
    section: "0",
    redirects: "1",
  });
  return parsed.parse ? { title: parsed.parse.title, wikitext: parsed.parse.wikitext } : null;
}

/**
 * Gallery screenshots on a page that follow the "<Place> … <GAME>.png" naming
 * (e.g. "Pewter Gym interior FRLG.png"). Only files whose name starts with one
 * of `prefixes` and carries a known game code are kept, which rules out
 * sprites, artwork and anime stills.
 */
export async function galleryImages(title: string, prefixes: string[]): Promise<string[]> {
  const r = await api<{ parse?: { images: string[] } }>(WIKI, { action: "parse", page: title, prop: "images", redirects: "1" });
  return (r.parse?.images ?? []).filter((f) => /\.(png|jpe?g)$/i.test(f) && gameOf(f) && prefixes.some((p) => startsWithWords(f, p)));
}

/** The place name an infobox image is of: "Lavender Tower Exterior LGPE.png" → "Lavender Tower". */
export function imageStem(file: string): string {
  return file
    .replace(/\.(png|jpe?g)$/i, "")
    .split(/[ _]/)
    .filter((t) => !GAME_CODES[t] && !/^(exterior|interior|entrance|inside|outside|\d+f|b\d+f)$/i.test(t))
    .join(" ");
}

export interface CategoryFile {
  name: string;
  width: number;
  height: number;
  categories: string[];
}

/** Every file in an Archives category, with its size and its other categories. */
export async function categoryFiles(category: string): Promise<CategoryFile[]> {
  const out = new Map<string, CategoryFile>();
  let cont: Record<string, string> = {};
  for (;;) {
    const r = await archivesApi<{
      query?: { pages: { title: string; imageinfo?: { width: number; height: number }[]; categories?: { title: string }[] }[] };
      continue?: Record<string, string>;
    }>({
      action: "query",
      generator: "categorymembers",
      gcmtitle: `Category:${category}`,
      gcmtype: "file",
      gcmlimit: "200",
      prop: "categories|imageinfo",
      iiprop: "size",
      cllimit: "max",
      ...cont,
    });
    if (!r) return [...out.values()];
    for (const p of r.query?.pages ?? []) {
      const name = p.title.replace(/^File:/, "").replace(/ /g, "_");
      const file = out.get(name) ?? { name, width: 0, height: 0, categories: [] };
      if (p.imageinfo?.[0]) [file.width, file.height] = [p.imageinfo[0].width, p.imageinfo[0].height];
      for (const c of p.categories ?? []) file.categories.push(c.title.replace(/^Category:/, ""));
      out.set(name, file);
    }
    if (!r.continue) return [...out.values()];
    cont = r.continue;
  }
}

/** Page titles in the given category (main namespace only). */
export async function categoryPages(category: string): Promise<string[]> {
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
export async function withBuildingInfobox(titles: string[]): Promise<string[]> {
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

/** Archive files whose names start with `prefix` (e.g. "Eterna_City_"), with their sizes. */
export async function archiveFiles(prefix: string): Promise<{ name: string; width: number; height: number }[]> {
  const out: { name: string; width: number; height: number }[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const r = await archivesApi<{
      query: { allimages: { name: string; width: number; height: number }[] };
      continue?: { aicontinue: string };
    }>({ action: "query", list: "allimages", aiprefix: prefix, ailimit: "500", aiprop: "size", ...cont });
    if (!r) return out;
    out.push(...r.query.allimages);
    if (!r.continue) return out;
    cont = { aicontinue: r.continue.aicontinue };
  }
}

/** Every main-namespace page a page links to. */
export async function pageLinks(title: string): Promise<string[]> {
  const r = await api<{ parse?: { links: { title: string; ns: number; exists?: boolean }[] } }>(WIKI, {
    action: "parse",
    page: title,
    prop: "links",
    redirects: "1",
  });
  return (r.parse?.links ?? []).filter((l) => l.ns === 0 && l.exists).map((l) => l.title);
}

/** Where a redirect title points, or null. */
export async function redirectTarget(title: string): Promise<string | null> {
  const r = await api<{ query: { redirects?: { to: string }[] } }>(WIKI, { action: "query", titles: title, redirects: "1" });
  return r.query.redirects?.[0]?.to ?? null;
}

/**
 * The first place an infobox `location` field refers to, as a page title:
 * "[[Saffron City]]" → "Saffron City", "{{rt|10|Kanto}}" → "Kanto Route 10",
 * plain "Pewter City" → "Pewter City". A place "on" something wins over one
 * it's only near.
 */
export function firstLocationRef(wikitext: string): string | null {
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

// ---------------------------------------------------------------------------
// Screenshots → Storage
// ---------------------------------------------------------------------------

/** How big a sprite screenshot's pixels are: 2 when every 2 × 2 block is one colour (a doubled capture), and so on. */
export async function pixelScale(source: Buffer): Promise<number> {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data.readUInt32LE((y * info.width + x) * 4);
  for (const k of [4, 3, 2]) {
    if (info.width % k || info.height % k) continue;
    let uniform = true;
    for (let y = 0; y < info.height && uniform; y += k) {
      for (let x = 0; x < info.width && uniform; x += k) {
        const first = at(x, y);
        for (let i = 1; i < k * k && uniform; i++) uniform = at(x + (i % k), y + Math.floor(i / k)) === first;
      }
    }
    if (uniform) return k;
  }
  return 1;
}

/**
 * Re-encodes a screenshot as sharp as its source allows. Sprite games' shots
 * go back to their true pixels, then up by a whole number (nearest
 * neighbour, lossless), so they stay crisp at any size. 3D captures keep up to
 * 1600 px; smaller ones (the 3DS's 400 px screen) are doubled smoothly.
 */
export async function encodeShot(source: Buffer, game: string, crop: { left: number; top: number; width: number; height: number }): Promise<Buffer> {
  if (PIXEL_GAME.test(game)) {
    const k = await pixelScale(source);
    const snap = (v: number) => Math.floor(v / k) * k;
    const box = { left: snap(crop.left), top: snap(crop.top), width: snap(crop.width), height: snap(crop.height) };
    const [w, h] = [box.width / k, box.height / k];
    const side = Math.max(w, h);
    const f = Math.max(1, Math.min(Math.ceil(PIXEL_SIDE / side), Math.floor(MAX_PIXEL_SIDE / side)));
    const native = await sharp(source).extract(box).resize(w, h, { kernel: "nearest" }).toBuffer();
    return sharp(native).resize(w * f, h * f, { kernel: "nearest" }).webp({ lossless: true, effort: 6 }).toBuffer();
  }
  const img = sharp(source).extract(crop).flatten({ background: "#000" });
  if (crop.width < 800) return img.resize({ width: Math.min(crop.width * 2, PHOTO_WIDTH), kernel: "lanczos3" }).webp({ quality: 90, effort: 6 }).toBuffer();
  return img.resize({ width: PHOTO_WIDTH, withoutEnlargement: true }).webp({ quality: 86, effort: 6 }).toBuffer();
}

export interface ShotStore {
  /** Source file → uploaded id, from earlier runs. */
  cache: Record<string, string>;
  /** Ids referenced by the current data (safe to reuse). */
  live: Set<string>;
}

/**
 * The game for files without a code in their name: one game for a
 * single-game region, or one picked by the image's size (a 400×240 file is a
 * 3DS screen); undefined drops the file.
 */
export type ShotFallback = string | ((width: number, height: number) => string | undefined);

export interface ShotOptions {
  fallback?: ShotFallback;
  /** Share of the height to cut off the bottom of a file (the game's place-name banner or a text box sits there). */
  trimBottom?: Record<string, number>;
  /** Share of the height to cut off the top of a file (the place-name banner on arriving). */
  trimTop?: Record<string, number>;
  /** Files from another wiki: their URLs, games (their names use the wiki's abbreviations) and a cache-key prefix (names can clash with the Archives'). */
  urls?: Map<string, string>;
  games?: Map<string, string>;
  keyPrefix?: string;
}

/** Downloads, re-encodes and uploads up to `max` of `files`, reusing earlier uploads. */
export async function collectShots(files: string[], max: number, store: ShotStore, storage: GeoStorage, opts: ShotOptions = {}): Promise<GeoShot[]> {
  const { fallback } = opts;
  const urls = opts.urls ?? (await fileUrls(files));
  const shots: GeoShot[] = [];
  for (const file of files) {
    if (shots.length >= max) break;
    const known = opts.games?.get(file) ?? gameOf(file) ?? (typeof fallback === "string" ? fallback : undefined);
    const trim = opts.trimBottom?.[file] ?? 0;
    const top = opts.trimTop?.[file] ?? 0;
    // A trimmed file is a different image from the untrimmed one, so it's cached under its own key.
    const key = (opts.keyPrefix ?? "") + file + (top ? `#top${top}` : "") + (trim ? `#bottom${trim}` : "") + `@${ENCODING}`;
    const cached = store.cache[key];
    if (known && cached && store.live.has(cached)) {
      shots.push({ id: cached, game: known });
      continue;
    }
    const url = urls.get(file);
    if (!url || (!known && typeof fallback !== "function")) continue;
    try {
      const source = await download(url);
      const { width = 0, height = 0 } = await sharp(source).metadata();
      if (Math.max(width, height) < MIN_SOURCE_SIDE) {
        console.log(`  ! ${file}: too small to be a screenshot (${width}×${height})`);
        continue;
      }
      const game = known ?? (typeof fallback === "function" ? fallback(width, height) : undefined);
      if (!game) continue;
      if (cached && store.live.has(cached)) {
        shots.push({ id: cached, game });
        continue;
      }
      const id = randomBytes(9).toString("base64url");
      const card = game.startsWith("Let's Go") && width < 500 ? CARD_INSET : 0;
      const crop = viewCrop(width - 2 * card, Math.round(height * (1 - trim - top)) - 2 * card);
      const webp = await encodeShot(source, game, { ...crop, left: crop.left + card, top: crop.top + card + Math.round(height * top) });
      await storage.upload(id, webp);
      store.cache[key] = id;
      store.live.add(id);
      shots.push({ id, game });
    } catch (err) {
      console.log(`  ! ${file}: ${(err as Error).message}`);
    }
  }
  return shots;
}

// ---------------------------------------------------------------------------
// Near-copies
// ---------------------------------------------------------------------------

/** A difference hash of a screenshot (borders trimmed, 17 × 16 grey): 256 bits, as a string of 0s and 1s. */
export async function imageHash(buf: Buffer): Promise<string> {
  let img = sharp(buf).flatten({ background: "#000" });
  try {
    img = sharp(await img.trim({ threshold: 30 }).toBuffer());
  } catch {
    // Nothing to trim.
  }
  const px = await img.resize(17, 16, { fit: "fill" }).greyscale().raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits += px[y * 17 + x] < px[y * 17 + x + 1] ? "1" : "0";
  return bits;
}

export function hashDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Hash distance under which two shots of one place are copies: of any game, or of the same game (seasons, Sword's and Shield's, a wiki's copy). */
export const SAME_PICTURE = 10;
export const SAME_GAME_PICTURE = 24;
/** Two places whose shots are this alike (two Regi chambers, two open-sea routes) can't be told apart. */
export const LOOK_ALIKE = 18;
