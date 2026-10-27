/**
 * PokéGuessr: new screenshots of the places on the map, from every source,
 * reviewed before anything is uploaded. Existing shots are never touched.
 *
 *   npx tsx scripts/geo/harvest.ts pages                 # each place's page on Bulbapedia, Poképédia, PokéWiki and the Pokémon Wiki
 *   npx tsx scripts/geo/harvest.ts list Paldea Kitakami  # the screenshots those pages and the wikis' per-game categories have of them
 *   npx tsx scripts/geo/harvest.ts fetch Paldea          # downloads what passes the bar, encodes it, drops near-copies of any shot
 *   npx tsx scripts/geo/harvest.ts sheets Paldea         # contact sheets of what's left, for review
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/geo/harvest.ts accept Paldea review.json
 *                                                         # uploads the kept ones (new random ids, upsert off) into curation.json's `added`
 *   npx tsx scripts/geo/curate.ts                        # then writes them into src/data/geo.json and shot-sources.json
 *
 * A file is a candidate only when it can be checked (the same rule as the rest
 * of the pipeline): it is shown on that place's own page on the wiki, or it is
 * in one of the wiki's per-game screenshot categories and its name names the
 * place; and its game (from its name, or the category) is one the region is
 * played in. No Legends games. Then a person looks at every one on a contact
 * sheet and drops anything wrong, ambiguous, generic, dark, or naming the place.
 *
 * The bar for a new shot: it fills a 16:9 frame. 3D games' shots are at least
 * 960 × 540 in the source (no upscaling), between 4:3 and 2.1:1, never
 * portrait; sprite games' shots are at their native pixels, at least the
 * console's screen, the same shapes.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { createClient } from "@supabase/supabase-js";
import {
  BUCKET,
  ENCODING,
  GAME_CODES,
  LOOK_ALIKE,
  SAME_GAME_PICTURE,
  SAME_PICTURE,
  WIKI,
  codeOf,
  encodeShot,
  hashDistance,
  imageHash,
  pixelScale,
  words,
} from "./bulbapedia";
import { httpGet, wikiApi } from "./http";
import { familyOfGame, familyEra, type GeoFamilyId } from "../../src/lib/geo-families";
import type { Addition, Curation } from "./curate";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "src/data/geo.json");
const PLACES = path.join(ROOT, "scripts/geo/world-places.json");
const CURATION = path.join(ROOT, "scripts/geo/curation.json");
const SHOT_CACHE = path.join(ROOT, ".data/geo-shot-cache.json");
const SHOT_HASHES = path.join(ROOT, ".data/geo-shot-hashes.json");
const DIR = path.join(ROOT, ".data/harvest");
const API_CACHE = path.join(DIR, "api");

// ---------------------------------------------------------------------------
// Regions, games and wikis
// ---------------------------------------------------------------------------

/** Each atlas region's games (Bulbapedia's file-name codes) and its name on Bulbapedia: as ingest-world.ts's SOURCES. */
const REGIONS: Record<string, { wiki: string; games: string[] }> = {
  Kanto: { wiki: "Kanto", games: ["RB", "RBY", "RGBY", "Y", "GSC", "GS", "C", "FRLG", "HGSS", "PE", "LGPE"] },
  Johto: { wiki: "Johto", games: ["GS", "GSC", "C", "HGSS"] },
  Hoenn: { wiki: "Hoenn", games: ["RS", "RSE", "SE", "E", "ORAS", "OR", "AS"] },
  Sinnoh: { wiki: "Sinnoh", games: ["DP", "Pt", "DPPt", "BDSP"] },
  Unova: { wiki: "Unova", games: ["BW", "B", "W", "B2W2", "B2", "W2", "BWB2W2"] },
  Kalos: { wiki: "Kalos", games: ["XY"] },
  Alola: { wiki: "Alola", games: ["SM", "USUM", "SMUSUM"] },
  Galar: { wiki: "Galar", games: ["SwSh"] },
  "Isle of Armor": { wiki: "Galar", games: ["SwSh"] },
  "Crown Tundra": { wiki: "Galar", games: ["SwSh"] },
  Paldea: { wiki: "Paldea", games: ["SV"] },
  Kitakami: { wiki: "Kitakami", games: ["SV"] },
  "Blueberry Academy": { wiki: "Unova", games: ["SV"] },
  "Sevii Islands": { wiki: "Sevii Islands", games: ["FRLG"] },
};
/** Map labels that aren't page titles (as ingest-world.ts's TITLES). */
const TITLES: Record<string, string> = {
  "Kanto|Safari Zone / Pal Park": "Kanto Safari Zone",
  "Alola|Lake of the Sunne / Moone": "Lake of the Sunne",
  "Alola|Altar of the Sunne / Moone": "Altar of the Sunne",
  "Unova|Black City / White Forest": "Black City",
  "Unova|Victory Road (B2W2)": "Victory Road (Black 2 and White 2)",
  "Paldea|Naranja and Uva Academy": "Naranja Academy",
  "Hoenn|Battle Frontier": "Battle Frontier (Generation III)",
  "Alola|Thrifty Megamart Abandoned Site": "Thrifty Megamart (Abandoned Site)",
  "Hoenn|Mirage Island": "Mirage Island (Generation III)",
  "Kanto|Underground Path 5-6": "Kanto Underground Path",
};
/** Places that share their page with another version of themselves: only their own game's shots. */
const ONLY_GAMES: Record<string, string[]> = { "Unova|Victory Road (B2W2)": ["B2W2", "B2", "W2"] };

type WikiId = "bulbapedia" | "pokepedia" | "pokewiki" | "fandom";
interface WikiDef {
  id: WikiId;
  api: string;
  lang: "en" | "fr" | "de";
  /** The prefix of its files' keys in the upload cache (Bulbapedia's are bare: the Archives' names). */
  key: string;
  filePage: (file: string) => string;
  /** The wiki's game abbreviations in file names → Bulbapedia's codes. */
  codes: Record<string, string>;
  /** The wiki's per-game screenshot categories → Bulbapedia's code. */
  gameCats: Record<string, string>;
}
const WIKIS: Record<WikiId, WikiDef> = {
  bulbapedia: {
    id: "bulbapedia",
    api: WIKI,
    lang: "en",
    key: "",
    filePage: (f) => `https://archives.bulbagarden.net/wiki/File:${f}`,
    codes: {},
    gameCats: {},
  },
  pokepedia: {
    id: "pokepedia",
    api: "https://www.pokepedia.fr/api.php",
    lang: "fr",
    key: "pokepedia:",
    filePage: (f) => `https://www.pokepedia.fr/Fichier:${f}`,
    codes: {
      EV: "SV", EB: "SwSh", DEPS: "BDSP", LGPE: "LGPE", XY: "XY", ROSA: "ORAS", SL: "SM", USUL: "USUM", RFVF: "FRLG",
      E: "E", RS: "RS", RSE: "RSE", HGSS: "HGSS", DP: "DP", Pt: "Pt", DPP: "DPPt", DPPt: "DPPt", NB: "BW", N2B2: "B2W2",
      OA: "GS", OAC: "GSC", C: "C", RB: "RB", RBJ: "RBY", J: "Y",
    },
    gameCats: {
      "Capture d'écran de Pokémon Écarlate et Violet": "SV",
      "Capture d'écran de Pokémon Épée et Bouclier": "SwSh",
      "Capture d'écran de Pokémon Diamant Étincelant et Perle Scintillante": "BDSP",
      "Capture d'écran de Pokémon Let's Go, Pikachu et Let's Go, Évoli": "LGPE",
      "Capture d'écran de Pokémon X et Y": "XY",
      "Capture d'écran de Pokémon Rubis Oméga et Saphir Alpha": "ORAS",
      "Capture d'écran de Pokémon Soleil et Lune": "SM",
      "Capture d'écran de Pokémon Ultra-Soleil et Ultra-Lune": "USUM",
      "Capture d'écran de Pokémon Rouge Feu et Vert Feuille": "FRLG",
      "Capture d'écran de Pokémon Or HeartGold et Argent SoulSilver": "HGSS",
      "Capture d'écran de Pokémon Noir et Blanc": "BW",
      "Capture d'écran de Pokémon Noir 2 et Blanc 2": "B2W2",
      "Capture d'écran de Pokémon Diamant et Perle": "DP",
      "Capture d'écran de Pokémon Platine": "Pt",
      "Capture d'écran de Pokémon Rubis et Saphir": "RS",
      "Capture d'écran de Pokémon Émeraude": "E",
      "Capture d'écran de Pokémon Or et Argent": "GS",
      "Capture d'écran de Pokémon Cristal": "C",
      "Capture d'écran de Pokémon Rouge et Bleu": "RB",
      "Capture d'écran de Pokémon Jaune": "Y",
    },
  },
  pokewiki: {
    id: "pokewiki",
    api: "https://www.pokewiki.de/api.php",
    lang: "de",
    key: "pokewiki:",
    filePage: (f) => `https://www.pokewiki.de/Datei:${f}`,
    codes: {
      KAPU: "SV", KP: "SV", SWSH: "SwSh", SDLP: "BDSP", LGPE: "LGPE", XY: "XY", ORAS: "ORAS", SoMo: "SM", USUM: "USUM",
      FRBG: "FRLG", HGSS: "HGSS", SW: "BW", SW2: "B2W2", S2W2: "B2W2", GSK: "GSC", DP: "DP", Pt: "Pt", DPPt: "DPPt",
    },
    gameCats: {
      "KAPU-Screenshot": "SV",
      "SWSH-Screenshot": "SwSh",
      "SDLP-Screenshot": "BDSP",
      "LGPE-Screenshot": "LGPE",
      "XY-Screenshot": "XY",
      "ORAS-Screenshot": "ORAS",
      "SoMo-Screenshot": "SM",
      "USUM-Screenshot": "USUM",
      "FRBG-Screenshot": "FRLG",
      "HGSS-Screenshot": "HGSS",
      "SW-Screenshot": "BW",
      "GSK-Screenshot": "GSC",
    },
  },
  fandom: {
    id: "fandom",
    api: "https://pokemon.fandom.com/api.php",
    lang: "en",
    key: "fandom:",
    filePage: (f) => `https://pokemon.fandom.com/wiki/File:${f}`,
    codes: {},
    gameCats: {},
  },
};
const WIKI_IDS = Object.keys(WIKIS) as WikiId[];

/** A Bulbapedia game code's label in the data: the specific game when the code says it. */
function labelOf(code: string): string | null {
  const label = GAME_CODES[code];
  return label && !/Legends/.test(label) ? label : null;
}
const famOf = (code: string) => familyOfGame(labelOf(code) ?? "") as GeoFamilyId | null;

/** Words in file names that mean "not a view of the place" (anime, manga, art, maps, sprites, menus, battles…). */
const NOT_A_VIEW =
  /(^|[ _(-])(map\d*|maps|karte|carte|localisation|icon|icône|icone|concept|konzeptzeichnung|art|artwork|anime|animé|manga|pms|adventures|tcg|sprite|foodsprite|sticker|symbol|logo|menu|trailer|prerelease|pre-release|storyboard|dessin|vs|battle|combat|affrontement|kampf|smash|ssbu|citydex|vote|disambig|wikipedia|platzhalter|stub|miniature|spielmechanik|picknick|picnic|kamera-app|livestream|cutscene|cinématique|zwischensequenz|generationen|generations|horizons|(lh|lv|vp|pg|pe|ep|ag|hz|sl|xy|bw|dp|dt|ss|jn|pm)\d{2,4})(?=[ _.)-]|$)/i;
/** PokéWiki's floor maps ("Seeschauminseln EG", "… UG1"): guide maps with item markers. */
const FLOOR_MAP = /[ _(-](EG|UG\d*|OG\d*)[ _.)-]/;

// ---------------------------------------------------------------------------
// Cached API access
// ---------------------------------------------------------------------------

function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}
function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 1));
}

/** An API call, cached on disk by its URL (re-runs never ask again). */
async function cachedApi<T>(base: string, params: Record<string, string>): Promise<T> {
  const key = createHash("sha1").update(base + JSON.stringify(params)).digest("hex");
  const file = path.join(API_CACHE, key.slice(0, 2), `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  const value = await wikiApi<T>(base, params);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return value;
}

type QueryPage = {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  categories?: { title: string }[];
  images?: { title: string }[];
  langlinks?: { lang: string; title: string }[];
  imageinfo?: { url: string; width: number; height: number }[];
};
type QueryResult = {
  query?: { pages?: QueryPage[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[]; categorymembers?: { title: string }[] };
  continue?: Record<string, string>;
};

/** A query over many titles (50 a request), following continuations; pages merged by title. */
async function queryTitles(wiki: WikiDef, titles: string[], params: Record<string, string>): Promise<{ pages: Map<string, QueryPage>; resolve: (t: string) => string }> {
  const pages = new Map<string, QueryPage>();
  const moved = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    let cont: Record<string, string> = {};
    for (;;) {
      const r = await cachedApi<QueryResult>(wiki.api, { action: "query", titles: titles.slice(i, i + 50).join("|"), ...params, ...cont });
      for (const n of r.query?.normalized ?? []) moved.set(n.from, n.to);
      for (const n of r.query?.redirects ?? []) moved.set(n.from, n.to);
      for (const p of r.query?.pages ?? []) {
        const had = pages.get(p.title);
        if (!had) pages.set(p.title, { ...p });
        else
          for (const k of ["categories", "images", "langlinks"] as const) if (p[k]) had[k] = [...(had[k] ?? []), ...p[k]!] as never;
      }
      if (!r.continue) break;
      cont = r.continue;
    }
  }
  const resolve = (t: string) => {
    let cur = t;
    for (let i = 0; i < 4 && moved.has(cur); i++) cur = moved.get(cur)!;
    return cur;
  };
  return { pages, resolve };
}

/** Every file in a category, with its size and URL (cached). */
async function categoryFileList(wiki: WikiDef, category: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const r = await cachedApi<QueryResult>(wiki.api, {
      action: "query",
      generator: "categorymembers",
      gcmtitle: `Category:${category}`,
      gcmtype: "file",
      gcmlimit: "max",
      prop: "imageinfo",
      iiprop: "url|size",
      ...cont,
    });
    for (const p of r.query?.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (info) out.push({ file: fileName(p.title), url: info.url, width: info.width, height: info.height, cats: [category] });
    }
    if (!r.continue) return out;
    cont = r.continue;
  }
}

interface FileMeta {
  file: string;
  url: string;
  width: number;
  height: number;
  cats: string[];
}
/** "Fichier:Mesaledo EV.png" → "Mesaledo_EV.png" (the form the upload cache keys use). */
const fileName = (title: string) => title.replace(/^[^:]+:/, "").replace(/ /g, "_");

/** Files' sizes, URLs and categories (50 a request, cached). */
async function fileMeta(wiki: WikiDef, files: string[]): Promise<Map<string, FileMeta>> {
  const out = new Map<string, FileMeta>();
  const { pages, resolve } = await queryTitles(
    wiki,
    files.map((f) => `File:${f.replace(/_/g, " ")}`),
    { prop: "imageinfo|categories", iiprop: "url|size", cllimit: "max", clshow: "!hidden" }
  );
  for (const f of files) {
    const p = pages.get(resolve(`File:${f.replace(/_/g, " ")}`));
    const info = p?.imageinfo?.[0];
    if (!p || !info) continue;
    out.set(f, { file: f, url: info.url, width: info.width, height: info.height, cats: (p.categories ?? []).map((c) => c.title.replace(/^[^:]+:/, "")) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Places and their pages
// ---------------------------------------------------------------------------

interface StoredShot {
  id: string;
  game: string;
  family?: string;
}
interface StoredLocation {
  name: string;
  region: string;
  parent?: string;
  pin?: [number, number];
  mask?: [number, number][];
  shots: StoredShot[];
}
interface Loc {
  region: string;
  name: string;
  parent?: string;
}
const locKey = (l: Loc) => `${l.region}|${l.parent ?? ""}|${l.name}`;
const areaKey = (l: Loc) => `${l.region}|${l.parent ?? l.name}`;

function loadGeo(): StoredLocation[] {
  return (JSON.parse(readFileSync(DATA, "utf8")) as { world: { locations: StoredLocation[] } }).world.locations;
}

/** Every place to find shots for: the data's places and buildings, and the atlas places that have none yet. */
function allLocations(): Loc[] {
  const geo = loadGeo();
  const out: Loc[] = geo.map((l) => ({ region: l.region, name: l.name, ...(l.parent ? { parent: l.parent } : {}) }));
  const world = JSON.parse(readFileSync(PLACES, "utf8")) as { places: { name: string; region: string }[] };
  for (const p of world.places) if (!out.some((l) => !l.parent && l.region === p.region && l.name === p.name)) out.push({ region: p.region, name: p.name });
  return out;
}

/** Each place's page title on each wiki (null: none found), and its names on the other-language wikis. */
interface PageIndex {
  [locKey: string]: { bulbapedia: string | null; pokepedia: string | null; pokewiki: string | null; fandom: string | null };
}
const PAGES = path.join(DIR, "pages.json");

/** A Bulbapedia page belongs to the region when one of its categories names it ("Paldea locations"), or it's a building's own page. */
const REGION_CATS: Record<string, string[]> = { "Sevii Islands": ["Sevii locations"], Sinnoh: ["Platinum locations"] };
const inRegionCats = (cats: string[], l: Loc) =>
  !cats.some((c) => /^Disambiguation/.test(c)) &&
  (!!l.parent || cats.some((c) => [REGIONS[l.region].wiki, l.region].some((r) => c.includes(r)) || (REGION_CATS[l.region] ?? []).includes(c)));

async function findPages(): Promise<PageIndex> {
  const locs = allLocations();
  const bulba = WIKIS.bulbapedia;
  const candidates = new Map<string, string[]>();
  for (const l of locs) {
    const name = TITLES[`${l.region}|${l.name}`] ?? l.name;
    const w = REGIONS[l.region].wiki;
    candidates.set(locKey(l), l.parent ? [name] : [`${w} ${name}`, `${name} (${w})`, `${name} (${l.region})`, name]);
  }
  const all = [...new Set([...candidates.values()].flat())];
  const { pages, resolve } = await queryTitles(bulba, all, { prop: "categories", cllimit: "max", clshow: "!hidden", redirects: "1" });
  const index: PageIndex = {};
  const titles = new Map<string, string>();
  for (const l of locs) {
    const found = candidates
      .get(locKey(l))!
      .map(resolve)
      .find((t) => {
        const p = pages.get(t);
        return p && !p.missing && !p.invalid && inRegionCats((p.categories ?? []).map((c) => c.title.replace(/^Category:/, "")), l);
      });
    if (found) titles.set(locKey(l), found);
  }
  // Their Poképédia (fr) and PokéWiki (de) pages, from Bulbapedia's language links.
  const { pages: links, resolve: r2 } = await queryTitles(bulba, [...new Set(titles.values())], { prop: "langlinks", lllimit: "max", redirects: "1" });
  // The Pokémon Wiki on Fandom: its English title, region-qualified first.
  const fandomTry = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const l of locs) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
  for (const l of locs) {
    const name = TITLES[`${l.region}|${l.name}`] ?? l.name;
    const w = REGIONS[l.region].wiki;
    fandomTry.set(locKey(l), [`${name} (${w})`, `${w} ${name}`, ...(counts.get(l.name) === 1 && !/^Route \d+$/.test(name) ? [name] : [])]);
  }
  const { pages: fpages, resolve: r3 } = await queryTitles(WIKIS.fandom, [...new Set([...fandomTry.values()].flat())], { redirects: "1" });
  for (const l of locs) {
    const t = titles.get(locKey(l)) ?? null;
    const ll = t ? links.get(r2(t))?.langlinks ?? [] : [];
    const fandom = fandomTry.get(locKey(l))!.map(r3).find((x) => fpages.get(x) && !fpages.get(x)!.missing && !fpages.get(x)!.invalid) ?? null;
    // A link to a section of another page (a market on its town's page) isn't the place's own page.
    const own = (lang: string) => ll.find((x) => x.lang === lang && !x.title.includes("#"))?.title ?? null;
    index[locKey(l)] = { bulbapedia: t, pokepedia: own("fr"), pokewiki: own("de"), fandom };
  }
  writeJson(PAGES, index);
  const found = (w: WikiId) => Object.values(index).filter((p) => p[w]).length;
  console.log(`${locs.length} places: Bulbapedia ${found("bulbapedia")}, Poképédia ${found("pokepedia")}, PokéWiki ${found("pokewiki")}, Pokémon Wiki ${found("fandom")}`);
  return index;
}

// ---------------------------------------------------------------------------
// Naming: which place a file's name names
// ---------------------------------------------------------------------------

/** Region and island words that only disambiguate a title ("Route 1 (Galar)", "Route 3 (Mele-Mele)"). */
const DISAMBIGUATORS = /\((kanto|johto|hoenn|sinnoh|unova|unys|einall|kalos|alola|galar|paldea|kitakami|hisui|mele-mele|akala|ula-ula|poni|isle of armor|crown tundra|île de l'armure|terres enneigées|rüstungsinsel|kronen-schneelande|myrtille|blaubeer[^)]*|[^)]*académie[^)]*|[^)]*akademie[^)]*|anime|jeux|spiel|game|games)\)/gi;
/** A title as the words a file name would spell: without a disambiguator, nor "City", "Town", "Village", "Stadt" at the end. */
function nameWords(title: string): string[] {
  const bare = title.replace(DISAMBIGUATORS, "").replace(/\s+(City|Town|Village|Stadt|Dorf)$/i, "").trim();
  const w = words(bare);
  return w.join("").length >= 4 ? w : words(title.replace(DISAMBIGUATORS, ""));
}
/** Some run of the file's words spells the name ("Route14" and "Kalos_Route_4" spell Route 4; "Route_40" doesn't). */
function spells(file: string[], name: string[]): boolean {
  const target = name.join("");
  if (!target) return false;
  for (let i = 0; i < file.length; i++) {
    let run = "";
    for (let j = i; j < file.length && run.length < target.length; j++) {
      run += file[j];
      if (run === target) return true;
    }
  }
  return false;
}
const fileWords = (file: string) => words(file.replace(/\.[a-z0-9]+$/i, ""));

/**
 * For each wiki, every place's name in its language, with the places' games:
 * the place a file names is the one with the longest name its words spell,
 * among the places of the file's game.
 */
function namer(index: PageIndex, locs: Loc[]) {
  const byWiki = new Map<WikiId, { loc: Loc; words: string[] }[]>();
  for (const w of WIKI_IDS) {
    const list: { loc: Loc; words: string[] }[] = [];
    for (const l of locs) {
      const p = index[locKey(l)];
      const title = w === "bulbapedia" || w === "fandom" ? TITLES[`${l.region}|${l.name}`] ?? l.name : p?.[w];
      if (title) list.push({ loc: l, words: nameWords(title) });
      // English names too on English wikis: the map label and the page title can differ.
      if ((w === "bulbapedia" || w === "fandom") && p?.bulbapedia) list.push({ loc: l, words: nameWords(p.bulbapedia) });
    }
    byWiki.set(w, list);
  }
  /** The place a file names, among places whose region plays `code`; null when none. */
  return (wiki: WikiId, file: string, code: string): Loc | null => {
    const fw = fileWords(file);
    let best: Loc | null = null;
    let longest = 0;
    for (const { loc, words: w } of byWiki.get(wiki)!) {
      if (!gamesOf(loc).includes(code)) continue;
      const n = w.join("").length;
      if (n > longest && spells(fw, w)) [best, longest] = [loc, n];
    }
    return best;
  };
}
const gamesOf = (l: Loc) => ONLY_GAMES[`${l.region}|${l.name}`] ?? ONLY_GAMES[`${l.region}|${l.parent}`] ?? REGIONS[l.region].games;

/** The game a wiki file is from, as a Bulbapedia code: its name's abbreviation (first or last word, or in brackets), else its per-game category. Null when they disagree or neither says. */
function gameOfFile(wiki: WikiDef, file: string, cats: string[]): string | null {
  const tokens = file.replace(/\.[a-z0-9]+$/i, "").split(/[ _()]+/).filter(Boolean);
  let named: string | null = null;
  if (wiki.id === "bulbapedia" || wiki.id === "fandom") named = codeOf(file);
  else for (const t of [tokens.at(-1), tokens[0]]) if (!named && t && wiki.codes[t]) named = wiki.codes[t];
  const fromCats = [...new Set(cats.map((c) => wiki.gameCats[c]).filter(Boolean))];
  if (fromCats.length > 1) return null;
  if (named && fromCats.length && famOf(named) !== famOf(fromCats[0])) return null;
  return named ?? fromCats[0] ?? null;
}

// ---------------------------------------------------------------------------
// Listing candidates
// ---------------------------------------------------------------------------

interface Candidate {
  /** Where it goes. */
  region: string;
  name: string;
  parent?: string;
  wiki: WikiId;
  file: string;
  url: string;
  width: number;
  height: number;
  code: string;
  game: string;
  /** How it was checked: shown on the place's own page, or in a per-game category and named after the place. */
  via: "page" | "category";
  page?: string;
  category?: string;
  /** Uploaded once before and not in the data (re-reviewed). */
  prev?: boolean;
  /** After fetch: staged webp, its hash, measurements. */
  staged?: string;
  hash?: string;
  w?: number;
  h?: number;
  luma?: number;
  detail?: number;
  flat?: number;
  /** Dropped automatically, and why. */
  drop?: string;
}

const isThreeD = (code: string) => familyEra(famOf(code)!) === "3d";

/** A 3D shot fills a 16:9 frame: at least 960 × 540, from 4:3 to 2.1:1. */
const fits3d = (w: number, h: number) => w >= 960 && h >= 540 && w / h >= 4 / 3 - 0.01 && w / h <= 2.1;
/** Native screens of the sprite games (a capture is these, or a whole multiple). */
const SCREENS: Record<string, [number, number]> = { gb: [160, 144], gba: [240, 160], ds: [256, 192] };
const screenOfFam = (f: GeoFamilyId) => (f === "rby" || f === "gsc" ? SCREENS.gb : f === "rse" || f === "frlg" ? SCREENS.gba : SCREENS.ds);
/** A sprite game's file is one screen (or a whole multiple of it): a screenshot, not an area map or a guide scan. */
function oneScreen(code: string, w: number, h: number): boolean {
  const [sw, sh] = screenOfFam(famOf(code)!);
  for (const k of [1, 2, 3, 4, 5, 6, 8]) if (w === sw * k && h === sh * k) return true;
  return false;
}

/** Files already used, or dropped from the data after a review, by their cache key without variants (trims, encoding). */
function usedFiles() {
  const geo = loadGeo();
  const live = new Set(geo.flatMap((l) => l.shots.map((s) => s.id)));
  const curation = readJson<Curation>(CURATION, { audit: [], added: [] });
  const removed = new Set(curation.audit.filter((e) => e.action === "remove").map((e) => e.id));
  const cache = readJson<Record<string, string>>(SHOT_CACHE, {});
  const base = (key: string) => key.replace(/@v\d+$/, "").replace(/#(top|bottom)[\d.]+/g, "");
  const used = new Set<string>();
  const dropped = new Set<string>();
  const tried = new Set<string>();
  for (const [key, id] of Object.entries(cache)) {
    if (key.startsWith("crop:")) continue;
    const b = base(key);
    tried.add(b);
    if (live.has(id)) used.add(b);
    if (removed.has(id)) dropped.add(b);
  }
  // Hand-added shots' sources.
  for (const a of curation.added) {
    const m = a.source.match(/(?:File|Fichier|Datei):(.+)$/);
    if (!m) continue;
    const prefix = a.source.includes("pokepedia") ? "pokepedia:" : a.source.includes("pokewiki") ? "pokewiki:" : a.source.includes("fandom") ? "fandom:" : "";
    const b = prefix + decodeURIComponent(m[1]).replace(/ /g, "_");
    (live.has(a.id) ? used : dropped).add(b);
  }
  return { used, dropped, tried };
}

/** The files ingest-world.ts denylists (they name the place, or aren't a view of it), read from its source. */
function denylist(): Set<string> {
  const src = readFileSync(path.join(ROOT, "scripts/ingest-world.ts"), "utf8");
  const out = new Set<string>();
  for (const name of ["DENYLIST", "WIKI_DENYLIST"]) {
    const start = src.indexOf(`const ${name} = new Set<string>([`);
    const block = start < 0 ? "" : src.slice(start, src.indexOf("]);", start));
    for (const m of block.matchAll(/"([^"]+)"/g)) out.add(m[1]);
  }
  return out;
}

async function list(regions: string[]) {
  const index = readJson<PageIndex>(PAGES, {});
  if (!Object.keys(index).length) throw new Error("run `harvest.ts pages` first");
  const locs = allLocations();
  const names = namer(index, locs);
  const { used, dropped, tried } = usedFiles();
  const denied = denylist();
  for (const region of regions) {
    const here = locs.filter((l) => l.region === region);
    const games = REGIONS[region].games;
    const found = new Map<string, Candidate>();
    const skipped: Record<string, number> = {};
    const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
    const consider = (wiki: WikiDef, meta: FileMeta, at: Loc, via: Candidate["via"], where: string) => {
      const f = meta.file;
      const key = wiki.key + f;
      if (found.has(key)) return;
      if (!/\.(png|jpe?g|webp)$/i.test(f)) return skip("not a picture");
      if (NOT_A_VIEW.test(f.replace(/_/g, " ")) || FLOOR_MAP.test(f.replace(/_/g, " "))) return skip("not a view (by name)");
      if (denied.has(f)) return skip("denylisted");
      const code = gameOfFile(wiki, f, meta.cats);
      if (!code || !labelOf(code)) return skip("no game");
      if (!gamesOf(at).includes(code)) return skip("other game");
      if (used.has(key)) return skip("already in the data");
      if (dropped.has(key)) return skip("dropped in an earlier review");
      // A file that names another place isn't a view of this one; one that names a building of this place (or the place of this building) goes there.
      const named = names(wiki.id, f, code);
      let loc = at;
      if (named && locKey(named) !== locKey(at)) {
        if (areaKey(named) !== areaKey(at)) return skip("names another place");
        loc = named;
      }
      const three = isThreeD(code);
      if (three ? !fits3d(meta.width, meta.height) : !oneScreen(code, meta.width, meta.height)) return skip(three ? "too small or not 16:9-ish" : "not one screen");
      found.set(key, {
        region: loc.region,
        name: loc.name,
        ...(loc.parent ? { parent: loc.parent } : {}),
        wiki: wiki.id,
        file: f,
        url: meta.url,
        width: meta.width,
        height: meta.height,
        code,
        game: labelOf(code)!,
        via,
        ...(via === "page" ? { page: where } : { category: where }),
        ...(tried.has(key) ? { prev: true } : {}),
      });
    };
    for (const wid of WIKI_IDS) {
      const wiki = WIKIS[wid];
      // Rule 1: shown on the place's own page.
      const titles = new Map<string, Loc>();
      for (const l of here) {
        const t = index[locKey(l)]?.[wid];
        if (t && !titles.has(t)) titles.set(t, l);
      }
      const { pages, resolve } = await queryTitles(wiki, [...titles.keys()], { prop: "images", imlimit: "max", redirects: "1" });
      const perPage = new Map<string, string[]>();
      for (const [t] of titles) perPage.set(t, (pages.get(resolve(t))?.images ?? []).map((i) => fileName(i.title)));
      const allFiles = [...new Set([...perPage.values()].flat())].filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !NOT_A_VIEW.test(f.replace(/_/g, " ")));
      const meta = await fileMeta(wiki, allFiles);
      for (const [t, l] of titles) for (const f of perPage.get(t)!) if (meta.has(f)) consider(wiki, meta.get(f)!, l, "page", t);
      // Rule 2: in a per-game screenshot category, and named after the place.
      for (const [cat, code] of Object.entries(wiki.gameCats)) {
        if (!games.includes(code)) continue;
        const named = (await categoryFileList(wiki, cat)).flatMap((m) => {
          const loc = names(wid, m.file, code);
          return loc && loc.region === region && !NOT_A_VIEW.test(m.file.replace(/_/g, " ")) ? [{ m, loc }] : [];
        });
        const full = await fileMeta(wiki, named.map((x) => x.m.file));
        for (const { m, loc } of named) consider(wiki, full.get(m.file) ?? m, loc, "category", cat);
      }
    }
    const out = [...found.values()];
    writeJson(path.join(DIR, region, "list.json"), out);
    const byFam = new Map<string, number>();
    for (const c of out) byFam.set(famOf(c.code)!, (byFam.get(famOf(c.code)!) ?? 0) + 1);
    const byWiki = new Map<string, number>();
    for (const c of out) byWiki.set(c.wiki, (byWiki.get(c.wiki) ?? 0) + 1);
    console.log(`${region}: ${out.length} candidates (${out.filter((c) => c.prev).length} tried before) · ${[...byFam].map(([f, n]) => `${f} ${n}`).join(", ")} · ${[...byWiki].map(([w, n]) => `${w} ${n}`).join(", ")}`);
    console.log(`  skipped: ${Object.entries(skipped).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Fetching: download, measure, encode, drop near-copies
// ---------------------------------------------------------------------------

/** The data's shots by area, with their hashes (fetched from storage when missing). */
async function existingHashes(): Promise<{ hashes: Record<string, string | null>; shots: { id: string; area: string; family: string }[] }> {
  const geo = JSON.parse(readFileSync(DATA, "utf8")) as { storageBase: string; world: { locations: StoredLocation[] } };
  const hashes = readJson<Record<string, string | null>>(SHOT_HASHES, {});
  const shots = geo.world.locations.flatMap((l) => l.shots.map((s) => ({ id: s.id, area: `${l.region}|${l.parent ?? l.name}`, family: s.family ?? familyOfGame(s.game) ?? "" })));
  let fetched = 0;
  for (const s of shots) {
    if (hashes[s.id]) continue;
    const res = await fetch(`${geo.storageBase}/${s.id}.webp`).catch(() => null);
    if (res?.ok) {
      hashes[s.id] = await imageHash(Buffer.from(await res.arrayBuffer()));
      fetched++;
    }
  }
  if (fetched) writeFileSync(SHOT_HASHES, JSON.stringify(hashes));
  return { hashes, shots };
}

/** Brightness, detail (Laplacian spread) and the share of the most common colour, as the audit measures them. */
async function measure(buf: Buffer) {
  const grey = await sharp(buf).greyscale().resize({ width: 512 }).raw().toBuffer();
  let luma = 0;
  for (const v of grey) luma += v;
  const lap = await sharp(buf).greyscale().resize({ width: 512 }).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).raw().toBuffer();
  let sum = 0;
  let sq = 0;
  for (const v of lap) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / lap.length;
  const rgb = await sharp(buf).removeAlpha().resize({ width: 160 }).raw().toBuffer();
  const counts = new Map<number, number>();
  for (let i = 0; i < rgb.length; i += 3) {
    const k = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return { luma: luma / grey.length, detail: Math.sqrt(Math.max(0, sq / lap.length - mean * mean)), flat: Math.max(...counts.values()) / (rgb.length / 3) };
}

/** The part of a sprite-game screenshot to keep so it isn't taller than 4:3 (Game Boy screens are 10:9): its middle. */
function frameOf(code: string, w: number, h: number) {
  if (!isThreeD(code) && w / h < 4 / 3) {
    const nh = Math.round((w * 3) / 4);
    return { left: 0, top: Math.round((h - nh) / 2), width: w, height: nh };
  }
  return { left: 0, top: 0, width: w, height: h };
}

const stagedPath = (region: string, c: Candidate) => path.join(DIR, region, "staged", `${createHash("sha1").update(c.wiki + c.file).digest("hex").slice(0, 16)}.webp`);

async function fetchRegion(region: string) {
  const file = path.join(DIR, region, "list.json");
  const cands = readJson<Candidate[]>(file, []);
  const { hashes, shots } = await existingHashes();
  const staged = path.join(DIR, region, "staged");
  mkdirSync(staged, { recursive: true });
  // Thin places first, and each place's own-page files before the categories'.
  const have = new Map<string, number>();
  for (const s of shots) have.set(`${s.area}|${s.family}`, (have.get(`${s.area}|${s.family}`) ?? 0) + 1);
  const rank = (c: Candidate) => (have.get(`${areaKey(c)}|${famOf(c.code)}`) ?? 0) * 10 + (c.via === "page" ? 0 : 1);
  cands.sort((a, b) => rank(a) - rank(b) || areaKey(a).localeCompare(areaKey(b)) || a.file.length - b.file.length);
  const kept: Candidate[] = [];
  let n = 0;
  for (const c of cands) {
    n++;
    if (c.staged && existsSync(c.staged) && c.hash) {
      if (!c.drop) kept.push(c);
      continue;
    }
    try {
      const raw = await httpGet(c.url);
      const meta = await sharp(raw).metadata();
      let [w, h] = [meta.width ?? 0, meta.height ?? 0];
      const three = isThreeD(c.code);
      if (three && !fits3d(w, h)) c.drop = `too small or not 16:9-ish (${w}×${h})`;
      let frame = frameOf(c.code, w, h);
      if (!three && !c.drop) {
        const k = await pixelScale(raw);
        const [sw, sh] = screenOfFam(famOf(c.code)!);
        if (w / k < sw || h / k < sh * 0.83) c.drop = `smaller than the screen (${w / k}×${h / k} native)`;
        if (h > w) c.drop = `portrait (${w}×${h})`;
        frame = frameOf(c.code, Math.floor(w / k) * k, Math.floor(h / k) * k);
      }
      if (!c.drop) {
        const webp = await encodeShot(raw, c.game, frame);
        const m = await measure(webp);
        const out = await sharp(webp).metadata();
        [w, h] = [out.width ?? 0, out.height ?? 0];
        Object.assign(c, { w, h, luma: Math.round(m.luma), detail: Math.round(m.detail * 10) / 10, flat: Math.round(m.flat * 100) / 100 });
        c.hash = await imageHash(webp);
        c.staged = stagedPath(region, c);
        writeFileSync(c.staged, webp);
        if (m.luma < 38) c.drop = `too dark (mean ${Math.round(m.luma)})`;
        else if (m.flat > (three ? 0.5 : 0.65)) c.drop = `mostly one colour (${Math.round(m.flat * 100)}%)`;
        else if (three && m.detail < 6) c.drop = `blurry (detail ${m.detail.toFixed(1)})`;
      }
    } catch (err) {
      c.drop = `fetch failed: ${(err as Error).message.slice(0, 80)}`;
    }
    if (!c.drop && c.hash) {
      // A copy of a shot of this place (any game close, or the same family's looser), or a look-alike of another place's.
      const fam = famOf(c.code)!;
      const area = areaKey(c);
      const copy =
        shots.find((s) => {
          const o = hashes[s.id];
          if (!o) return false;
          const d = hashDistance(c.hash!, o);
          return s.area === area ? d <= SAME_PICTURE || (d <= SAME_GAME_PICTURE && s.family === fam) : d <= LOOK_ALIKE;
        }) ??
        kept.find((k) => {
          const d = hashDistance(c.hash!, k.hash!);
          return areaKey(k) === area ? d <= SAME_PICTURE || (d <= SAME_GAME_PICTURE && famOf(k.code) === fam) : d <= LOOK_ALIKE;
        });
      if (copy) c.drop = `near-copy of ${"id" in copy ? `shot ${copy.id} (${copy.area})` : `${copy.wiki}:${copy.file}`}`;
    }
    if (c.drop && c.staged) {
      rmSync(c.staged, { force: true });
      delete c.staged;
    }
    if (!c.drop) kept.push(c);
    if (n % 25 === 0) {
      writeJson(file, cands);
      console.log(`  ${n}/${cands.length} fetched, ${kept.length} kept`);
    }
  }
  writeJson(file, cands);
  const drops = new Map<string, number>();
  for (const c of cands) if (c.drop) drops.set(c.drop.replace(/ \(.*$|: .*$| of .*$/, ""), (drops.get(c.drop.replace(/ \(.*$|: .*$| of .*$/, "")) ?? 0) + 1);
  console.log(`${region}: ${kept.length} of ${cands.length} kept for review · dropped: ${[...drops].map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

// ---------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------

const TILE_W = 400;
const TILE_H = 225;
const LABEL_H = 34;
const COLS = 4;
const ROWS = 5;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sheets(region: string) {
  const cands = readJson<Candidate[]>(path.join(DIR, region, "list.json"), []).filter((c) => !c.drop && c.staged && existsSync(c.staged));
  cands.sort((a, b) => areaKey(a).localeCompare(areaKey(b)) || locKey(a).localeCompare(locKey(b)) || a.file.localeCompare(b.file));
  const outDir = path.join(DIR, region, "sheets");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const index: { sheet: number; tile: number; key: string }[] = [];
  const per = COLS * ROWS;
  for (let s = 0; s * per < cands.length; s++) {
    const comps: OverlayOptions[] = [];
    const batch = cands.slice(s * per, (s + 1) * per);
    for (const [i, c] of batch.entries()) {
      const x = (i % COLS) * (TILE_W + 6);
      const y = Math.floor(i / COLS) * (TILE_H + LABEL_H + 6);
      const img = await sharp(c.staged!).resize(TILE_W, TILE_H, { fit: "contain", background: "#222" }).png().toBuffer();
      const where = c.parent ? `${c.name} · ${c.parent}` : c.name;
      const l1 = `${s}.${i} ${where}`.slice(0, 56);
      const l2 = `${c.code} ${c.wiki.slice(0, 4)} ${c.via === "page" ? "pg" : "cat"}${c.prev ? "*" : ""} ${c.file}`.slice(0, 56);
      const svg = `<svg width="${TILE_W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="3" y="14" font-family="DejaVu Sans Mono, monospace" font-size="12">${esc(l1)}</text><text x="3" y="29" font-family="DejaVu Sans Mono, monospace" font-size="12">${esc(l2)}</text></svg>`;
      comps.push({ input: Buffer.from(svg), left: x, top: y }, { input: img, left: x, top: y + LABEL_H });
      index.push({ sheet: s, tile: i, key: WIKIS[c.wiki].key + c.file });
    }
    const rows = Math.ceil(batch.length / COLS);
    await sharp({ create: { width: COLS * (TILE_W + 6), height: rows * (TILE_H + LABEL_H + 6), channels: 3, background: "#666" } })
      .composite(comps)
      .png()
      .toFile(path.join(outDir, `${String(s).padStart(3, "0")}.png`));
  }
  writeJson(path.join(outDir, "index.json"), index);
  console.log(`${region}: ${cands.length} candidates on ${Math.ceil(cands.length / per)} sheets in ${outDir}`);
}

// ---------------------------------------------------------------------------
// Accepting the reviewed ones
// ---------------------------------------------------------------------------

/**
 * review.json: { "sheets": [0, 1, …] (the sheets looked at), "reject": { "3.7": "reason", … },
 * "crop": { "2.4": { "top"?: share, "bottom"?: share, "left"?: share, "right"?: share } } }.
 * Every tile on a reviewed sheet that isn't rejected is kept (after its crop).
 */
interface Review {
  sheets: number[];
  reject: Record<string, string>;
  crop?: Record<string, { top?: number; bottom?: number; left?: number; right?: number }>;
}

async function accept(region: string, reviewFile: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
  const review = JSON.parse(readFileSync(reviewFile, "utf8")) as Review;
  const listFile = path.join(DIR, region, "list.json");
  const cands = readJson<Candidate[]>(listFile, []);
  const byKey = new Map(cands.map((c) => [WIKIS[c.wiki].key + c.file, c]));
  const index = readJson<{ sheet: number; tile: number; key: string }[]>(path.join(DIR, region, "sheets", "index.json"), []);
  const curation = readJson<Curation>(CURATION, { audit: [], added: [] });
  const cache = readJson<Record<string, string>>(SHOT_CACHE, {});
  const hashes = readJson<Record<string, string | null>>(SHOT_HASHES, {});
  const ledgerFile = path.join(DIR, region, "decisions.json");
  const ledger = readJson<Record<string, { decision: string; id?: string; reason?: string }>>(ledgerFile, {});
  const { hashes: liveHashes, shots } = await existingHashes();
  let added = 0;
  for (const { sheet, tile, key: k } of index) {
    if (!review.sheets.includes(sheet)) continue;
    const c = byKey.get(k);
    if (!c || ledger[k]?.id) continue;
    const tag = `${sheet}.${tile}`;
    if (review.reject[tag]) {
      ledger[k] = { decision: "rejected", reason: review.reject[tag] };
      continue;
    }
    const raw = await httpGet(c.url);
    const meta = await sharp(raw).metadata();
    let [w, h] = [meta.width ?? 0, meta.height ?? 0];
    let box = { left: 0, top: 0, width: w, height: h };
    const three = isThreeD(c.code);
    if (!three) {
      const kk = await pixelScale(raw);
      [w, h] = [Math.floor(w / kk) * kk, Math.floor(h / kk) * kk];
      box = frameOf(c.code, w, h);
    }
    const cut = review.crop?.[tag];
    if (cut) {
      const left = Math.round(box.width * (cut.left ?? 0));
      const top = Math.round(box.height * (cut.top ?? 0));
      box = { left: box.left + left, top: box.top + top, width: box.width - left - Math.round(box.width * (cut.right ?? 0)), height: box.height - top - Math.round(box.height * (cut.bottom ?? 0)) };
      // Still 2.1:1 at most: trim the sides evenly.
      if (box.width / box.height > 2.1) {
        const nw = Math.floor(box.height * 2.1);
        box = { ...box, left: box.left + Math.floor((box.width - nw) / 2), width: nw };
      }
    }
    if (three ? !fits3d(box.width, box.height) : box.width < box.height * (4 / 3) - 1 || box.width / box.height > 2.1) {
      ledger[k] = { decision: "rejected", reason: `too small after its crop (${box.width}×${box.height})` };
      continue;
    }
    const webp = await encodeShot(raw, c.game, box);
    const hash = await imageHash(webp);
    const area = areaKey(c);
    const fam = famOf(c.code)!;
    const copy = shots.find((s) => {
      const o = liveHashes[s.id] ?? hashes[s.id];
      if (!o) return false;
      const d = hashDistance(hash, o);
      return s.area === area ? d <= SAME_PICTURE || (d <= SAME_GAME_PICTURE && s.family === fam) : d <= LOOK_ALIKE;
    });
    if (copy) {
      ledger[k] = { decision: "rejected", reason: `near-copy of ${copy.id}` };
      continue;
    }
    const id = randomBytes(9).toString("base64url");
    const { error } = await bucket.upload(`${id}.webp`, webp, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (error) {
      console.log(`  ! ${k}: ${error.message}`);
      continue;
    }
    const where = c.via === "page" ? `shown on ${c.wiki === "bulbapedia" ? "Bulbapedia" : c.wiki === "pokepedia" ? "Poképédia" : c.wiki === "pokewiki" ? "PokéWiki" : "the Pokémon Wiki"}'s page "${c.page}"` : `in ${c.wiki}'s category "${c.category}", named after the place`;
    const addition: Addition = {
      id,
      region: c.region,
      name: c.name,
      ...(c.parent ? { parent: c.parent } : {}),
      game: c.game,
      source: WIKIS[c.wiki].filePage(c.file),
      checked: `${where}; ${c.code} in its name or category${cut ? `; cropped (${Object.entries(cut).map(([s, v]) => `${s} ${Math.round(v * 100)}%`).join(", ")})` : ""}; reviewed on a contact sheet`,
    };
    curation.added.push(addition);
    cache[`${WIKIS[c.wiki].key}${c.file}${cut ? `#crop${Object.entries(cut).map(([s, v]) => `${s}${v}`).join("")}` : ""}@${ENCODING}`] = id;
    hashes[id] = hash;
    shots.push({ id, area, family: fam });
    liveHashes[id] = hash;
    ledger[k] = { decision: "added", id };
    added++;
    writeJson(CURATION, curation);
    writeFileSync(SHOT_CACHE, JSON.stringify(cache));
    writeFileSync(SHOT_HASHES, JSON.stringify(hashes));
    writeJson(ledgerFile, ledger);
    if (added % 20 === 0) console.log(`  ${added} uploaded`);
  }
  writeJson(ledgerFile, ledger);
  const rejected = Object.values(ledger).filter((d) => d.decision === "rejected").length;
  console.log(`${region}: ${added} added this run · ${Object.values(ledger).filter((d) => d.id).length} added, ${rejected} rejected in all`);
}

/** Deletes the staged copies and downloads of a region once it's accepted. */
function clean(region: string) {
  for (const d of ["staged", "sheets"]) rmSync(path.join(DIR, region, d), { recursive: true, force: true });
  console.log(`${region}: staged files removed`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const regions = args.filter((a) => REGIONS[a]);
  if (cmd === "pages") await findPages();
  else if (cmd === "list") await list(regions.length ? regions : Object.keys(REGIONS));
  else if (cmd === "fetch") for (const r of regions) await fetchRegion(r);
  else if (cmd === "sheets") for (const r of regions) await sheets(r);
  else if (cmd === "accept") await accept(args[0], args[1]);
  else if (cmd === "clean") for (const r of regions) clean(r);
  else if (cmd === "dirs") console.log(readdirSync(DIR).join("\n"));
  else throw new Error("usage: harvest.ts pages | list <Region…> | fetch <Region…> | sheets <Region…> | accept <Region> review.json | clean <Region…>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
