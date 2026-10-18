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
import sharp from "sharp";
import {
  ARCHIVES,
  api,
  categoryPages,
  codeOf,
  collectShots,
  download,
  fileUrls,
  firstLocationRef,
  galleryImages,
  geoStorage,
  imageStem,
  infoboxImages,
  isLetsGo,
  leadSection,
  locationPage,
  pageLinks,
  redirectTarget,
  squash,
  withBuildingInfobox,
  type GeoShot,
  type ShotStore,
} from "./geo/bulbapedia";

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
 * Kanto is the region whose Bulbapedia town-map data is complete and consistent: one
 * shared town-map base, a clean highlight per location and screenshots from
 * five games, every pin checked by eye. The other regions are played on the
 * world map instead (see ingest-world.ts).
 */
const REGIONS: RegionConfig[] = [
  { id: "kanto", name: "Kanto", maxSide: 400, games: ["RB", "RBY", "RGBY", "Y", "GSC", "FRLG", "HGSS", "PE", "LGPE"] },
];

/** Screenshots kept per pinned location / per building. */
const MAX_SHOTS = 6;
const MAX_BUILDING_SHOTS = 4;
/** Where to look for buildings, besides the pages each pinned location links to. */
const BUILDING_CATEGORIES = (region: string) => [`Category:${region} locations`, `Category:${region} Gyms`];
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

const storage = geoStorage();
const MAX_MASK_POINTS = 300;

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
      const x = p % width;
      const y = Math.floor(p / width);
      // Some highlight images differ from the plain map in their corners; that's never a place.
      if ((x < 2 || x >= width - 2) && (y < 2 || y >= height - 2)) continue;
      const d =
        Math.abs(img[p * 3] - base[p * 3]) + Math.abs(img[p * 3 + 1] - base[p * 3 + 1]) + Math.abs(img[p * 3 + 2] - base[p * 3 + 2]);
      if (d > 60) points.push([x, y]);
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

/** Infobox shots first, then gallery shots; Let's Go first within each (if `letsGoFirst`). */
function rankShots(region: RegionConfig, infobox: string[], gallery: string[], letsGoFirst: boolean): string[] {
  const usable = (f: string) => region.games.includes(codeOf(f) ?? "") && !DENYLIST.has(f.replace(/ /g, "_"));
  const ordered = [...new Set([...infobox, ...gallery].map((f) => f.replace(/ /g, "_")))].filter(usable);
  if (!letsGoFirst) return ordered;
  return [...ordered.filter(isLetsGo), ...ordered.filter((f) => !isLetsGo(f))];
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
    const name = names[i];
    const page = await locationPage([`${region.name} ${name}`, name, `${name} (${region.name})`], `${name} ${region.name}`);
    const infobox = page ? await infoboxImages(page.wikitext) : [];
    if (!page || !infobox.length) {
      console.log(`  skip ${names[i]}: no screenshots`);
      continue;
    }
    const gallery = await galleryImages(page.title, [page.title, names[i], ...infobox.map(imageStem)]);
    // Infobox order is one per game; extra gallery views fill up to the cap.
    const shots = await collectShots(rankShots(region, infobox, gallery, false), MAX_SHOTS, store, storage);
    if (!shots.length) continue;
    locations.push({ name: page.title, pin: hl.pin, mask: hl.mask, shots });
    console.log(`  ✓ ${page.title} (${shots.length} shots)`);
  }
  return locations;
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
  for (const loc of pinned) for (const t of await pageLinks(loc.name)) candidates.add(t);
  const pinnedNames = new Set(pinned.map((l) => l.name));
  const titles = (await withBuildingInfobox([...candidates].filter((t) => !pinnedNames.has(t)))).sort();
  console.log(`  ${candidates.size} candidate pages, ${titles.length} with a building infobox`);

  // Resolve location references (and their redirects) to pinned locations.
  const byKey = new Map(pinned.map((l) => [squash(l.name), l]));
  const findPinned = (ref: string) => byKey.get(squash(ref)) ?? byKey.get(squash(`${region.name} ${ref}`));

  const out: GeoLocation[] = [];
  for (const title of titles) {
    const page = await leadSection(title);
    if (!page || pinnedNames.has(page.title)) continue;
    const ref = firstLocationRef(page.wikitext);
    let parent = ref ? findPinned(ref) : undefined;
    if (ref && !parent) {
      const to = await redirectTarget(ref);
      parent = to ? findPinned(to) : undefined;
    }
    if (!parent) continue;
    const infobox = await infoboxImages(page.wikitext);
    const gallery = await galleryImages(page.title, [page.title, ...infobox.map(imageStem)]);
    const files = rankShots(region, infobox, gallery, true);
    if (!files.length) continue;
    const shots = await collectShots(files, MAX_BUILDING_SHOTS, store, storage);
    if (!shots.length) continue;
    out.push({ name: page.title, parent: parent.name, pin: parent.pin, mask: parent.mask, shots });
    console.log(`  ✓ ${page.title} → ${parent.name} (${shots.length} shots)`);
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
  existing.storageBase = storage.baseUrl;
  await storage.ensureBucket();
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
    await storage.remove((old?.locations ?? []).flatMap((l) => l.shots.map((s) => s.id)).filter((id) => !kept.has(id)));
    existing.regions = [...existing.regions.filter((r) => r.id !== region.id), built];
    existing.regions.sort((a, b) => REGIONS.findIndex((r) => r.id === a.id) - REGIONS.findIndex((r) => r.id === b.id));
    writeFileSync(OUT_DATA, JSON.stringify(existing));
    const buildings = built.locations.filter((l) => l.parent).length;
    console.log(`  → ${built.locations.length - buildings} pinned locations + ${buildings} buildings and landmarks`);
  }
}

void main();
