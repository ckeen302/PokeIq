/**
 * Shared Bulbapedia / Bulbagarden Archives helpers for the PokéGuessr ingest
 * scripts: polite HTTP, location pages, their in-game screenshots, and
 * uploading those screenshots (re-encoded under random ids) to Supabase Storage.
 */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

export const UA = "PokeIQ-ingest/1.0 (https://pokeiq.vercel.app; cadenkeen@gmail.com)";
export const ARCHIVES = "https://archives.bulbagarden.net/w/api.php";
export const WIKI = "https://bulbapedia.bulbagarden.net/w/api.php";
export const BUCKET = "geo";

const SHOT_WIDTH = 640;
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
// HTTP helpers (polite: sequential, small delay, retries)
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export async function api<T>(base: string, params: Record<string, string>): Promise<T> {
  await sleep(150);
  const res = await fetchRetry(`${base}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`);
  return (await res.json()) as T;
}

export async function download(url: string): Promise<Buffer> {
  await sleep(100);
  return Buffer.from(await (await fetchRetry(url)).arrayBuffer());
}

/** Resolves File: names to their upload URLs, 50 at a time. */
export async function fileInfo(files: string[]): Promise<Map<string, { url: string; width: number; height: number }>> {
  const out = new Map<string, { url: string; width: number; height: number }>();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const r = await api<{
      query: { normalized?: { from: string; to: string }[]; pages: { title: string; imageinfo?: { url: string; width: number; height: number }[] }[] };
    }>(ARCHIVES, { action: "query", titles: batch.map((f) => `File:${f}`).join("|"), prop: "imageinfo", iiprop: "url|size" });
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
    const r = await api<{
      query: { allimages: { name: string; width: number; height: number }[] };
      continue?: { aicontinue: string };
    }>(ARCHIVES, { action: "query", list: "allimages", aiprefix: prefix, ailimit: "500", aiprop: "size", ...cont });
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
  /** Share of the height to cut off the bottom of a file (the game's place-name banner sits there). */
  trimBottom?: Record<string, number>;
  /** Files from another wiki: their URLs, and a cache-key prefix (their names can clash with the Archives'). */
  urls?: Map<string, string>;
  keyPrefix?: string;
}

/** Downloads, re-encodes and uploads up to `max` of `files`, reusing earlier uploads. */
export async function collectShots(files: string[], max: number, store: ShotStore, storage: GeoStorage, opts: ShotOptions = {}): Promise<GeoShot[]> {
  const { fallback } = opts;
  const urls = opts.urls ?? (await fileUrls(files));
  const shots: GeoShot[] = [];
  for (const file of files) {
    if (shots.length >= max) break;
    const known = gameOf(file) ?? (typeof fallback === "string" ? fallback : undefined);
    const trim = opts.trimBottom?.[file] ?? 0;
    // A trimmed file is a different image from the untrimmed one, so it's cached under its own key.
    const key = (opts.keyPrefix ?? "") + (trim ? `${file}#bottom${trim}` : file);
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
      const webp = await sharp(source)
        .extract(viewCrop(width, Math.round(height * (1 - trim))))
        .resize({ width: SHOT_WIDTH, withoutEnlargement: true })
        .webp({ quality: 66, effort: 6 })
        .toBuffer();
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
