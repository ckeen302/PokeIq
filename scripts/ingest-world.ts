/**
 * Builds World PokéGuessr: every region on one world map.
 *
 * scripts/geo/world-places.json holds every place on the world atlas: its
 * name, region and area in world-map pixels, traced from each game's own town
 * map. For each place this finds its Bulbapedia page and uploads its in-game
 * screenshots (re-encoded under random ids, so URLs reveal nothing); buildings
 * and landmarks inside a place get their own rounds and share its area.
 * Uploads are cached by file name, so a re-run only uploads what's new.
 *
 * Writes the `world` section of src/data/geo.json, and the world map plus one
 * crop per region to public/geo/maps.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:world               # every region
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:world -- Hoenn Kalos # selected regions
 *   … npm run ingest:world -- --fandom-only Alola   # only top up existing places from Fandom
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
  words,
  withBuildingInfobox,
  type GeoShot,
  type ShotStore,
} from "./geo/bulbapedia";
import { fandomImages, fandomPage } from "./geo/fandom";

const PLACES = path.join(process.cwd(), "scripts/geo/world-places.json");
const WORLD_MAP = path.join(process.cwd(), "public/geo/maps/world.webp");
const OUT_DATA = path.join(process.cwd(), "src/data/geo.json");
const SHOT_CACHE = path.join(process.cwd(), ".data", "geo-shot-cache.json");

const MAX_SHOTS = 6;
/** 3D screenshots a place gets from Fandom, counting the ones Bulbapedia already gave it. */
const FANDOM_SHOTS = 3;
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

/** Region maps cut from the world map, and the atlas regions each one plays. */
const CROPS: Record<string, { name: string; regions: string[] }> = {
  kanto: { name: "Kanto", regions: ["Kanto"] },
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

/** Screenshots with the place's name along the bottom (BDSP's banner, X/Y's Gym caption bar): it's cut off. */
const TRIM_BOTTOM: Record<string, number> = Object.fromEntries([
  ...["Canalave", "Eterna", "Hearthome", "Jubilife", "Oreburgh", "Pastoria", "Snowpoint", "Sunyshore", "Veilstone"].map((city) => [`${city}_City_BDSP.png`, 0.21]),
  ...["Anistar", "Coumarine", "Cyllage", "Laverre", "Shalour", "Snowbelle"].map((city) => [`${city}_Gym_XY.png`, 0.2]),
]);

/** In-game backdrops named after places: Ultra Sun / Ultra Moon's Alola Photo Club ("APC bg Iki Town"). */
const BACKDROPS: Record<string, { prefix: string; code: string }> = {
  Alola: { prefix: "APC_bg_", code: "USUM" },
};

/** Fandom shots that name the place (a banner, a caption, a text box) or aren't a view. */
const FANDOM_DENYLIST = new Set<string>([
  "Petalburg_City.png",
  "Glittering_Cave.png",
  "Snowbelle_City.png",
  "Ruins_of_Abundance.png",
  "Paniola_Ranch.png",
  "Poké_Pelago5.png",
  "Galar_Route_5.png",
]);

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
/** How many regions have a place of each name ("Victory Road" is in five). */
const PLACE_COUNTS = new Map<string, number>();
const PLACES_BY_REGION = new Map<string, PlaceIn[]>();
const norm = (v: number, size: number) => Math.round((v / size) * 100000) / 100000;

/** Words in file names that mean "not a view of the place". */
const NOT_A_VIEW =
  /(^|_)(map\d*|icon|concept|art|artwork|anime|tcg|manga|adventures|sign|battle|battlefield|environment|referee|layout|sprite|dialogue|menu|logo|pre-release|prerelease|trailer|exhibit|painting|evolutions|generations|origins|hz|pg|dsd)(_|\.|$)/i;

/**
 * 3D games' screenshots are screen-shaped: 5:3 on the 3DS (400 × 240), 16:9
 * on the Switch, or the 2:1 crops some pages use, and no bigger than a 1080p
 * capture. Their guidebook maps, scans and renders aren't.
 */
const THREE_DS = new Set(["XY", "ORAS", "SM", "USUM", "SMUSUM"]);
const SWITCH = new Set(["PE", "LGPE", "SwSh", "BDSP", "SV", "ZA"]);
const THREE_D_GAMES = new Set([...THREE_DS, ...SWITCH].map((c) => GAME_CODES[c]));
const count3d = (shots: GeoShot[]) => shots.filter((s) => THREE_D_GAMES.has(s.game)).length;
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
  // X/Y's Photo Spots: a view of the place from where the photographer stands.
  const photoSpot = `Photo_Spot_${name}`;
  const codeless = source.games.length === 1 || !!source.screens;
  const out: string[] = [];
  for (const prefix of [...prefixes, photoSpot]) {
    for (const f of await archiveFiles(prefix)) {
      if (Math.max(f.width, f.height) < 200) continue;
      // The rest of the name is a game code, optionally after a season / view word or two;
      // regions that allow code-less files (sized up later) take a word or two without one.
      const rest = f.name.slice(prefix.length).replace(/\.(png|jpe?g)$/i, "").split("_").filter(Boolean);
      if (rest.length <= 3 && GAME_CODES[rest.at(-1) ?? ""]) out.push(f.name);
      else if (codeless && rest.length <= 2 && (prefix === photoSpot || rest.length > 0)) out.push(f.name);
    }
  }
  return out;
}

/** A file's name as words, without its extension or a trailing variant letter ("Aether ParadiseA", "route1b"). */
const fileWords = (file: string) => words(file.replace(/\.[a-z0-9]+$/i, "").replace(/(?<=[a-z\d])[A-D]$|(?<=\d)[a-d]$/, ""));
/** A place's name as words, without "Town", "City" or "Village". */
const placeWords = (place: PlaceIn) => words((TITLES[`${place.region}|${place.name}`] ?? place.name).replace(/\s+(Town|City|Village)$/i, ""));

/** Some run of the file's words spells the place's name ("Route14" and "Kalos_Route_4" spell Route 4; "Route_40" doesn't). */
function spells(file: string[], place: string[]): boolean {
  const target = place.join("");
  for (let i = 0; i < file.length; i++) {
    let run = "";
    for (let j = i; j < file.length && run.length < target.length; j++) {
      run += file[j];
      if (run === target) return true;
    }
  }
  return false;
}

/**
 * A file named after the place, not one that just sits on its page. When it
 * spells several of the region's places, it belongs to the longest name
 * ("Hau'oli Cemetery", not "Hau'oli City").
 */
function namesPlace(file: string, place: PlaceIn): boolean {
  const f = fileWords(file);
  let owner: PlaceIn | null = null;
  let longest = 0;
  for (const p of PLACES_BY_REGION.get(place.region) ?? [place]) {
    const w = placeWords(p);
    const n = w.join("").length;
    if (n > longest && spells(f, w)) [owner, longest] = [p, n];
  }
  return owner === place;
}

const backdropFiles = new Map<string, Promise<{ name: string; width: number; height: number }[]>>();
/** The region's in-game backdrops of the place, if it has any. */
async function backdropShots(place: PlaceIn, store: ShotStore, max: number): Promise<GeoShot[]> {
  const backdrop = BACKDROPS[place.region];
  if (!backdrop || max <= 0) return [];
  if (!backdropFiles.has(backdrop.prefix)) backdropFiles.set(backdrop.prefix, archiveFiles(backdrop.prefix));
  const files = (await backdropFiles.get(backdrop.prefix)!).filter((f) => f.width === 400 && f.height === 240 && namesPlace(f.name, place));
  return collectShots(
    files.map((f) => f.name),
    max,
    store,
    storage,
    { fallback: GAME_CODES[backdrop.code] }
  );
}

/**
 * The place's page on the Pokémon Wiki (Fandom): screen-shaped in-game shots of
 * the 3D games, named after the place. Bulbapedia has guidebook maps for most
 * X/Y, Sun/Moon and Sword/Shield routes; Fandom has the views.
 */
async function fandomShots(place: PlaceIn, source: Source, games: string[], store: ShotStore, max: number): Promise<GeoShot[]> {
  if (max <= 0 || !games.some((g) => THREE_DS.has(g) || SWITCH.has(g))) return [];
  const name = TITLES[`${place.region}|${place.name}`] ?? place.name;
  const unique = PLACE_COUNTS.get(place.name) === 1;
  const title = await fandomPage([`${name} (${source.wiki})`, `${source.wiki} ${name}`, ...(unique ? [name] : [])]);
  if (!title) return [];
  // Fandom's 3DS shots are often a little cropped or scaled: 5:3-ish and small (guidebook scans are big).
  const ds = source.screens?.["400x240"];
  const codeFor = (width: number, height: number) =>
    games.length === 1 ? games[0] : ds && width / height >= 1.6 && width / height <= 1.8 && width <= 800 ? ds : undefined;
  const files = (await fandomImages(title)).filter((f) => {
    if (FANDOM_DENYLIST.has(f.file) || !usable(f.file, games, true) || !namesPlace(f.file, place) || Math.min(f.width, f.height) < 200) return false;
    const named = codeOf(f.file);
    const code = named ?? codeFor(f.width, f.height);
    if (!code || !(THREE_DS.has(code) || SWITCH.has(code))) return false;
    return named || SWITCH.has(code) ? screenShaped(code, f.width, f.height) : f.width / f.height >= 1.6 && f.width / f.height <= 1.8 && f.width <= 800;
  });
  const fallback = (width: number, height: number) => {
    const code = codeFor(width, height);
    return code ? GAME_CODES[code] : undefined;
  };
  return collectShots(
    files.map((f) => f.file),
    max,
    store,
    storage,
    { fallback, urls: new Map(files.map((f) => [f.file, f.url])), keyPrefix: "fandom:" }
  );
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
    shots.push(...(await fandomShots(place, source, games, store, FANDOM_SHOTS - count3d(shots))));
    shots.push(...(await backdropShots(place, store, FANDOM_SHOTS - count3d(shots))));
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

/** Tops up a region's existing places from Fandom and backdrops, without asking Bulbapedia again. */
async function topUp(source: Source, world: WorldPlaces, store: ShotStore, old: WorldLocation[]): Promise<WorldLocation[]> {
  console.log(`\n== ${source.regions.join(" + ")}: Fandom`);
  const out = old.filter((l) => source.regions.includes(l.region)).map((l) => ({ ...l, shots: [...l.shots] }));
  for (const place of world.places.filter((p) => source.regions.includes(p.region))) {
    const location = out.find((l) => !l.parent && l.region === place.region && l.name === place.name);
    if (!location) continue;
    const games = ONLY_GAMES[`${place.region}|${place.name}`] ?? source.games;
    const fandom = await fandomShots(place, source, games, store, FANDOM_SHOTS - count3d(location.shots));
    const backdrops = await backdropShots(place, store, FANDOM_SHOTS - count3d([...location.shots, ...fandom]));
    const added = [...fandom, ...backdrops].filter((s) => !location.shots.some((t) => t.id === s.id));
    location.shots.push(...added);
    if (added.length) console.log(`  + ${place.name} (${added.length})`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const fandomOnly = args.includes("--fandom-only");
  const wanted = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
  const world: WorldPlaces = JSON.parse(readFileSync(PLACES, "utf8"));
  for (const name of new Set(world.places.map((p) => p.name))) {
    PLACE_COUNTS.set(name, new Set(world.places.filter((p) => p.name === name).map((p) => p.region)).size);
  }
  for (const place of world.places) PLACES_BY_REGION.set(place.region, [...(PLACES_BY_REGION.get(place.region) ?? []), place]);
  const data = JSON.parse(readFileSync(OUT_DATA, "utf8"));
  await storage.ensureBucket();
  const old: WorldLocation[] = data.world?.locations ?? [];
  const store: ShotStore = {
    cache: existsSync(SHOT_CACHE) ? JSON.parse(readFileSync(SHOT_CACHE, "utf8")) : {},
    live: new Set(old.flatMap((l) => l.shots.map((s) => s.id))),
  };

  let locations = old;
  for (const source of SOURCES) {
    if (wanted.length && !source.regions.some((r) => wanted.includes(r.toLowerCase()))) continue;
    const built = fandomOnly ? await topUp(source, world, store, old) : await ingestSource(source, world, store);
    locations = [...locations.filter((l) => !source.regions.includes(l.region)), ...built];
    mkdirSync(path.dirname(SHOT_CACHE), { recursive: true });
    writeFileSync(SHOT_CACHE, JSON.stringify(store.cache));
    const shots = built.reduce((s, l) => s + l.shots.length, 0);
    console.log(`  → ${built.filter((l) => !l.parent).length} places, ${built.filter((l) => l.parent).length} buildings, ${shots} screenshots`);
  }

  const crops = await writeMaps(world);
  const out = {
    storageBase: storage.baseUrl,
    world: { map: { src: "/geo/maps/world.webp", width: world.W, height: world.H, squarePx: world.squarePx }, crops, locations },
  };
  writeFileSync(OUT_DATA, JSON.stringify(out));
  // Screenshots the data no longer uses are deleted.
  const kept = new Set(locations.flatMap((l) => l.shots.map((s) => s.id)));
  await storage.remove(old.flatMap((l) => l.shots.map((s) => s.id)).filter((id) => !kept.has(id)));
}

void main();
