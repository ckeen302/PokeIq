/**
 * Builds World PokéGuessr: every region on one world map.
 *
 * scripts/geo/world-places.json holds every place on the world atlas: its
 * name, region and area in world-map pixels, traced from each game's own town
 * map. For each place this finds its Bulbapedia page and uploads its in-game
 * screenshots, the same way ingest-geo.ts does for Kanto; buildings and
 * landmarks inside a place get their own rounds and share its area. Uploads
 * are cached, so Kanto's screenshots are reused rather than uploaded again.
 *
 * Writes the `world` section of src/data/geo.json, and the world map plus one
 * crop per region to public/geo/maps.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:world               # every region
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:world -- Hoenn Kalos # selected regions
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  GAME_CODES,
  WIKI,
  api,
  archiveFiles,
  categoryPages,
  codeOf,
  collectShots,
  fileInfo,
  type ShotFallback,
  firstLocationRef,
  galleryImages,
  geoStorage,
  imageStem,
  infoboxImages,
  leadSection,
  pageLinks,
  redirectTarget,
  squash,
  withBuildingInfobox,
  type GeoShot,
  type ShotStore,
} from "./geo/bulbapedia";

const PLACES = path.join(process.cwd(), "scripts/geo/world-places.json");
const WORLD_MAP = path.join(process.cwd(), "public/geo/maps/world.webp");
const OUT_DATA = path.join(process.cwd(), "src/data/geo.json");
const SHOT_CACHE = path.join(process.cwd(), ".data", "geo-shot-cache.json");

const MAX_SHOTS = 6;
const MAX_BUILDING_SHOTS = 4;
/** Area points kept per place (scoring measures the distance to the nearest). */
const MAX_MASK_POINTS = 60;
/** Space around each region's crop, as a share of its size. */
const CROP_MARGIN = 0.04;

interface Source {
  /** Atlas region names whose places come from this source. */
  regions: string[];
  /** The region's name on Bulbapedia (page titles, categories, infobox `region`). */
  wiki: string;
  /** File-name game codes set in this region; screenshots from other games are dropped. */
  games: string[];
  /** Files without a game code are kept when they're a console's native screen size, which says which game they're from. */
  screens?: Record<string, string>;
}

const SOURCES: Source[] = [
  { regions: ["Kanto"], wiki: "Kanto", games: ["RB", "RBY", "RGBY", "Y", "GSC", "FRLG", "HGSS", "PE", "LGPE"], screens: { "240x160": "FRLG", "256x192": "HGSS" } },
  { regions: ["Johto"], wiki: "Johto", games: ["GS", "GSC", "C", "HGSS"], screens: { "160x144": "GSC", "256x192": "HGSS" } },
  { regions: ["Hoenn"], wiki: "Hoenn", games: ["RS", "RSE", "E", "ORAS"], screens: { "240x160": "RSE", "400x240": "ORAS" } },
  { regions: ["Sinnoh"], wiki: "Sinnoh", games: ["DP", "Pt", "DPPt", "BDSP"], screens: { "256x192": "DPPt" } },
  { regions: ["Unova"], wiki: "Unova", games: ["BW", "B", "W", "B2W2", "B2", "W2", "BWB2W2"], screens: { "256x192": "BWB2W2" } },
  // Legends: Z-A is set in Lumiose City; X/Y's own location images are mostly guidebook maps.
  { regions: ["Kalos"], wiki: "Kalos", games: ["XY", "ZA"], screens: { "400x240": "XY" } },
  { regions: ["Alola"], wiki: "Alola", games: ["SM", "USUM", "SMUSUM"], screens: { "400x240": "SMUSUM" } },
  { regions: ["Galar", "Isle of Armor", "Crown Tundra"], wiki: "Galar", games: ["SwSh"] },
  { regions: ["Paldea"], wiki: "Paldea", games: ["SV"] },
  { regions: ["Kitakami"], wiki: "Kitakami", games: ["SV"] },
  { regions: ["Blueberry Academy"], wiki: "Unova", games: ["SV"] },
  { regions: ["Sevii Islands"], wiki: "Sevii Islands", games: ["FRLG"] },
];

/** Region maps cut from the world map, and the atlas regions each one plays. Kanto keeps its own town map. */
const CROPS: Record<string, { name: string; regions: string[] }> = {
  johto: { name: "Johto", regions: ["Johto"] },
  hoenn: { name: "Hoenn", regions: ["Hoenn"] },
  sinnoh: { name: "Sinnoh", regions: ["Sinnoh"] },
  unova: { name: "Unova", regions: ["Unova"] },
  kalos: { name: "Kalos", regions: ["Kalos"] },
  alola: { name: "Alola", regions: ["Alola"] },
  galar: { name: "Galar", regions: ["Galar", "Isle of Armor", "Crown Tundra"] },
  paldea: { name: "Paldea", regions: ["Paldea"] },
};

/** Map labels that aren't page titles. */
const TITLES: Record<string, string> = {
  "Kanto|Safari Zone / Pal Park": "Pal Park",
  "Alola|Lake of the Sunne / Moone": "Lake of the Sunne",
  "Alola|Altar of the Sunne / Moone": "Altar of the Sunne",
  "Unova|Black City / White Forest": "Black City",
  "Unova|Victory Road (BW)": "Victory Road (Unova)",
  "Unova|Victory Road (B2W2)": "Victory Road (Unova)",
  "Paldea|Naranja and Uva Academy": "Naranja Academy",
  "Hoenn|Battle Frontier": "Battle Frontier (Generation III)",
};
/** Places that share a page with another version of themselves: keep only their own game's screenshots. */
const ONLY_GAMES: Record<string, string[]> = {
  "Unova|Victory Road (BW)": ["BW", "B", "W"],
  "Unova|Victory Road (B2W2)": ["B2W2", "B2", "W2"],
};
/** Archive file-name prefixes for places whose files aren't named after their map label. */
const ARCHIVE_PREFIXES: Record<string, string[]> = {
  "Unova|Victory Road (BW)": ["Victory_Road_"],
  "Unova|Victory Road (B2W2)": ["Victory_Road_"],
  "Unova|Black City / White Forest": ["Black_City_", "White_Forest_"],
};

/**
 * Files that look like screenshots by name but give the answer away or don't
 * show the place (found by reviewing contact sheets of the imported shots).
 */
const DENYLIST = new Set<string>([
  "Celadon_Game_Corner_7_GSC.png",
  "Celadon_Game_Corner_7_Y.png",
  "Route_22_Rival_battle_RBY.png",
  "Vermilion_City_port_HGSS.png",
  "Cerulean_City_Slowbro_SonicBoom_FRLG.png",
  // X/Y Gyms, shown with the Gym's name across the bottom.
  "Anistar_Gym_XY.png",
  "Coumarine_Gym_XY.png",
  "Cyllage_Gym_XY.png",
  "Laverre_Gym_XY.png",
  "Shalour_Gym_XY.png",
  "Snowbelle_Gym_XY.png",
  "Friend_Safari_inside_XY.png",
  // A tournament broadcast, with the players' names on screen.
  "Mesagoza_Championships_SV.png",
  // Dialogue naming the place.
  "Southern_Island_ORAS.png",
  // Key art, not a view.
  "Amity_Square_BDSP.png",
  // Close-ups of museum exhibits.
  "Lumiose_Museum_Survey_Corps_Satchel_ZA.png",
  "Lumiose_Museum_Crafting_Bench_ZA.png",
  "Lumiose_Museum_Hairstyles_ZA.png",
  "Lumiose_Museum_Venerated_Portraits_ZA.png",
  // Guidebook maps that happen to be screen-shaped.
  "Postwick_SwSh.png",
  "Rose_Tower_SwSh.png",
]);

/** Screenshots taken as the game's place-name banner pops up: the bottom of the frame is cut off. */
const TRIM_BOTTOM: Record<string, number> = Object.fromEntries(
  ["Canalave", "Eterna", "Hearthome", "Jubilife", "Oreburgh", "Pastoria", "Snowpoint", "Sunyshore", "Veilstone"].map((city) => [`${city}_City_BDSP.png`, 0.21])
);

interface PlaceIn {
  name: string;
  region: string;
  kind: string;
  x: number;
  y: number;
  mask: [number, number][];
}
interface WorldPlaces {
  W: number;
  H: number;
  squarePx: number;
  crops: Record<string, [number, number, number, number]>;
  places: PlaceIn[];
  /** Town and city squares drawn on the map: centre x, y, width, height (world px), 1 for a city. */
  markers: [number, number, number, number, 0 | 1][];
}

export interface WorldLocation {
  name: string;
  /** Atlas region the place is in (Isle of Armor, Kitakami, …). */
  region: string;
  /** Buildings and landmarks: the place they sit in (they share its area). */
  parent?: string;
  pin?: [number, number];
  mask?: [number, number][];
  shots: GeoShot[];
}

const storage = geoStorage();
const norm = (v: number, size: number) => Math.round((v / size) * 100000) / 100000;

/** Words in file names that mean "not a view of the place". */
const NOT_A_VIEW =
  /(^|_)(map|icon|concept|art|artwork|anime|tcg|manga|adventures|sign|battle|battlefield|environment|referee|layout|sprite|dialogue|menu|logo|pre-release|prerelease|trailer|exhibit|painting)(_|\.|$)/i;

/**
 * 3D games' screenshots are screen-shaped: 5:3 on the 3DS (400 × 240), 16:9
 * on the Switch, or the 2:1 crops some pages use, and no bigger than a 1080p
 * capture. Their guidebook maps, scans and renders aren't.
 */
const THREE_DS = new Set(["XY", "ORAS", "SM", "USUM", "SMUSUM"]);
const SWITCH = new Set(["PE", "LGPE", "SwSh", "BDSP", "SV", "ZA"]);
function screenShaped(code: string, width: number, height: number): boolean {
  const ratio = width / height;
  if (Math.max(width, height) > 1920) return false;
  if (THREE_DS.has(code)) return Math.abs(ratio - 5 / 3) < 0.02;
  return Math.abs(ratio - 16 / 9) < 0.06 || (ratio >= 1.95 && ratio <= 2.15);
}

function usable(file: string, games: string[], codeless: boolean): boolean {
  const f = file.replace(/ /g, "_");
  if (DENYLIST.has(f) || NOT_A_VIEW.test(f)) return false;
  const code = codeOf(f);
  // Single-game regions (X/Y, Sword/Shield, Scarlet/Violet…) often leave the game off the file name.
  return code ? games.includes(code) : codeless;
}

/** The game for files without a code: the region's only game, or the game its screen size belongs to. */
function fallbackFor(source: Source, games: string[]): ShotFallback | undefined {
  if (games.length === 1) return GAME_CODES[games[0]];
  const screens = source.screens;
  if (!screens) return undefined;
  return (width, height) => {
    const code = screens[`${width}x${height}`];
    return code && games.includes(code) ? GAME_CODES[code] : undefined;
  };
}

/**
 * Infobox shots first (one per game), then archive files named after the
 * place, then gallery shots; 3D games' files only when they're screen-shaped.
 */
async function rankShots(lists: string[][], games: string[], source: Source): Promise<string[]> {
  const codeless = games.length === 1 || !!source.screens;
  const files = [...new Set(lists.flat().map((f) => f.replace(/ /g, "_")))].filter((f) => usable(f, games, codeless));
  const info = await fileInfo(files);
  return files.filter((f) => {
    const size = info.get(f);
    const code = codeOf(f) ?? (games.length === 1 ? games[0] : undefined);
    return size && (!code || !(THREE_DS.has(code) || SWITCH.has(code)) || screenShaped(code, size.width, size.height));
  });
}

/** Archive screenshots named "<Place>_<GAME>.png" (or "<Region>_Route_N_<GAME>.png"), for places whose page has few. */
async function archiveShots(place: PlaceIn, source: Source): Promise<string[]> {
  const name = (TITLES[`${place.region}|${place.name}`] ?? place.name).replace(/ /g, "_");
  const prefixes =
    ARCHIVE_PREFIXES[`${place.region}|${place.name}`] ??
    (/^Route_\d+$/.test(name) ? [`${source.wiki.replace(/ /g, "_")}_${name}_`] : [`${name}_`]);
  const out: string[] = [];
  for (const prefix of prefixes) {
    for (const f of await archiveFiles(prefix)) {
      // The rest of the name is a game code, optionally after a season / view word or two.
      const rest = f.name.slice(prefix.length).replace(/\.(png|jpe?g)$/i, "").split("_");
      if (rest.length <= 3 && GAME_CODES[rest.at(-1) ?? ""] && Math.max(f.width, f.height) >= 200) out.push(f.name);
    }
  }
  return out;
}

/** The infobox `region` field allows this source (absent counts as yes). */
function inRegion(wikitext: string, source: Source): boolean {
  const field = wikitext.match(/^\|\s*region\s*=\s*(.*)$/m)?.[1];
  if (!field) return true;
  return [source.wiki, ...source.regions].some((r) => field.includes(r));
}

/** A place's page: candidate titles in order, then search; the first whose infobox is in the right region. */
async function placePage(place: PlaceIn, source: Source): Promise<{ title: string; wikitext: string } | null> {
  const name = TITLES[`${place.region}|${place.name}`] ?? place.name;
  const candidates = [`${source.wiki} ${name}`, `${name} (${source.wiki})`, name];
  const r = await api<{ query: { pages: { title: string; missing?: boolean }[]; redirects?: { from: string; to: string }[] } }>(WIKI, {
    action: "query",
    titles: candidates.join("|"),
    redirects: "1",
  });
  const resolved = new Map((r.query.redirects ?? []).map((x) => [x.from, x.to]));
  const titles = [...new Set(candidates.map((c) => resolved.get(c) ?? c).filter((c) => r.query.pages.some((p) => p.title === c && !p.missing)))];
  if (!titles.length) {
    const found = await api<{ query: { search: { title: string }[] } }>(WIKI, {
      action: "query",
      list: "search",
      srsearch: `${name} ${source.wiki}`,
      srlimit: "3",
    });
    titles.push(...found.query.search.map((s) => s.title));
  }
  for (const title of titles) {
    const page = await leadSection(title);
    if (page && inRegion(page.wikitext, source)) return page;
  }
  return null;
}

async function ingestSource(source: Source, world: WorldPlaces, store: ShotStore): Promise<WorldLocation[]> {
  const places = world.places.filter((p) => source.regions.includes(p.region));
  console.log(`\n== ${source.regions.join(" + ")} (${places.length} places)`);
  const out: WorldLocation[] = [];
  /** Page title → the place it is, for matching buildings to their parent. */
  const byTitle = new Map<string, PlaceIn>();
  const pageTitles: string[] = [];
  for (const place of places) {
    const games = ONLY_GAMES[`${place.region}|${place.name}`] ?? source.games;
    const page = await placePage(place, source);
    const infobox = page ? await infoboxImages(page.wikitext) : [];
    const archive = await archiveShots(place, source);
    const gallery = page ? await galleryImages(page.title, [page.title, place.name, ...infobox.map(imageStem)]) : [];
    const shots = await collectShots(await rankShots([infobox, archive, gallery], games, source), MAX_SHOTS, store, storage, {
      fallback: fallbackFor(source, games),
      trimBottom: TRIM_BOTTOM,
    });
    if (page) {
      byTitle.set(squash(page.title), place);
      pageTitles.push(page.title);
    }
    const step = Math.max(1, Math.ceil(place.mask.length / MAX_MASK_POINTS));
    out.push({
      name: place.name,
      region: place.region,
      // Stored normalised to the world map.
      pin: [norm(place.x, world.W), norm(place.y, world.H)],
      mask: place.mask.filter((_, i) => i % step === 0).map(([x, y]) => [norm(x, world.W), norm(y, world.H)]),
      shots,
    });
    console.log(`  ${shots.length ? "✓" : "·"} ${place.name}${page && squash(page.title) !== squash(place.name) ? ` [${page.title}]` : ""} (${shots.length} shots)`);
  }

  // Buildings, Gyms and landmarks whose infobox places them in one of these places.
  const candidates = new Set<string>();
  for (const cat of [`Category:${source.wiki} locations`, `Category:${source.wiki} Gyms`]) for (const t of await categoryPages(cat)) candidates.add(t);
  for (const title of pageTitles) for (const t of await pageLinks(title)) candidates.add(t);
  const taken = new Set([...byTitle.keys()]);
  const titles = (await withBuildingInfobox([...candidates].filter((t) => !taken.has(squash(t))))).sort();
  const find = (ref: string) => byTitle.get(squash(ref)) ?? byTitle.get(squash(`${source.wiki} ${ref}`));
  for (const title of titles) {
    const page = await leadSection(title);
    if (!page || taken.has(squash(page.title)) || !inRegion(page.wikitext, source)) continue;
    const ref = firstLocationRef(page.wikitext);
    let parent = ref ? find(ref) : undefined;
    if (ref && !parent) {
      const to = await redirectTarget(ref);
      parent = to ? find(to) : undefined;
    }
    if (!parent) continue;
    const infobox = await infoboxImages(page.wikitext);
    const gallery = await galleryImages(page.title, [page.title, ...infobox.map(imageStem)]);
    const shots = await collectShots(
      await rankShots([infobox, gallery], source.games, source),
      MAX_BUILDING_SHOTS,
      store,
      storage,
      { fallback: fallbackFor(source, source.games), trimBottom: TRIM_BOTTOM }
    );
    if (!shots.length) continue;
    taken.add(squash(page.title));
    out.push({ name: page.title, region: parent.region, parent: parent.name, shots });
    console.log(`  ✓ ${page.title} → ${parent.name} (${shots.length} shots)`);
  }
  return out;
}

/** The world map, and one crop per region (with a margin), as static images. */
async function writeMaps(world: WorldPlaces) {
  const crops: Record<string, { name: string; regions: string[]; box: [number, number, number, number]; src: string }> = {};
  for (const [id, info] of Object.entries(CROPS)) {
    const [x0, y0, x1, y1] = world.crops[id];
    const m = Math.round(Math.max(x1 - x0, y1 - y0) * CROP_MARGIN);
    const box: [number, number, number, number] = [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(world.W, x1 + m), Math.min(world.H, y1 + m)];
    await sharp(WORLD_MAP)
      .extract({ left: box[0], top: box[1], width: box[2] - box[0], height: box[3] - box[1] })
      .webp({ quality: 88, effort: 5 })
      .toFile(path.join(path.dirname(WORLD_MAP), `${id}.webp`));
    crops[id] = { ...info, box, src: `/geo/maps/${id}.webp` };
  }
  return crops;
}

async function main() {
  const wanted = process.argv.slice(2).map((s) => s.toLowerCase());
  const world: WorldPlaces = JSON.parse(readFileSync(PLACES, "utf8"));
  const data = JSON.parse(readFileSync(OUT_DATA, "utf8"));
  await storage.ensureBucket();
  const old: WorldLocation[] = data.world?.locations ?? [];
  const store: ShotStore = {
    cache: existsSync(SHOT_CACHE) ? JSON.parse(readFileSync(SHOT_CACHE, "utf8")) : {},
    live: new Set(
      [...data.regions.flatMap((r: { locations: { shots: GeoShot[] }[] }) => r.locations), ...old].flatMap((l: { shots: GeoShot[] }) =>
        l.shots.map((s) => s.id)
      )
    ),
  };

  let locations = old;
  for (const source of SOURCES) {
    if (wanted.length && !source.regions.some((r) => wanted.includes(r.toLowerCase()))) continue;
    const built = await ingestSource(source, world, store);
    locations = [...locations.filter((l) => !source.regions.includes(l.region)), ...built];
    mkdirSync(path.dirname(SHOT_CACHE), { recursive: true });
    writeFileSync(SHOT_CACHE, JSON.stringify(store.cache));
    const shots = built.reduce((s, l) => s + l.shots.length, 0);
    console.log(`  → ${built.filter((l) => !l.parent).length} places, ${built.filter((l) => l.parent).length} buildings, ${shots} screenshots`);
  }

  const crops = await writeMaps(world);
  data.storageBase = storage.baseUrl;
  data.world = {
    map: { src: "/geo/maps/world.webp", width: world.W, height: world.H, squarePx: world.squarePx },
    crops,
    markers: world.markers,
    locations,
  };
  writeFileSync(OUT_DATA, JSON.stringify(data));
  // Screenshots the world data no longer uses (and no region uses) are deleted.
  const kept = new Set([...data.regions.flatMap((r: { locations: { shots: GeoShot[] }[] }) => r.locations), ...data.world.locations].flatMap((l: { shots: GeoShot[] }) => l.shots.map((s) => s.id)));
  await storage.remove(old.flatMap((l) => l.shots.map((s) => s.id)).filter((id) => !kept.has(id)));
}

void main();
