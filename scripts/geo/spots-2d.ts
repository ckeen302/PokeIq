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
 *   npx tsx scripts/geo/spots-2d.ts world     # the Game Boy / GBA overworld layouts (pret disassemblies) into the cache
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
import { areaGeometry, contentBox, fitArea, loadAtlas, normalised, shapeOf, type Atlas, type Px } from "./spot-align";
import { MATCH, gray, matchShot, nativeScale, shrink, type Gray, type MatchResult, type Rgb } from "./spot-match";
import { boundedSides, fitLocal, maskBox, meetingPoint, onMask, type Control, type LocalFit } from "./spot-warp";
import { fetchPret, loadWorld, mapsForPlace, placeEdges, placeWarps, unionRect, type GameMap, type PretGame } from "./spot-world";
import { apply, fitCamera, flatten, homography, PLAYER, type Camera, type PairSet } from "./spot-camera";

const ROOT = process.cwd();
const CACHE = process.env.SPOTS_CACHE ?? path.join(tmpdir(), "pokeiq-spots");
const OUT = path.join(ROOT, "src/data/geo-shot-spots.json");
const FAMILIES = ["rby", "gsc", "rse", "frlg", "dppt", "hgss", "bw"] as const;
type Family = (typeof FAMILIES)[number];
/** Native screens (B2W2 shares Black / White's family). */
const SCREEN: Record<Family, [number, number]> = {
  rby: [160, 144],
  gsc: [160, 144],
  rse: [240, 160],
  frlg: [240, 160],
  dppt: [256, 192],
  hgss: [256, 192],
  bw: [256, 192],
};
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
const TOWN = /\b(City|Town|Village|Island|Plateau|Area)$/;
/** Caves, forests, towers and other places our map draws as an icon: area-scored unless the icon has a drawn path to aim at. */
const ICON = /\b(Cave|Caves|Cavern|Forest|Woods|Tunnel|Tower|Hideout|Well|Den|Chamber|Grotto|Hole|Mansion|Ship|Temple|Plant|Lab|Warehouse|Mine|Mount|Victory Road|Seafoam Islands)\b|^Mt\. /;

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
    world: {
      locations: {
        name: string;
        region: string;
        parent?: string;
        pin?: unknown;
        shots: { id: string; game: string; family: string }[];
      }[];
    };
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
        ...(m[3]
          ? {
              cut: [Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])] as [number, number, number, number],
            }
          : {}),
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
          query?: {
            normalized?: { from: string; to: string }[];
            pages: {
              title: string;
              imageinfo?: { url: string; width: number; height: number }[];
            }[];
          };
        }>(api, {
          action: "query",
          titles: batch.map((f) => `File:${f.replace(/_/g, " ")}`).join("|"),
          prop: "imageinfo",
          iiprop: "url|size",
        }).catch((e) => {
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

const curl = (url: string, file: string) => new Promise<boolean>((resolve) => execFile("curl", ["-sS", "-f", "-m", "60", "-o", file, url], (err) => resolve(!err)));

/** A group: one place in one game family, with its shots and its candidate rips. */
const groupKey = (it: Pick<Item, "region" | "name" | "family">) => `${it.region}|${it.name}|${it.family}`;

/** Bulbapedia's map-rip file codes per family (its full-area maps are named "<Region> Route 3 FRLG.png", "Ilex Forest GSC.png", "Unova Route 7 Spring BW.png"…). */
const RIP_CODES: Record<Family, string[]> = {
  rby: ["RBY", "RB", "Y"],
  gsc: ["GSC", "GS", "C"],
  rse: ["RSE", "RS", "E"],
  frlg: ["FRLG"],
  dppt: ["DP", "Pt", "DPPt"],
  hgss: ["HGSS"],
  bw: ["Summer_BW", "Spring_BW", "BW", "Summer_B2W2", "Spring_B2W2", "B2W2", "Summer_BWB2W2", "BWB2W2"],
};

/**
 * Bulbapedia's own full-area maps of every place, by its naming pattern
 * ("Unova Route 7 Spring BW.png"), besides the rips among the shots' sources
 * (one API request per 50 names, then a download per rip found).
 */
async function guessRips(items: Item[]) {
  const files = readJson<FileInfo>(cachePath("fileinfo.json"), {});
  const out = cachePath("guessed.json");
  const guessed = readJson<Record<string, string[]>>(out, {});
  const names = new Map<string, string>();
  for (const it of items) {
    const key = groupKey(it);
    // Every place, also one with big files among its sources: a screenshot enlarged 5× looks like a map by its size alone.
    if (guessed[key] || names.size > 4000) continue;
    const base = (/^Route \d+$/.test(it.name) ? `${it.region} ${it.name}` : it.name).replace(/ /g, "_");
    for (const code of RIP_CODES[it.family]!) names.set(`${base}_${code}.png`, key);
  }
  const list = [...names.keys()];
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const r = await wikiApi<{
      query?: {
        normalized?: { from: string; to: string }[];
        pages: {
          title: string;
          imageinfo?: { url: string; width: number; height: number }[];
        }[];
      };
    }>(WIKI, {
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
  const base = (
    JSON.parse(readFileSync(path.join(ROOT, "src/data/geo.json"), "utf8")) as {
      storageBase: string;
    }
  ).storageBase;
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
  return {
    img: { w: i.width, h: i.height, data: new Uint8Array(data) },
    alpha,
  };
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
  method?: "cut2d" | "tm2d" | "flat3d";
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

/** The pret disassembly whose overworld a family's maps come from, and the atlas regions it covers. */
const PRET: Partial<Record<Family, { game: PretGame; regions: string[] }>> = {
  rby: { game: "red", regions: ["Kanto"] },
  gsc: { game: "crystal", regions: ["Johto", "Kanto"] },
  rse: { game: "emerald", regions: ["Hoenn"] },
  frlg: { game: "firered", regions: ["Kanto", "Sevii Islands"] },
};

/**
 * A fit of one map rip onto our atlas, whichever way it was made: "piecewise"
 * (the game's own overworld layout and its connections and doors as control
 * points: scripts/geo/spot-warp.ts) or "affine" (the rip's outline onto the
 * area's drawn path or box: scripts/geo/spot-align.ts, for the DS games and
 * places pret's maps don't cover).
 */
interface Fit {
  kind: "piecewise" | "anchored" | "affine";
  ok: boolean;
  reasons: string[];
  /** Rip px → world px. */
  toWorld: (x: number, y: number) => Px;
  /** Rip px → world px, and whether the spot lies on the area (a piecewise fit isn't snapped onto it). */
  onArea: (p: Px) => boolean;
  /** The area's length on our map along its long axis (px), for the short-route rule. */
  lengthPx: number | null;
  controls: { label: string; px: number; looPx?: number }[];
  checks: Record<string, number>;
}

/**
 * The flattened DS match's gate: the same uniqueness margin and pixel
 * agreement as a flat match, a lower floor on the correlation (a flattened
 * screenshot keeps its sprites, trees and roofs stretched by the camera, and
 * Diamond / Pearl shots are matched against Platinum's recoloured rips). Its
 * known-answer test (`knownFlat`) reports what this floor lets through.
 */
const FLAT_GATE = {
  MIN_SCORE: 0.55,
  MIN_MARGIN: MATCH.MIN_MARGIN,
  MIN_AGREE: MATCH.MIN_AGREE,
};
/** A flattened match within this many native px of the truth is right (a quarter of a DS tile). */
const FLAT_TOL_PX = 4;

/** The DS cameras, fitted from scripts/geo/spot-ds-pairs.json (Black / White has too few pairs: none). */
function loadCameras(): Map<Family, Camera> {
  const sets = JSON.parse(readFileSync(path.join(ROOT, "scripts/geo/spot-ds-pairs.json"), "utf8")) as Record<string, PairSet[]>;
  const out = new Map<Family, Camera>();
  for (const [family, s] of Object.entries(sets)) {
    const cam = fitCamera(s);
    if (cam) out.set(family as Family, cam);
  }
  return out;
}

/**
 * Known answers for the flattened match, per family:
 *  - "pairs": every screenshot of spot-ds-pairs.json, matched through a camera
 *    fitted without it; the truth is where its own pairs put the player;
 *  - "synthetic": windows of every rip seen through the camera (the forward
 *    projection of a top-down window, a person-sized noise block where the
 *    player stands), flattened back and matched;
 *  - "wrong rip": each pair screenshot matched against six other places' rips
 *    of its family; any accepted match is a false one.
 */
async function knownFlat(items: Item[], cameras: Map<Family, Camera>) {
  const sets = JSON.parse(readFileSync(path.join(ROOT, "scripts/geo/spot-ds-pairs.json"), "utf8")) as Record<string, PairSet[]>;
  const files = readJson<FileInfo>(cachePath("fileinfo.json"), {});
  const candidates = ripCandidates(items, files);
  const atlas = await loadAtlas(ROOT);
  const out: Record<
    string,
    {
      pairs: { n: number; accepted: number; within: number; errs: number[] };
      synthetic: {
        n: number;
        accepted: number;
        within: number;
        errs: number[];
      };
      wrongRip: { n: number; accepted: number };
    }
  > = {};
  let seed = 4242;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const [family, cam] of cameras) {
    const stat = (out[family] = {
      pairs: { n: 0, accepted: 0, within: 0, errs: [] as number[] },
      synthetic: { n: 0, accepted: 0, within: 0, errs: [] as number[] },
      wrongRip: { n: 0, accepted: 0 },
    });
    const familyRips = [...new Set([...candidates].filter(([k]) => k.endsWith(`|${family}`)).flatMap(([, s]) => [...s]))];
    for (const s of sets[family] ?? []) {
      const loo = fitCamera(sets[family].filter((q) => q.id !== s.id));
      const Hs = homography(
        s.pairs.map((p) => [p[0], p[1]]),
        s.pairs.map((p) => [p[2], p[3]])
      );
      const rip = await loadRip(s.rip);
      const file = cachePath("shots", `${s.id}.webp`);
      if (!loo || !Hs || !rip || !existsSync(file)) continue;
      const { img } = await loadRgb(file);
      const shot = shrink(img, nativeScale(img, 12));
      const flat = flatten(shot, loo);
      const m = matchShot(flat.g, rip.g, FLAT_GATE);
      const truth = apply(Hs, ...PLAYER);
      const err = Math.hypot(m.best.x + flat.origin[0] - truth[0], m.best.y + flat.origin[1] - truth[1]);
      stat.pairs.n++;
      if (m.ok) {
        stat.pairs.accepted++;
        stat.pairs.errs.push(Math.round(err * 10) / 10);
        if (err <= FLAT_TOL_PX) stat.pairs.within++;
      }
      // The same screenshot against other places' rips: not its own place's (another version's rip of it) nor a place next to it on our map (a route's rip shows the gate of the place at its end).
      const it = items.find((q) => q.id === s.id);
      const near = new Set(it ? [it.name, ...(areaGeometry(atlas, it.region, it.name)?.neighbours.map((n) => n.name) ?? [])] : []);
      const others = [...new Set([...candidates].filter(([k]) => k.endsWith(`|${family}`) && !near.has(k.split("|")[1])).flatMap(([, q]) => [...q]))].filter((k) => k !== s.rip);
      for (let i = 0; i < 6 && others.length; i++) {
        const other = await loadRip(others[Math.floor(rand() * others.length)]);
        if (!other || other.img.w < flat.img.w || other.img.h < flat.img.h) continue;
        stat.wrongRip.n++;
        if (matchShot(flat.g, other.g, FLAT_GATE).ok) stat.wrongRip.accepted++;
      }
    }
    // Synthetic: 3 windows per rip, seen through the camera.
    const [sw, sh] = [256, 138];
    const H = cam.H;
    for (const k of familyRips) {
      const rip = await loadRip(k);
      if (!rip) continue;
      for (let i = 0; i < 3; i++) {
        // The ground the screen sees, around a player standing at (px, py).
        const corners = [apply(H, 0, 0), apply(H, sw, 0), apply(H, 0, sh), apply(H, sw, sh)];
        const minX = Math.min(...corners.map((c) => c[0]));
        const maxX = Math.max(...corners.map((c) => c[0]));
        const minY = Math.min(...corners.map((c) => c[1]));
        const maxY = Math.max(...corners.map((c) => c[1]));
        if (rip.img.w < maxX - minX + 2 || rip.img.h < maxY - minY + 2) break;
        const px = Math.floor(-minX + rand() * (rip.img.w - (maxX - minX) - 1));
        const py = Math.floor(-minY + rand() * (rip.img.h - (maxY - minY) - 1));
        const data = new Uint8Array(sw * sh * 3);
        for (let y = 0; y < sh; y++)
          for (let x = 0; x < sw; x++) {
            const [gx, gy] = apply(H, x + 0.5, y + 0.5);
            const rx = Math.min(rip.img.w - 1, Math.max(0, Math.floor(gx + px)));
            const ry = Math.min(rip.img.h - 1, Math.max(0, Math.floor(gy + py)));
            const s = (ry * rip.img.w + rx) * 3;
            const d = (y * sw + x) * 3;
            const person = Math.abs(x - PLAYER[0]) < 8 && Math.abs(y - PLAYER[1] + 8) < 14;
            for (let c = 0; c < 3; c++) data[d + c] = person ? Math.floor(rand() * 256) : rip.img.data[s + c];
          }
        const flat = flatten({ w: sw, h: sh, data }, cam);
        const m = matchShot(flat.g, rip.g, FLAT_GATE);
        const err = Math.hypot(m.best.x + flat.origin[0] - px, m.best.y + flat.origin[1] - py);
        stat.synthetic.n++;
        if (m.ok) {
          stat.synthetic.accepted++;
          stat.synthetic.errs.push(Math.round(err * 10) / 10);
          if (err <= FLAT_TOL_PX) stat.synthetic.within++;
        }
      }
    }
  }
  return out;
}

/**
 * The fit of a rip with no game layout behind it (the DS games, whose map
 * data pret doesn't have as a layout; a Game Boy / GBA rip of another size
 * than pret's map): the same piecewise fit (scripts/geo/spot-warp.ts), with
 * the control points read off our map alone. Every place whose area meets
 * this one on our map is a neighbour joining it on the side of the area's
 * box where they meet (within 6 px of that side), so that side of the rip's
 * content (its map, not the void around it) ends where they meet. Nothing
 * says where along a side a neighbour joins in the game, so no knots: each
 * axis runs linearly between its ends, and the gate asks for both ends of
 * the long axis held by a neighbour (or one held and the other bounded) and
 * the rip's content on the area's mask.
 */
function anchoredFit(atlas: Atlas, region: string, name: string, rip: Rip): Fit | null {
  const self = atlas.locations.find((l) => l.region === region && l.name === name);
  if (!self) return null;
  const toPx = (l: (typeof atlas.locations)[number]) => l.mask.map(([x, y]) => [x * atlas.width, y * atlas.height] as Px);
  const mask = toPx(self);
  const box = maskBox(mask);
  const content = contentBox(shapeOf(rip.rgba, rip.img.w, rip.img.h, 16)) ?? [0, 0, rip.img.w, rip.img.h];
  const rect: [number, number, number, number] = [content[0], content[1], content[2] - content[0], content[3] - content[1]];
  const others = atlas.locations.filter((l) => l !== self && l.region === region);
  const controls: Control[] = [];
  for (const o of others) {
    const at = meetingPoint(mask, toPx(o));
    if (!at) continue;
    const d = { west: at[0] - box[0], east: box[2] - at[0], north: at[1] - box[1], south: box[3] - at[1] };
    const side = (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[b] < d[a] ? b : a));
    if (d[side] > 6) continue;
    const ns = side === "north" || side === "south";
    const edge = side === "west" ? rect[0] : side === "east" ? rect[0] + rect[2] : side === "north" ? rect[1] : rect[1] + rect[3];
    controls.push({ kind: "edge", label: `${side}: ${o.name}`, side, edge, from: ns ? rect[0] : rect[1], to: ns ? rect[0] + rect[2] : rect[1] + rect[3], world: at });
  }
  const f = fitLocal(rect, mask, controls, boundedSides(mask, others.map(toPx)));
  return {
    kind: "anchored",
    ok: f.ok,
    reasons: f.reasons,
    toWorld: f.toWorld,
    onArea: (p) => onMask(mask, p),
    lengthPx: Math.max(box[2] - box[0], box[3] - box[1]),
    controls: f.controls,
    checks: { precision: f.precision, recall: f.recall },
  };
}

/** A fit as the report keeps it. */
interface FitRecord {
  kind: Fit["kind"];
  ok: boolean;
  reasons: string[];
  checks: Fit["checks"];
  controls: Fit["controls"];
  town: boolean;
  /** Why the piecewise fit couldn't be used for this rip (a different size from pret's map). */
  ripNote?: string;
}

/** Per family: pret's overworld, which of its maps make each of our places, and the atlas masks. */
function worldContext(atlas: Atlas, family: Family) {
  const p = PRET[family];
  if (!p) return null;
  const world = loadWorld(CACHE, p.game);
  const placeOf = new Map<string, string>();
  const mapsOf = new Map<string, GameMap[]>();
  const places = atlas.locations.filter((l) => p.regions.includes(l.region));
  for (const l of places) {
    const ms = mapsForPlace(world, l.name).filter((m) => m.comp >= 0);
    if (!ms.length || new Set(ms.map((m) => m.comp)).size > 1) continue;
    mapsOf.set(`${l.region}|${l.name}`, ms);
    for (const m of ms) placeOf.set(m.name, `${l.region}|${l.name}`);
  }
  const masks = new Map(places.map((l) => [`${l.region}|${l.name}`, l.mask.map(([x, y]) => [x * atlas.width, y * atlas.height] as Px)]));
  return { world, placeOf, mapsOf, masks, places };
}

/**
 * The piecewise fit of a rip of `place` (`region|name`): the rip must be the
 * place's map in pret (same size in native px, or the box of the place's
 * maps, as Route 21's north and south halves are one rip), so its pixels are
 * game-world pixels from the map's corner.
 */
function piecewiseFit(ctx: NonNullable<ReturnType<typeof worldContext>>, place: string, ripW: number, ripH: number): (LocalFit & { origin: Px }) | { reason: string } | null {
  const ms = ctx.mapsOf.get(place);
  const mask = ctx.masks.get(place);
  if (!ms || !mask) return null;
  const rect = unionRect(ms);
  const same = ms.find((m) => m.w === ripW && m.h === ripH);
  const origin: Px | null = rect[2] === ripW && rect[3] === ripH ? [rect[0], rect[1]] : same && ms.length === 1 ? [same.x, same.y] : null;
  if (!origin)
    return {
      reason: `rip is ${ripW}×${ripH}, the game's map ${ms.map((m) => `${m.w}×${m.h}`).join(" + ")}`,
    };
  const controls: Control[] = [];
  for (const e of placeEdges(ctx.world, ms, (n) => ctx.placeOf.get(n), place)) {
    const at = meetingPoint(mask, ctx.masks.get(e.neighbour) ?? []);
    if (at)
      controls.push({
        kind: "edge",
        label: `${e.side}: ${e.neighbour.split("|")[1]}`,
        side: e.side,
        edge: e.edge,
        from: e.from,
        to: e.to,
        world: at,
      });
  }
  const joined = new Set(controls.map((c) => c.label.split(": ")[1]));
  const doorsTo = ctx.places.filter((l) => `${l.region}|${l.name}` !== place && !joined.has(l.name)).map((l) => ({ key: `${l.region}|${l.name}`, name: l.name }));
  for (const w of placeWarps(ms, doorsTo)) {
    const at = meetingPoint(mask, ctx.masks.get(w.place) ?? []);
    if (at)
      controls.push({
        kind: "point",
        label: `door: ${w.place.split("|")[1]}`,
        game: w.at,
        world: at,
      });
  }
  const region = place.split("|")[0];
  const others = [...ctx.masks].filter(([k]) => k !== place && k.startsWith(`${region}|`)).map(([, m]) => m);
  return {
    ...fitLocal(rect, mask, controls, boundedSides(mask, others)),
    origin,
  };
}

async function run(items: Item[]) {
  const files = readJson<FileInfo>(cachePath("fileinfo.json"), {});
  const atlas = await loadAtlas(ROOT);
  const candidates = ripCandidates(items, files);
  const groups = new Map<string, Item[]>();
  for (const it of items) groups.set(groupKey(it), [...(groups.get(groupKey(it)) ?? []), it]);
  const results: ShotResult[] = [];
  const fits: Record<string, FitRecord> = {};
  const fitCache = new Map<string, Fit | null>();
  const contexts = new Map(FAMILIES.map((f) => [f, worldContext(atlas, f)]));
  const cameras = loadCameras();
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
    const ctx = contexts.get(family);
    const fitOf = (rip: Rip): Fit | null => {
      const fk = `${key}|${rip.key}`;
      if (!fitCache.has(fk)) {
        let fit: Fit | null = null;
        // The game's own layout first; the outline fit where pret has no map for the place (or it fails).
        const pw = ctx ? piecewiseFit(ctx, `${region}|${name}`, rip.img.w, rip.img.h) : null;
        const mask = ctx?.masks.get(`${region}|${name}`);
        if (pw && "toWorld" in pw && mask) {
          const box = maskBox(mask);
          fit = {
            kind: "piecewise",
            ok: pw.ok,
            reasons: pw.reasons,
            toWorld: (x, y) => pw.toWorld(pw.origin[0] + x, pw.origin[1] + y),
            onArea: (p) => onMask(mask, p),
            lengthPx: Math.max(box[2] - box[0], box[3] - box[1]),
            controls: pw.controls,
            checks: { precision: pw.precision, recall: pw.recall },
          };
        }
        // No game layout (the DS games, a rip pret's map doesn't fit): anchored on our map's own neighbours.
        if ((!fit || !fit.ok) && !(pw && "toWorld" in pw)) {
          const an = anchoredFit(atlas, region, name, rip);
          if (an && (!fit || an.ok)) fit = an;
        }
        if ((!fit || !fit.ok) && area) {
          const a = fitArea(atlas, area, shapeOf(rip.rgba, rip.img.w, rip.img.h, 16));
          const affine: Fit = {
            kind: "affine",
            ok: a.ok,
            reasons: a.reasons,
            toWorld: a.toWorld,
            onArea: () => true,
            lengthPx: area.pathBox ? Math.max(area.pathBox[3] - area.pathBox[1], area.pathBox[2] - area.pathBox[0]) : null,
            controls: a.controls.map((c) => ({
              label: `${c.label}${c.detail ? ` (${c.detail})` : ""}`,
              px: c.errPx,
            })),
            checks: Object.fromEntries(Object.entries(a.checks).filter(([, v]) => typeof v === "number")) as Record<string, number>,
          };
          // The piecewise fit's reasons stay on record when the outline fit is used instead.
          if (!fit || affine.ok)
            fit = {
              ...affine,
              reasons: affine.ok ? [] : [...(fit ? fit.reasons.map((r) => `piecewise: ${r}`) : []), ...affine.reasons],
            };
        }
        if (!fit && pw && "reason" in pw) fit = null;
        fitCache.set(fk, fit);
        if (fit)
          fits[fk] = {
            kind: fit.kind,
            ok: fit.ok,
            reasons: fit.reasons,
            checks: fit.checks,
            controls: fit.controls,
            town,
            ...(pw && "reason" in pw ? { ripNote: pw.reason } : {}),
          };
      }
      return fitCache.get(fk)!;
    };
    for (const it of group) {
      const base: ShotResult = {
        id: it.id,
        family,
        game: it.game,
        region,
        name,
        kind: "missing",
      };
      const file = cachePath("shots", `${it.id}.webp`);
      if (!existsSync(file)) {
        results.push({ ...base, why: "shot not fetched" });
        continue;
      }
      const { img } = await loadRgb(file);
      const shot = shrink(img, nativeScale(img, 12));
      if (shot.w * shot.h > MAX_VIEW_SCREENS * sw * sh) {
        results.push({
          ...base,
          kind: "map",
          why: "a map of the place, not a view",
        });
        continue;
      }
      if (!rips.length) {
        results.push({
          ...base,
          kind: "view",
          why: "no map rip for this place",
        });
        continue;
      }
      const sg = gray(shot);
      type Try = { rip: Rip; m: MatchResult; flat?: Px };
      const tries: Try[] = rips.map((rip) => ({
        rip,
        m: matchShot(sg, rip.g),
      }));
      // A DS overworld screenshot (a full-width top screen, not a view cut from a rip) is also matched flattened through its game's camera.
      const cam = cameras.get(family);
      if (cam && !it.cut && shot.w === sw) {
        const flat = flatten(shot, cam);
        for (const rip of rips)
          tries.push({
            rip,
            m: matchShot(flat.g, rip.g, FLAT_GATE),
            flat: flat.origin,
          });
      }
      const spotOf = (t: Try): Px => (t.flat ? [t.m.best.x + t.flat[0], t.m.best.y + t.flat[1]] : centre(t.m));
      const own = it.cut ? tries.find((t) => t.rip.key === fileKey(it.host, it.file) && !t.flat) : undefined;
      const passing = tries.filter((t) => t.m.ok);
      const best = own ?? (passing.length ? passing : tries).reduce((a, b) => (b.m.best.score > a.m.best.score ? b : a));
      const res: ShotResult = {
        ...base,
        kind: "view",
        method: it.cut ? "cut2d" : best.flat ? "flat3d" : "tm2d",
        rip: best.rip.key,
        match: best.m,
        at: spotOf(best),
      };
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
        results.push({
          ...res,
          why: `matcher disagrees with the cut by ${res.errPx}px`,
        });
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
        // Scores compare within one way of matching (flattened or not); across them, only a match that passes its own gate counts.
        if (t === best || (!!t.flat === !!best.flat ? t.m.best.score < best.m.best.score - MATCH.MIN_MARGIN : !t.m.ok)) return false;
        const f = fitOf(t.rip);
        if (!f) return true;
        const w = f.toWorld(...spotOf(t));
        return Math.hypot(w[0] - world[0], w[1] - world[1]) > WORLD_AGREE_PX;
      });
      if (rival) {
        results.push({
          ...res,
          why: `also matches ${rival.rip.key} elsewhere`,
        });
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
      if (fit.lengthPx === null) reasons.push(area?.pathNote ?? "no drawn path");
      else if (ICON.test(name) && (!area || area.pathNote === "no drawn path")) reasons.push("drawn as an icon (no path to aim at)");
      else {
        if (fit.lengthPx < MIN_ROUTE_PX) reasons.push(`area drawn ${Math.round(fit.lengthPx)}px long`);
        const tall = best.rip.img.h >= best.rip.img.w;
        const along = tall ? best.m.h / best.rip.img.h : best.m.w / best.rip.img.w;
        if (along > MAX_FOOTPRINT) reasons.push(`view covers ${Math.round(along * 100)}% of the area`);
      }
      if (fit.ok && !fit.onArea(world)) reasons.push("spot lands off our area");
      res.spot = [nx, ny, confidence, res.method!, reasons.length === 0];
      if (reasons.length) {
        res.why = reasons.join("; ");
        // Only aligned spots are stored; an area that failed the gate keeps area scoring.
        if (!fit.ok || reasons.includes("spot lands off our area")) res.spot = undefined;
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
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const byFamily: Record<
    string,
    {
      n: number;
      accepted: number;
      within: number;
      wrongAccepted: number;
      errs: number[];
    }
  > = {};
  for (const [key, set] of candidates) {
    const family = key.split("|")[2] as Family;
    const [sw, sh] = SCREEN[family];
    for (const k of set) {
      const rip = await loadRip(k);
      if (!rip || rip.img.w < sw * 1.5 || rip.img.h < sh * 1.5) continue;
      const stat = (byFamily[family] ??= {
        n: 0,
        accepted: 0,
        within: 0,
        wrongAccepted: 0,
        errs: [],
      });
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
  else if (step === "world") for (const p of Object.values(PRET)) await fetchPret(CACHE, p.game);
  else if (step === "match") {
    // SPOTS_REUSE_KNOWN=1 keeps the template matcher's known answers from the last run (they depend only on the rips and the matcher).
    const cached = process.env.SPOTS_REUSE_KNOWN ? readJson<{ known?: Awaited<ReturnType<typeof knownAnswers>> }>(cachePath("results.json"), {}).known : undefined;
    const known = cached ?? (await knownAnswers(items));
    const knownFlat3d = await knownFlat(items, loadCameras());
    console.log("known answers (flat3d):", JSON.stringify(knownFlat3d));
    const { results, fits } = await run(items);
    // The known-answer test per method: synthetic windows for tm2d, the real cuts for cut2d, the camera's pairs and synthetic views for flat3d (and no match on another place's rip).
    const cuts = results.filter((r) => r.method === "cut2d" && r.errPx !== undefined && r.match?.ok);
    const tmAll = Object.values(known).reduce(
      (a, b) => ({
        accepted: a.accepted + b.accepted,
        within: a.within + b.within,
      }),
      { accepted: 0, within: 0 }
    );
    const flatAll = Object.values(knownFlat3d).reduce(
      (a, b) => ({
        accepted: a.accepted + b.pairs.accepted + b.synthetic.accepted,
        within: a.within + b.pairs.within + b.synthetic.within,
        wrong: a.wrong + b.wrongRip.accepted,
      }),
      { accepted: 0, within: 0, wrong: 0 }
    );
    const methods = {
      tm2d: {
        known: tmAll.accepted,
        within: tmAll.within,
        pass: tmAll.accepted > 0 && tmAll.within / tmAll.accepted >= KNOWN_PASS,
      },
      cut2d: {
        known: cuts.length,
        within: cuts.filter((r) => r.errPx! <= KNOWN_TOL_PX).length,
        pass: false,
      },
      flat3d: {
        known: flatAll.accepted,
        within: flatAll.within,
        wrongRip: flatAll.wrong,
        pass: flatAll.accepted > 0 && flatAll.within / flatAll.accepted >= KNOWN_PASS && flatAll.wrong === 0,
      },
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
    writeFileSync(
      OUT,
      `{\n${Object.entries(sorted)
        .map(([id, row]) => `  ${JSON.stringify(id)}: ${JSON.stringify(row)}`)
        .join(",\n")}\n}\n`
    );
    writeFileSync(cachePath("results.json"), JSON.stringify({ results, fits, known, knownFlat3d, methods }, null, 1));
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
          Object.entries(known).map(([f, s]) => [
            f,
            {
              n: s.n,
              accepted: s.accepted,
              within: s.within,
              wrong: s.wrongAccepted,
              maxErr: Math.round(Math.max(0, ...s.errs) * 10) / 10,
              wrongErrs: s.errs.filter((e) => e > KNOWN_TOL_PX).map((e) => Math.round(e)),
            },
          ])
        )
      )
    );
    const cutErrs = cuts.map((r) => r.errPx!);
    console.log(`cut2d errors (native px): n ${cutErrs.length}, max ${Math.max(0, ...cutErrs)}, over ${KNOWN_TOL_PX}px: ${cutErrs.filter((e) => e > KNOWN_TOL_PX).length}`);
  } else if (step === "sheets") {
    await sheets(process.argv[3] ?? cachePath("sheets"), process.argv[4]);
  } else if (step === "report") {
    report(process.argv[3] ?? cachePath("report"), process.argv[4], process.argv[5]);
  } else {
    console.log("steps: info | fetch | guess | world | match | sheets <dir> [spots before] | report <dir> <results before> <spots before>");
  }
}

type Saved = {
  results: ShotResult[];
  fits: Record<string, FitRecord & { checks?: Record<string, unknown> }>;
  known?: Record<string, { n: number; accepted: number; within: number; wrongAccepted: number; errs: number[] }>;
  knownFlat3d?: Awaited<ReturnType<typeof knownFlat>>;
  methods?: Record<string, unknown>;
};

/**
 * The run's report, against an earlier run (its results.json and spots file):
 * coverage.txt (per family: shots, views, matched, stored and scored before →
 * after, by method, and why the rest aren't scored), alignment.txt (every
 * area fit with its control points' residuals) and known-answers.txt.
 */
function report(dir: string, resultsBefore?: string, spotsBefore?: string) {
  mkdirSync(dir, { recursive: true });
  const now = readJson<Saved>(cachePath("results.json"), { results: [], fits: {} });
  const was = resultsBefore ? readJson<Saved>(resultsBefore, { results: [], fits: {} }) : null;
  const spots = readJson<Record<string, SpotRow>>(OUT, {});
  const spotsWas = spotsBefore ? readJson<Record<string, SpotRow>>(spotsBefore, {}) : {};
  const pct = (a: number, b: number) => `${a}/${b} (${b ? Math.round((a / b) * 100) : 0}%)`;
  const cov: string[] = ["# Coverage by game family (before → after)", "", "family | shots | views | matched uniquely | stored | scored | scored by method"];
  const totals = { shots: 0, stored: [0, 0], scored: [0, 0] };
  for (const f of FAMILIES) {
    const rs = now.results.filter((r) => r.family === f);
    const ids = rs.map((r) => r.id);
    const stored = [ids.filter((id) => spotsWas[id]).length, ids.filter((id) => spots[id]).length];
    const scored = [ids.filter((id) => spotsWas[id]?.[4]).length, ids.filter((id) => spots[id]?.[4]).length];
    const matchedWas = was?.results.filter((r) => r.family === f && r.match?.ok).length ?? 0;
    const byMethod = new Map<string, number>();
    for (const id of ids) if (spots[id]?.[4]) byMethod.set(spots[id][3], (byMethod.get(spots[id][3]) ?? 0) + 1);
    cov.push(
      `${f} | ${rs.length} | ${rs.filter((r) => r.kind === "view").length} | ${matchedWas} → ${rs.filter((r) => r.match?.ok).length} | ${stored[0]} → ${stored[1]} | ${scored[0]} → ${scored[1]} | ${[...byMethod].map(([m, n]) => `${m} ${n}`).join(", ")}`
    );
    totals.shots += rs.length;
    totals.stored = [totals.stored[0] + stored[0], totals.stored[1] + stored[1]];
    totals.scored = [totals.scored[0] + scored[0], totals.scored[1] + scored[1]];
  }
  cov.push(`all | ${totals.shots} | | | ${totals.stored[0]} → ${totals.stored[1]} | ${totals.scored[0]} → ${totals.scored[1]} |`, "", "Why views aren't scored (first reason, numbers folded):");
  const why = new Map<string, number>();
  for (const r of now.results) {
    if (r.kind !== "view" || spots[r.id]?.[4]) continue;
    const w = (r.why ?? "its method failed the known-answer test").split(";")[0].replace(/\d+(\.\d+)?/g, "N");
    why.set(w, (why.get(w) ?? 0) + 1);
  }
  for (const [w, n] of [...why].sort((a, b) => b[1] - a[1])) cov.push(`${String(n).padStart(7)}  ${w}`);
  cov.push("", "Not views (a map of the whole place, no spot): " + now.results.filter((r) => r.kind === "map").length);
  writeFileSync(path.join(dir, "coverage.txt"), cov.join("\n") + "\n");

  // Alignment: every (place, rip) fit, areas apart from towns.
  const areaFits = (s: Saved | null) => Object.entries(s?.fits ?? {}).filter(([, f]) => !f.town);
  const passed = (s: Saved | null) => areaFits(s).filter(([, f]) => f.ok).length;
  const places = (s: Saved | null) => {
    const by = new Map<string, boolean>();
    for (const [k, f] of areaFits(s)) {
      const p = k.split("|").slice(0, 3).join("|");
      by.set(p, (by.get(p) ?? false) || f.ok);
    }
    return [[...by.values()].filter(Boolean).length, by.size];
  };
  const [pNow, pAll] = places(now);
  const [pWas, pAllWas] = places(was);
  const al: string[] = [
    "# Alignment gate: every (place, map rip) fit",
    "",
    `Area fits (routes, caves, sea…; towns aside): before ${pct(passed(was), areaFits(was).length)} → after ${pct(passed(now), areaFits(now).length)}.`,
    `Areas with at least one passing fit: before ${pct(pWas, pAllWas)} → after ${pct(pNow, pAll)}.`,
    `Piecewise fits (the game's own layout, pret disassemblies): ${pct(areaFits(now).filter(([, f]) => f.kind === "piecewise" && f.ok).length, areaFits(now).filter(([, f]) => f.kind === "piecewise").length)} pass; outline (affine) fits: ${pct(areaFits(now).filter(([, f]) => f.kind === "affine" && f.ok).length, areaFits(now).filter(([, f]) => f.kind === "affine").length)}.`,
    "",
    "Control points: px = how far it lands from our map's with the fit as made (a knot lands on it), loo = with it left out of the fit; a door left out disagreed with the connections.",
    "",
    "pass | kind | family | place | rip | precision / recall | control points (px / loo) | reasons",
  ];
  for (const [k, f] of Object.entries(now.fits).sort(([a], [b]) => a.localeCompare(b))) {
    const [region, name, family, , file] = k.split("|");
    const ctl = f.controls.map((c) => `${c.label} ${c.px}${c.looPx !== undefined ? ` / ${c.looPx}` : ""}`).join("; ");
    const pr = f.checks.precision !== undefined ? `${f.checks.precision} / ${f.checks.recall}` : "";
    al.push(`${f.ok ? "PASS" : "fail"} | ${f.town ? "town" : f.kind} | ${family} | ${region} ${name} | ${file} | ${pr} | ${ctl} | ${f.reasons.join("; ")}${f.ripNote ? ` (piecewise not used: ${f.ripNote})` : ""}`);
  }
  writeFileSync(path.join(dir, "alignment.txt"), al.join("\n") + "\n");

  const ka: string[] = ["# Known-answer test per method", "", "tm2d (template match): synthetic windows cut from every rip (6 per rip) with a 16x24 noise block in the middle (a person).", "family | windows | accepted | within 2 native px | wrong accepted | max error (native px)"];
  for (const [f, s] of Object.entries(now.known ?? {})) ka.push(`${f} | ${s.n} | ${s.accepted} | ${s.within} | ${s.wrongAccepted} | ${Math.round(Math.max(0, ...s.errs) * 10) / 10}`);
  const cuts = now.results.filter((r) => r.method === "cut2d" && r.errPx !== undefined && r.match?.ok);
  ka.push("", `cut2d (a view cut from the rip; the matcher must find the cut): ${cuts.length} known answers, within ${KNOWN_TOL_PX} px: ${cuts.filter((r) => r.errPx! <= KNOWN_TOL_PX).length}, max error ${Math.max(0, ...cuts.map((r) => r.errPx!))} native px`);
  ka.push("", `flat3d (a DS screenshot flattened through its game's camera, then matched; gate: score ≥ ${FLAT_GATE.MIN_SCORE}, margin ≥ ${FLAT_GATE.MIN_MARGIN}, agreement ≥ ${FLAT_GATE.MIN_AGREE}; right = within ${FLAT_TOL_PX} native px):`);
  ka.push("family | camera pairs: shots, accepted, within, errors (native px) | synthetic views: n, accepted, within, max error | wrong rip: tries, accepted");
  for (const [f, s] of Object.entries(now.knownFlat3d ?? {}))
    ka.push(
      `${f} | ${s.pairs.n}, ${s.pairs.accepted}, ${s.pairs.within}, [${s.pairs.errs.join(", ")}] | ${s.synthetic.n}, ${s.synthetic.accepted}, ${s.synthetic.within}, ${Math.max(0, ...s.synthetic.errs)} | ${s.wrongRip.n}, ${s.wrongRip.accepted}`
    );
  const cams = loadCameras();
  ka.push("", "DS cameras (screen px → rip px about the player, fitted from scripts/geo/spot-ds-pairs.json; each shot's median residual in px):");
  for (const [f, c] of cams)
    ka.push(
      `${f}: H = ${JSON.stringify(c.H.map((r) => r.map((v) => Math.round(v * 1e5) / 1e5)))}; used ${c.used.map((u) => `${u.id} ${u.medianPx}`).join(", ")}; dropped ${c.dropped.map((u) => `${u.id} ${u.medianPx}`).join(", ") || "none"}`
    );
  ka.push("bw: no camera (one in-game Black / White screenshot registered to its rip, too few to fit); its shots are matched flat only.");
  ka.push("", `methods: ${JSON.stringify(now.methods)}`);
  writeFileSync(path.join(dir, "known-answers.txt"), ka.join("\n") + "\n");
  console.log(cov.slice(0, 12).join("\n"));
  console.log(al.slice(0, 5).join("\n"));
}

/**
 * Overlay review sheets: per game family, rows of [the shot | where it
 * matched on the rip | the spot on our atlas, with the area's mask], the
 * scored spots first, then the stored unscored ones (towns).
 */
async function sheets(dir: string, beforeFile?: string) {
  mkdirSync(dir, { recursive: true });
  const { results } = readJson<{ results: ShotResult[] }>(cachePath("results.json"), { results: [] });
  const now = readJson<Record<string, SpotRow>>(OUT, {});
  const before = beforeFile ? readJson<Record<string, SpotRow>>(beforeFile, {}) : null;
  const atlas = await loadAtlas(ROOT);
  const W = 300;
  const H = 220;
  const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  for (const family of FAMILIES) {
    const spotted = results.filter((r) => r.family === family && r.spot && r.world);
    // With the spots before: every shot scored now and not before (all of them, ten to a page); without: a sample.
    const pick = before
      ? spotted.filter((r) => now[r.id]?.[4] && !before[r.id]?.[4]).sort((a, b) => a.name.localeCompare(b.name) || hash(a.id) - hash(b.id))
      : [...spotted.filter((r) => r.spot![4]), ...spotted.filter((r) => !r.spot![4])].sort((a, b) => Number(b.spot![4]) - Number(a.spot![4]) || hash(a.id) - hash(b.id)).slice(0, 10);
    for (let page = 0; page * 10 < pick.length; page++) {
      const rows: Buffer[] = [];
      for (const r of pick.slice(page * 10, page * 10 + 10)) {
        const shotPng = await sharp(cachePath("shots", `${r.id}.webp`))
          .resize(W, H, {
            fit: "contain",
            background: "#111",
            kernel: "nearest",
          })
          .png()
          .toBuffer();
        // The rip around the match, the matched window outlined.
        const rip = await loadRip(r.rip!);
        let ripPng = await sharp({
          create: { width: W, height: H, channels: 3, background: "#111" },
        })
          .png()
          .toBuffer();
        if (rip && r.match) {
          const m = r.match;
          const pad = Math.max(m.w, m.h) * 0.6;
          const left = Math.max(0, Math.floor(m.best.x - pad));
          const top = Math.max(0, Math.floor(m.best.y - pad));
          const width = Math.min(rip.img.w - left, Math.ceil(m.w + 2 * pad));
          const height = Math.min(rip.img.h - top, Math.ceil(m.h + 2 * pad));
          const [ax, ay] = r.at ?? [m.best.x + m.w / 2, m.best.y + m.h / 2];
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${m.best.x - left}" y="${m.best.y - top}" width="${m.w}" height="${m.h}" fill="none" stroke="#ff2d55" stroke-width="3"/><circle cx="${ax - left}" cy="${ay - top}" r="5" fill="none" stroke="#ffd60a" stroke-width="2.5"/></svg>`;
          const raw = await sharp(Buffer.from(rip.img.data), {
            raw: { width: rip.img.w, height: rip.img.h, channels: 3 },
          })
            .extract({ left, top, width, height })
            .png()
            .toBuffer();
          ripPng = await sharp(
            await sharp(raw)
              .composite([{ input: Buffer.from(svg) }])
              .png()
              .toBuffer()
          )
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
        svg += `<text x="6" y="${H - 8}" font-family="sans-serif" font-size="13" fill="#fff" stroke="#000" stroke-width="0.6">${esc(`${r.name} · ${r.game} · ${r.method} · ${now[r.id]?.[4] ? "scored" : "unscored"} · ${r.spot![2]} · ${r.id}`)}</text></svg>`;
        const atlasPng = await sharp(atlas.rgb, {
          raw: { width: atlas.width, height: atlas.height, channels: 3 },
        })
          .extract({ left: L, top: T, width: sw, height: shh })
          .resize(W, H, { kernel: "nearest" })
          .composite([{ input: Buffer.from(svg) }])
          .png()
          .toBuffer();
        rows.push(
          await sharp({
            create: {
              width: W * 3 + 8,
              height: H,
              channels: 3,
              background: "#000",
            },
          })
            .composite([
              { input: shotPng, left: 0, top: 0 },
              { input: ripPng, left: W + 4, top: 0 },
              { input: atlasPng, left: 2 * W + 8, top: 0 },
            ])
            .png()
            .toBuffer()
        );
      }
      const sheet = sharp({
        create: {
          width: W * 3 + 8,
          height: rows.length * (H + 4),
          channels: 3,
          background: "#000",
        },
      }).composite(rows.map((input, i) => ({ input, left: 0, top: i * (H + 4) })));
      await sheet.png().toFile(path.join(dir, before ? `review-${family}-${String(page + 1).padStart(2, "0")}.png` : `review-${family}.png`));
    }
    console.log(`${family}: ${pick.length} rows`);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
