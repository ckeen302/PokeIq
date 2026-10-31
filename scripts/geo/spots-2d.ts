/**
 * PokéGuessr exact spots for the sprite games (Red / Blue to Black 2 /
 * White 2): finds where each screenshot was taken on its place's full map
 * rip, carries that spot onto our atlas through the area's alignment gate,
 * and writes src/data/geo-shot-spots.json ({ id: [x, y, confidence, method,
 * scored] }, x and y on the world map 0–1). Nothing about the screenshots
 * changes; downloads (the wikis' map rips, our stored shots) are cached
 * outside the repo and never committed.
 *
 *   npx tsx scripts/geo/spots-2d.ts info      # the source files' sizes (wiki APIs)
 *   npx tsx scripts/geo/spots-2d.ts fetch     # map rips + stored shots into the cache
 *   npx tsx scripts/geo/spots-2d.ts match     # match, align, known-answer test, write the spots
 *   npx tsx scripts/geo/spots-2d.ts sheets    # overlay review sheets
 *
 * SPOTS_CACHE sets the cache folder (default: the system temp folder).
 *
 * Methods: "cut2d" (the shot is a view cut from the rip, so its spot is
 * known from the cut, and the matcher must find the same place), "tm2d"
 * (template match of an in-game screenshot). A spot is scored only when the
 * match is unique, the area passes the alignment gate (scripts/geo/spot-align.ts)
 * and the method passes the known-answer test; towns get their spot with
 * scored false (the map draws a town as one block).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { WIKI } from "./bulbapedia";
import { httpGet, wikiApi } from "./http";
import { areaGeometry, fitArea, loadAtlas, normalised, shapeOf, type AreaFit, type Px } from "./spot-align";
import { MATCH, gray, matchShot, nativeScale, shrink, type Gray, type MatchResult, type Rgb } from "./spot-match";

const ROOT = process.cwd();
const CACHE = process.env.SPOTS_CACHE ?? path.join(tmpdir(), "pokeiq-spots");
const OUT = path.join(ROOT, "src/data/geo-shot-spots.json");
const FAMILIES = ["rby", "gsc", "rse", "frlg", "dppt", "hgss", "bw"] as const;
type Family = (typeof FAMILIES)[number];
/** Native screens (B2W2 shares Black / White's family). */
const SCREEN: Record<Family, [number, number]> = { rby: [160, 144], gsc: [160, 144], rse: [240, 160], frlg: [240, 160], dppt: [256, 192], hgss: [256, 192], bw: [256, 192] };
/** A shot this many screens big or more is a map of the place, not a view: no spot (a view cut from a map is 1.5 screens across and down). */
const MAX_VIEW_SCREENS = 2.3;
/** A file this many screens big (at its native scale) is a map rip to match against. */
const MIN_RIP_SCREENS = 2.5;
/** Scored only when the view covers at most this share of the map along the route. */
const MAX_FOOTPRINT = 0.4;
/** Scored only on routes drawn at least this long (px): on a shorter one the area's own perfect radius already covers it. */
const MIN_ROUTE_PX = 30;
/** Two matches of a shot (on two rips) farther apart than this on our map make it ambiguous. */
const WORLD_AGREE_PX = 4;
/** Known-answer test: a method passes when this share of its known answers land within KNOWN_TOL_PX of the truth. */
const KNOWN_PASS = 0.98;
const KNOWN_TOL_PX = 2;
const TOWN = /\b(City|Town|Village|Island|Plateau)$/;

const API: Record<string, string> = {
  "archives.bulbagarden.net": WIKI,
  "www.pokepedia.fr": "https://www.pokepedia.fr/api.php",
  "www.pokewiki.de": "https://www.pokewiki.de/api.php",
  "www.wikidex.net": "https://www.wikidex.net/api.php",
  "pokemon.fandom.com": "https://pokemon.fandom.com/api.php",
};

interface Item {
  id: string;
  family: Family;
  game: string;
  region: string;
  name: string;
  host: string;
  file: string;
  /** The view cut from the file: left, top, width, height in its pixels. */
  cut?: [number, number, number, number];
}

const fileKey = (host: string, file: string) => `${host}|${file}`;
const cachePath = (...p: string[]) => path.join(CACHE, ...p);
const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback);

function inventory(): Item[] {
  const geo = JSON.parse(readFileSync(path.join(ROOT, "src/data/geo.json"), "utf8")) as {
    world: { locations: { name: string; region: string; parent?: string; pin?: unknown; shots: { id: string; game: string; family: string }[] }[] };
  };
  const sources = JSON.parse(readFileSync(path.join(ROOT, "scripts/geo/shot-sources.json"), "utf8")) as Record<string, string>;
  const items: Item[] = [];
  for (const l of geo.world.locations) {
    // A building's shots are its inside (or its door): not a spot on the map.
    if (l.parent || !l.pin) continue;
    for (const s of l.shots) {
      if (!(FAMILIES as readonly string[]).includes(s.family)) continue;
      const src = sources[s.id];
      const m = src?.match(/^https:\/\/([^/]+)\/(?:wiki\/)?[^:/]+:(.+?)(?: \(view cut at (\d+),(\d+),(\d+),(\d+)\))?$/);
      if (!m) continue;
      items.push({
        id: s.id,
        family: s.family as Family,
        game: s.game,
        region: l.region,
        name: l.name,
        host: m[1],
        file: decodeURIComponent(m[2]),
        ...(m[3] ? { cut: [Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])] as [number, number, number, number] } : {}),
      });
    }
  }
  return items;
}

type FileInfo = Record<string, { url: string; width: number; height: number } | null>;

/** The source files' URLs and sizes, from each wiki's API (50 per request, polite). */
async function info(items: Item[]) {
  const out = cachePath("fileinfo.json");
  const known: FileInfo = readJson(out, {});
  const byHost = new Map<string, Set<string>>();
  for (const it of items) if (!(fileKey(it.host, it.file) in known)) byHost.set(it.host, (byHost.get(it.host) ?? new Set()).add(it.file));
  await Promise.all(
    [...byHost].map(async ([host, files]) => {
      const api = API[host];
      if (!api) return;
      const list = [...files];
      for (let i = 0; i < list.length; i += 50) {
        const batch = list.slice(i, i + 50);
        const r = await wikiApi<{
          query?: { normalized?: { from: string; to: string }[]; pages: { title: string; imageinfo?: { url: string; width: number; height: number }[] }[] };
        }>(api, { action: "query", titles: batch.map((f) => `File:${f.replace(/_/g, " ")}`).join("|"), prop: "imageinfo", iiprop: "url|size" }).catch((e) => {
          console.warn(`  ! ${host}: ${(e as Error).message}`);
          return null;
        });
        if (!r?.query) continue;
        const back = new Map((r.query.normalized ?? []).map((n) => [n.to, n.from]));
        const found = new Map<string, { url: string; width: number; height: number }>();
        for (const p of r.query.pages) {
          const ii = p.imageinfo?.[0];
          if (ii) found.set((back.get(p.title) ?? p.title).replace(/^File:/, "").replace(/ /g, "_"), { url: ii.url, width: ii.width, height: ii.height });
        }
        for (const f of batch) known[fileKey(host, f)] = found.get(f.replace(/ /g, "_")) ?? null;
        writeFileSync(out, JSON.stringify(known));
      }
      console.log(`  ${host}: ${list.length} files`);
    })
  );
  return known;
}

const curl = (url: string, file: string) =>
  new Promise<boolean>((resolve) => execFile("curl", ["-sS", "-f", "-m", "60", "-o", file, url], (err) => resolve(!err)));

/** A group: one place in one game family, with its shots and its candidate rips. */
const groupKey = (it: Pick<Item, "region" | "name" | "family">) => `${it.region}|${it.name}|${it.family}`;

/** Bulbapedia's map-rip file codes per family (its full-area maps are named "<Region> Route 3 FRLG.png", "Ilex Forest GSC.png"…). */
const RIP_CODES: Partial<Record<Family, string[]>> = { rby: ["RBY", "RB", "Y"], gsc: ["GSC", "GS", "C"], rse: ["RSE", "RS", "E"], frlg: ["FRLG"] };

/**
 * Places with Game Boy / Game Boy Advance views but no map rip among their
 * shots' sources: Bulbapedia's own full-area map, by its naming pattern
 * (one API request per 50 names, then a download per rip found).
 */
async function guessRips(items: Item[]) {
  const files = readJson<FileInfo>(cachePath("fileinfo.json"), {});
  const have = ripCandidates(items, files);
  const out = cachePath("guessed.json");
  const guessed = readJson<Record<string, string[]>>(out, {});
  const names = new Map<string, string>();
  for (const it of items) {
    const key = groupKey(it);
    if (have.has(key) || guessed[key] || !RIP_CODES[it.family]) continue;
    const base = (/^Route \d+$/.test(it.name) ? `${it.region} ${it.name}` : it.name).replace(/ /g, "_");
    for (const code of RIP_CODES[it.family]!) names.set(`${base}_${code}.png`, key);
  }
  const list = [...names.keys()];
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const r = await wikiApi<{ query?: { normalized?: { from: string; to: string }[]; pages: { title: string; imageinfo?: { url: string; width: number; height: number }[] }[] } }>(WIKI, {
      action: "query",
      titles: batch.map((f) => `File:${f.replace(/_/g, " ")}`).join("|"),
      prop: "imageinfo",
      iiprop: "url|size",
    }).catch(() => null);
    for (const p of r?.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const file = p.title.replace(/^File:/, "").replace(/ /g, "_");
      const key = names.get(file);
      if (!key) continue;
      const fk = fileKey("archives.bulbagarden.net", file);
      files[fk] = { url: ii.url, width: ii.width, height: ii.height };
      guessed[key] = [...(guessed[key] ?? []), fk];
    }
  }
  writeFileSync(cachePath("fileinfo.json"), JSON.stringify(files));
  writeFileSync(out, JSON.stringify(guessed, null, 1));
  let n = 0;
  for (const fk of new Set(Object.values(guessed).flat())) {
    if (existsSync(ripFile(fk))) continue;
    try {
      writeFileSync(ripFile(fk), await httpGet(files[fk]!.url));
      n++;
    } catch (e) {
      console.warn(`  ! ${fk}: ${(e as Error).message}`);
    }
  }
  console.log(`guessed rips: ${Object.keys(guessed).length} places, ${n} fetched (${list.length} names asked)`);
}

/** The files of a group big enough to be a map of the place (before their pixel scale is known), and Bulbapedia rips found by name. */
function ripCandidates(items: Item[], files: FileInfo): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [key, fks] of Object.entries(readJson<Record<string, string[]>>(cachePath("guessed.json"), {}))) out.set(key, new Set(fks));
  for (const it of items) {
    const fi = files[fileKey(it.host, it.file)];
    if (!fi) continue;
    const [sw, sh] = SCREEN[it.family];
    if (it.cut || fi.width * fi.height >= MIN_RIP_SCREENS * sw * sh) {
      const set = out.get(groupKey(it)) ?? new Set();
      set.add(fileKey(it.host, it.file));
      out.set(groupKey(it), set);
    }
  }
  return out;
}

const ripFile = (key: string) => cachePath("rips", key.replace(/[^\w.-]+/g, "_"));

async function fetchAll(items: Item[]) {
  const files = await info(items);
  mkdirSync(cachePath("rips"), { recursive: true });
  mkdirSync(cachePath("shots"), { recursive: true });
  // Our own stored shots: eight at a time.
  const base = (JSON.parse(readFileSync(path.join(ROOT, "src/data/geo.json"), "utf8")) as { storageBase: string }).storageBase;
  const todo = items.filter((it) => !existsSync(cachePath("shots", `${it.id}.webp`)));
  for (let i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map((it) => curl(`${base}/${it.id}.webp`, cachePath("shots", `${it.id}.webp`))));
  console.log(`shots: ${items.length - todo.length} cached, ${todo.length} fetched`);
  // The wikis' rips: politely (one request per host at a time, a gap between).
  const rips = [...new Set([...ripCandidates(items, files).values()].flatMap((s) => [...s]))].filter((k) => !existsSync(ripFile(k)));
  const byHost = new Map<string, string[]>();
  for (const k of rips) byHost.set(k.split("|")[0], [...(byHost.get(k.split("|")[0]) ?? []), k]);
  let n = 0;
  await Promise.all(
    [...byHost.values()].map(async (keys) => {
      for (const k of keys) {
        const fi = files[k];
        if (!fi) continue;
        try {
          writeFileSync(ripFile(k), await httpGet(fi.url));
          if (++n % 25 === 0) console.log(`  rips: ${n}/${rips.length}`);
        } catch (e) {
          console.warn(`  ! ${k}: ${(e as Error).message}`);
        }
      }
    })
  );
  console.log(`rips: ${n} fetched`);
}

async function loadRgb(file: string): Promise<{ img: Rgb; alpha: Buffer }> {
  const { data, info: i } = await sharp(file).flatten({ background: "#000" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: alpha } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { img: { w: i.width, h: i.height, data: new Uint8Array(data) }, alpha };
}

interface Rip {
  key: string;
  scale: number;
  img: Rgb;
  g: Gray;
  rgba: Buffer;
}

async function loadRip(key: string): Promise<Rip | null> {
  const file = ripFile(key);
  if (!existsSync(file)) return null;
  try {
    const { img, alpha } = await loadRgb(file);
    const scale = nativeScale(img, 4);
    const native = shrink(img, scale);
    // The native RGBA (alpha from the block's top-left) for the shape.
    const rgba = Buffer.alloc(native.w * native.h * 4);
    for (let y = 0; y < native.h; y++)
      for (let x = 0; x < native.w; x++) {
        const s = (y * scale * img.w + x * scale) * 4;
        const d = (y * native.w + x) * 4;
        rgba[d] = alpha[s];
        rgba[d + 1] = alpha[s + 1];
        rgba[d + 2] = alpha[s + 2];
        rgba[d + 3] = alpha[s + 3];
      }
    return { key, scale, img: native, g: gray(native), rgba };
  } catch {
    return null;
  }
}

export type SpotRow = [x: number, y: number, confidence: number, method: string, scored: boolean];

interface ShotResult {
  id: string;
  family: Family;
  game: string;
  region: string;
  name: string;
  kind: "map" | "view" | "missing";
  method?: "cut2d" | "tm2d";
  rip?: string;
  match?: MatchResult;
  /** Native rip pixels: the spot (the view's middle). */
  at?: Px;
  /** For a cut: the truth, and the matcher's error (native px). */
  truth?: Px;
  errPx?: number;
  world?: Px;
  spot?: SpotRow;
  why?: string;
}

const centre = (m: MatchResult): Px => [m.best.x + m.w / 2, m.best.y + m.h / 2];

async function run(items: Item[]) {
  const files = readJson<FileInfo>(cachePath("fileinfo.json"), {});
  const atlas = await loadAtlas(ROOT);
  const candidates = ripCandidates(items, files);
  const groups = new Map<string, Item[]>();
  for (const it of items) groups.set(groupKey(it), [...(groups.get(groupKey(it)) ?? []), it]);
  const results: ShotResult[] = [];
  const fits: Record<string, { ok: boolean; reasons: string[]; checks: AreaFit["checks"]; controls: AreaFit["controls"]; town: boolean; pathNote?: string }> = {};
  const fitCache = new Map<string, AreaFit | null>();
  let g = 0;
  for (const [key, group] of groups) {
    g++;
    const [region, name, family] = key.split("|") as [string, string, Family];
    const [sw, sh] = SCREEN[family];
    const rips: Rip[] = [];
    for (const k of candidates.get(key) ?? []) {
      const r = await loadRip(k);
      if (r && r.img.w * r.img.h >= MIN_RIP_SCREENS * sw * sh) rips.push(r);
    }
    const area = areaGeometry(atlas, region, name);
    const town = TOWN.test(name);
    const fitOf = (rip: Rip): AreaFit | null => {
      const fk = `${key}|${rip.key}`;
      if (!fitCache.has(fk)) {
        const fit = area ? fitArea(atlas, area, shapeOf(rip.rgba, rip.img.w, rip.img.h, 16)) : null;
        fitCache.set(fk, fit);
        if (fit) fits[fk] = { ok: fit.ok, reasons: fit.reasons, checks: fit.checks, controls: fit.controls, town, ...(area?.pathNote ? { pathNote: area.pathNote } : {}) };
      }
      return fitCache.get(fk)!;
    };
    for (const it of group) {
      const base: ShotResult = { id: it.id, family, game: it.game, region, name, kind: "missing" };
      const file = cachePath("shots", `${it.id}.webp`);
      if (!existsSync(file)) {
        results.push({ ...base, why: "shot not fetched" });
        continue;
      }
      const { img } = await loadRgb(file);
      const shot = shrink(img, nativeScale(img, 12));
      if (shot.w * shot.h > MAX_VIEW_SCREENS * sw * sh) {
        results.push({ ...base, kind: "map", why: "a map of the place, not a view" });
        continue;
      }
      if (!rips.length) {
        results.push({ ...base, kind: "view", why: "no map rip for this place" });
        continue;
      }
      const sg = gray(shot);
      const tries = rips.map((rip) => ({ rip, m: matchShot(sg, rip.g) }));
      const own = it.cut ? tries.find((t) => t.rip.key === fileKey(it.host, it.file)) : undefined;
      const best = own ?? tries.reduce((a, b) => (b.m.best.score > a.m.best.score ? b : a));
      const res: ShotResult = { ...base, kind: "view", method: it.cut ? "cut2d" : "tm2d", rip: best.rip.key, match: best.m, at: centre(best.m) };
      if (it.cut && own) {
        const s = own.rip.scale;
        const truth: Px = [(it.cut[0] + it.cut[2] / 2) / s, (it.cut[1] + it.cut[3] / 2) / s];
        res.truth = truth;
        res.errPx = Math.round(Math.hypot(res.at![0] - truth[0], res.at![1] - truth[1]) * 10) / 10;
        // A cut's spot is the cut itself.
        res.at = truth;
      }
      if (!best.m.ok) {
        results.push({ ...res, why: best.m.reason });
        continue;
      }
      if (it.cut && (res.errPx ?? Infinity) > KNOWN_TOL_PX) {
        results.push({ ...res, why: `matcher disagrees with the cut by ${res.errPx}px` });
        continue;
      }
      const fit = fitOf(best.rip);
      if (!fit) {
        results.push({ ...res, why: "place not on the atlas" });
        continue;
      }
      const world = fit.toWorld(res.at![0], res.at![1]);
      res.world = world;
      // Another rip of the place matching well elsewhere on our map: ambiguous.
      const rival = tries.find((t) => {
        if (t === best || t.m.best.score < best.m.best.score - MATCH.MIN_MARGIN) return false;
        const f = fitOf(t.rip);
        if (!f) return true;
        const w = f.toWorld(...centre(t.m));
        return Math.hypot(w[0] - world[0], w[1] - world[1]) > WORLD_AGREE_PX;
      });
      if (rival) {
        results.push({ ...res, why: `also matches ${rival.rip.key} elsewhere` });
        continue;
      }
      const margin = best.m.second ? best.m.best.score - best.m.second.score : 1;
      const confidence = Math.round(Math.min(1, 0.5 + margin + 0.5 * (best.m.best.agree - MATCH.MIN_AGREE)) * 100) / 100;
      const [nx, ny] = normalised(atlas, world);
      if (town) {
        // A town is stored unscored: its box and proportions must agree (a town has no route ends to check).
        const townReasons = fit.reasons.filter((r) => r !== "no control points");
        res.spot = [nx, ny, confidence, res.method!, false];
        res.why = townReasons.length ? `town; alignment: ${townReasons.join("; ")}` : "town (unscored)";
        results.push(townReasons.length ? { ...res, spot: undefined } : res);
        continue;
      }
      const reasons = [...fit.reasons];
      if (!area?.pathBox) reasons.push(area?.pathNote ?? "no drawn path");
      else {
        const tall = area.pathBox[3] - area.pathBox[1] >= area.pathBox[2] - area.pathBox[0];
        const length = tall ? area.pathBox[3] - area.pathBox[1] : area.pathBox[2] - area.pathBox[0];
        if (length < MIN_ROUTE_PX) reasons.push(`route drawn ${Math.round(length)}px long`);
        const along = tall ? best.m.h / best.rip.img.h : best.m.w / best.rip.img.w;
        if (along > MAX_FOOTPRINT) reasons.push(`view covers ${Math.round(along * 100)}% of the route`);
      }
      res.spot = [nx, ny, confidence, res.method!, reasons.length === 0];
      if (reasons.length) {
        res.why = reasons.join("; ");
        // Only aligned spots are stored; an area that failed the gate keeps area scoring.
        if (!fit.ok) res.spot = undefined;
      }
      results.push(res);
    }
    if (g % 50 === 0) console.log(`  ${g}/${groups.size} places`);
  }
  return { results, fits };
}

/**
 * Known answers for the template matcher: windows cut from the rips at fixed
 * pseudo-random places, each with a player-sized block of noise in the middle
 * (a person standing there), plus every real view cut. Error = distance from
 * the matched window's middle to the truth, in native pixels.
 */
async function knownAnswers(items: Item[], perRip = 6) {
  const files = readJson<FileInfo>(cachePath("fileinfo.json"), {});
  const candidates = ripCandidates(items, files);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const byFamily: Record<string, { n: number; accepted: number; within: number; wrongAccepted: number; errs: number[] }> = {};
  for (const [key, set] of candidates) {
    const family = key.split("|")[2] as Family;
    const [sw, sh] = SCREEN[family];
    for (const k of set) {
      const rip = await loadRip(k);
      if (!rip || rip.img.w < sw * 1.5 || rip.img.h < sh * 1.5) continue;
      const stat = (byFamily[family] ??= { n: 0, accepted: 0, within: 0, wrongAccepted: 0, errs: [] });
      for (let i = 0; i < perRip; i++) {
        const x = Math.floor(rand() * (rip.img.w - sw));
        const y = Math.floor(rip.img.h > sh ? rand() * (rip.img.h - sh) : 0);
        const px = new Float32Array(sw * sh);
        for (let ty = 0; ty < sh; ty++) for (let tx = 0; tx < sw; tx++) px[ty * sw + tx] = rip.g.px[(y + ty) * rip.g.w + x + tx];
        // A 16 × 24 "person" in the middle.
        for (let ty = sh / 2 - 12; ty < sh / 2 + 12; ty++) for (let tx = sw / 2 - 8; tx < sw / 2 + 8; tx++) px[ty * sw + tx] = Math.floor(rand() * 256);
        const m = matchShot({ w: sw, h: sh, px }, rip.g);
        const err = Math.hypot(m.best.x - x, m.best.y - y);
        stat.n++;
        if (m.ok) {
          stat.accepted++;
          stat.errs.push(err);
          if (err <= KNOWN_TOL_PX) stat.within++;
          else stat.wrongAccepted++;
        }
      }
    }
  }
  return byFamily;
}

async function main() {
  const step = process.argv[2];
  mkdirSync(CACHE, { recursive: true });
  const items = inventory();
  console.log(`${items.length} sprite-game shots of pinned places`);
  if (step === "info") await info(items);
  else if (step === "fetch") await fetchAll(items);
  else if (step === "guess") await guessRips(items);
  else if (step === "match") {
    const known = await knownAnswers(items);
    const { results, fits } = await run(items);
    // The known-answer test per method: synthetic windows for tm2d, the real cuts for cut2d.
    const cuts = results.filter((r) => r.method === "cut2d" && r.errPx !== undefined && r.match?.ok);
    const tmAll = Object.values(known).reduce((a, b) => ({ accepted: a.accepted + b.accepted, within: a.within + b.within }), { accepted: 0, within: 0 });
    const methods = {
      tm2d: { known: tmAll.accepted, within: tmAll.within, pass: tmAll.accepted > 0 && tmAll.within / tmAll.accepted >= KNOWN_PASS },
      cut2d: { known: cuts.length, within: cuts.filter((r) => r.errPx! <= KNOWN_TOL_PX).length, pass: false },
    };
    methods.cut2d.pass = methods.cut2d.known > 0 && methods.cut2d.within / methods.cut2d.known >= KNOWN_PASS;
    const spots: Record<string, SpotRow> = {};
    for (const r of results) {
      if (!r.spot) continue;
      const pass = methods[r.method!].pass;
      spots[r.id] = pass ? r.spot : [r.spot[0], r.spot[1], r.spot[2], r.spot[3], false];
    }
    // Keep Agent-independent 3D spots out of this file: they live in geo-shot-spots-3d.json.
    const sorted = Object.fromEntries(Object.entries(spots).sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(OUT, `{\n${Object.entries(sorted).map(([id, row]) => `  ${JSON.stringify(id)}: ${JSON.stringify(row)}`).join(",\n")}\n}\n`);
    writeFileSync(cachePath("results.json"), JSON.stringify({ results, fits, known, methods }, null, 1));
    const by = (f: string) => results.filter((r) => r.family === f);
    for (const f of FAMILIES) {
      const rs = by(f);
      console.log(
        `${f}: ${rs.length} shots, ${rs.filter((r) => r.kind === "view").length} views, ${rs.filter((r) => r.match?.ok).length} matched, ${rs.filter((r) => r.spot).length} spotted, ${rs.filter((r) => spots[r.id]?.[4]).length} scored`
      );
    }
    const fitList = Object.values(fits).filter((f) => !f.town);
    console.log(`alignment: ${fitList.filter((f) => f.ok).length}/${fitList.length} area fits pass (towns aside)`);
    console.log(
      "known answers:",
      JSON.stringify(methods),
      JSON.stringify(
        Object.fromEntries(
          Object.entries(known).map(([f, s]) => [f, { n: s.n, accepted: s.accepted, within: s.within, wrong: s.wrongAccepted, maxErr: Math.round(Math.max(0, ...s.errs) * 10) / 10, wrongErrs: s.errs.filter((e) => e > KNOWN_TOL_PX).map((e) => Math.round(e)) }])
        )
      )
    );
    const cutErrs = cuts.map((r) => r.errPx!);
    console.log(`cut2d errors (native px): n ${cutErrs.length}, max ${Math.max(0, ...cutErrs)}, over ${KNOWN_TOL_PX}px: ${cutErrs.filter((e) => e > KNOWN_TOL_PX).length}`);
  } else if (step === "sheets") {
    await sheets(process.argv[3] ?? cachePath("sheets"));
  } else {
    console.log("steps: info | fetch | match | sheets <dir>");
  }
}

/**
 * Overlay review sheets: per game family, rows of [the shot | where it
 * matched on the rip | the spot on our atlas, with the area's mask], the
 * scored spots first, then the stored unscored ones (towns).
 */
async function sheets(dir: string) {
  mkdirSync(dir, { recursive: true });
  const { results } = readJson<{ results: ShotResult[] }>(cachePath("results.json"), { results: [] });
  const atlas = await loadAtlas(ROOT);
  const W = 300;
  const H = 220;
  const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  for (const family of FAMILIES) {
    const spotted = results.filter((r) => r.family === family && r.spot && r.world);
    const pick = [...spotted.filter((r) => r.spot![4]), ...spotted.filter((r) => !r.spot![4])].sort((a, b) => Number(b.spot![4]) - Number(a.spot![4]) || hash(a.id) - hash(b.id)).slice(0, 10);
    if (!pick.length) continue;
    const rows: Buffer[] = [];
    for (const r of pick) {
      const shotPng = await sharp(cachePath("shots", `${r.id}.webp`)).resize(W, H, { fit: "contain", background: "#111", kernel: "nearest" }).png().toBuffer();
      // The rip around the match, the matched window outlined.
      const rip = await loadRip(r.rip!);
      let ripPng = await sharp({ create: { width: W, height: H, channels: 3, background: "#111" } }).png().toBuffer();
      if (rip && r.match) {
        const m = r.match;
        const pad = Math.max(m.w, m.h) * 0.6;
        const left = Math.max(0, Math.floor(m.best.x - pad));
        const top = Math.max(0, Math.floor(m.best.y - pad));
        const width = Math.min(rip.img.w - left, Math.ceil(m.w + 2 * pad));
        const height = Math.min(rip.img.h - top, Math.ceil(m.h + 2 * pad));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${m.best.x - left}" y="${m.best.y - top}" width="${m.w}" height="${m.h}" fill="none" stroke="#ff2d55" stroke-width="3"/></svg>`;
        const raw = await sharp(Buffer.from(rip.img.data), { raw: { width: rip.img.w, height: rip.img.h, channels: 3 } })
          .extract({ left, top, width, height })
          .png()
          .toBuffer();
        ripPng = await sharp(await sharp(raw).composite([{ input: Buffer.from(svg) }]).png().toBuffer())
          .resize(W, H, { fit: "contain", background: "#111" })
          .png()
          .toBuffer();
      }
      // Our atlas around the spot: the area's mask (blue), the spot (red ring).
      const [wx, wy] = r.world!;
      const span = 110;
      const L = Math.max(0, Math.round(wx - span / 2));
      const T = Math.max(0, Math.round(wy - (span * H) / W / 2));
      const sw = span;
      const shh = Math.round((span * H) / W);
      const s = W / sw;
      const area = atlas.locations.find((l) => l.region === r.region && l.name === r.name);
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
      for (const [mx, my] of area?.mask ?? []) svg += `<circle cx="${(mx * atlas.width - L) * s}" cy="${(my * atlas.height - T) * s}" r="2.5" fill="#1e6bff" fill-opacity="0.7"/>`;
      svg += `<circle cx="${(wx - L) * s}" cy="${(wy - T) * s}" r="${3 * s}" fill="none" stroke="#ff2d55" stroke-width="2.5"/><circle cx="${(wx - L) * s}" cy="${(wy - T) * s}" r="2.5" fill="#ff2d55"/>`;
      svg += `<text x="6" y="${H - 8}" font-family="sans-serif" font-size="13" fill="#fff" stroke="#000" stroke-width="0.6">${esc(`${r.name} · ${r.game} · ${r.method} · ${r.spot![4] ? "scored" : "unscored"} · ${r.spot![2]}`)}</text></svg>`;
      const atlasPng = await sharp(atlas.rgb, { raw: { width: atlas.width, height: atlas.height, channels: 3 } })
        .extract({ left: L, top: T, width: sw, height: shh })
        .resize(W, H, { kernel: "nearest" })
        .composite([{ input: Buffer.from(svg) }])
        .png()
        .toBuffer();
      rows.push(
        await sharp({ create: { width: W * 3 + 8, height: H, channels: 3, background: "#000" } })
          .composite([
            { input: shotPng, left: 0, top: 0 },
            { input: ripPng, left: W + 4, top: 0 },
            { input: atlasPng, left: 2 * W + 8, top: 0 },
          ])
          .png()
          .toBuffer()
      );
    }
    const sheet = sharp({ create: { width: W * 3 + 8, height: rows.length * (H + 4), channels: 3, background: "#000" } }).composite(rows.map((input, i) => ({ input, left: 0, top: i * (H + 4) })));
    await sheet.png().toFile(path.join(dir, `review-${family}.png`));
    console.log(`${family}: ${rows.length} rows`);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
