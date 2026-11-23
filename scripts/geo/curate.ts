/**
 * Hand curation of PokéGuessr's screenshots, applied on top of what
 * ingest-world.ts builds. scripts/geo/curation.json is the record of every
 * change a person made after looking at the shots:
 *
 *   audit   fixes to existing shots: "relabel" (another game), "move" (another
 *           place) or "remove" (fails the bar), each with the reason
 *   added   new shots, each with the page it came from and the place and game
 *           it was checked against
 *
 * The bar a shot must pass (as in real GeoGuessr, reading a clue is part of the game):
 *   ALLOWED   visible clues: route signposts and numbers, the town-name banner shown on
 *             entering a place, dialogue or text boxes, buildings with names on them
 *   EXCLUDED  the in-game minimap or any map overlay showing the player's position (crop it
 *             out when a clean crop leaves a good view, else drop the image); broken
 *             images and composites, renders, guidebook maps and overhead maps (Bulbapedia's
 *             top-down area maps are never screenshots); the wrong place or game; generic
 *             interiors or caves that could be anywhere (a standard Pokémon Center or Mart,
 *             a plain house, office or shop); near-duplicates of shots already in
 *   INTERIORS a distinctive interior is a view of its town: a Gym, a museum, the Prism
 *             Tower, a Battle Tower / Frontier / Subway, a team's hideout or HQ, a one-of-a-kind
 *             department store, Lumiose's cafés and boutiques, Castelia's towers and the
 *             Battle Company, a Game Corner that is the only one of its kind, a lighthouse or
 *             landmark building. It goes to the building's own entry when the data has one,
 *             else to the town itself.
 *
 * How many shots a place gets (shotCap): a cap per game family that grows with the
 * place's size, because a big city or a wide open area has dozens of streets, plazas and
 * buildings to show and a short route doesn't. A town's buildings count towards its cap.
 *
 *   small   5    most places: routes, towns, caves, buildings
 *   large   8    a city with several districts, or an open area at least twice its
 *                region's typical size
 *   big     12   a big city, or an open area at least four times its region's typical size
 *   huge    20   the two metropolises, Lumiose City and Castelia City, and an open area at least
 *                six times its region's typical size (or a world of its own, as Area Zero)
 *
 * An open area's size is its mask (its grid points on the world map) against the median
 * mask of its region's places, so each region is measured on its own map's scale. A town's
 * mask is its icon, not its size, so towns and cities are sized by hand (CITY_SIZE), as are
 * Galar, the Isle of Armor and the Crown Tundra, whose masks are single points (OPEN_SIZE).
 * Applying flags an addition that takes a place past its cap, and --report lists every place
 * over its cap (most of them from before this rule, which only bounds what's added).
 *
 * Applying it is idempotent. It also gives every shot its game family (see
 * src/lib/geo-families.ts) and keeps scripts/geo/shot-sources.json, the source
 * of every shot in the data, so any of them can be checked again later.
 *
 *   npx tsx scripts/geo/curate.ts            # apply curation.json to src/data/geo.json
 *   npx tsx scripts/geo/curate.ts --report   # coverage per region and family against the standard
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { familyEra, familyOfGame, geoFamily, isGeoFamily, type GeoFamilyId } from "../../src/lib/geo-families";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "src/data/geo.json");
const CURATION = path.join(ROOT, "scripts/geo/curation.json");
const SOURCES = path.join(ROOT, "scripts/geo/shot-sources.json");
const SHOT_CACHE = path.join(ROOT, ".data/geo-shot-cache.json");
const WORLD_PLACES = path.join(ROOT, "scripts/geo/world-places.json");

export interface Shot {
  id: string;
  game: string;
  family?: string;
}
export interface Location {
  name: string;
  region: string;
  parent?: string;
  pin?: [number, number];
  mask?: [number, number][];
  shots: Shot[];
}
type Place = { region: string; name: string; parent?: string };

export type AuditEntry =
  | { id: string; action: "remove"; at: Place; reason: string }
  | { id: string; action: "relabel"; at: Place; from: string; to: string; reason: string }
  | { id: string; action: "move"; at: Place; to: Place; reason: string };

export interface Addition {
  id: string;
  region: string;
  name: string;
  parent?: string;
  game: string;
  /** The page the picture was taken from (a wiki's file page). */
  source: string;
  /** What it was checked against, when the shot alone isn't unambiguous. */
  checked?: string;
}

export interface Curation {
  audit: AuditEntry[];
  added: Addition[];
}

const same = (a: Place, b: Place) => a.region === b.region && a.name === b.name && (a.parent ?? null) === (b.parent ?? null);
const label = (p: Place) => `${p.region} | ${p.parent ? `${p.name} (${p.parent})` : p.name}`;

export function readCuration(): Curation {
  return existsSync(CURATION) ? JSON.parse(readFileSync(CURATION, "utf8")) : { audit: [], added: [] };
}

/** The family of a shot's game label; an unknown label is an error (fix the label, don't guess). */
export function familyFor(game: string, where: string): GeoFamilyId {
  const family = familyOfGame(game);
  if (!family) throw new Error(`${where}: "${game}" isn't a known game label`);
  return family;
}

let worldPlaces: { W: number; H: number; places: { name: string; region: string; x: number; y: number; mask: [number, number][] }[] } | null = null;
/** An atlas place's pin and area, normalised to the world map (as ingest-world.ts's placeArea). */
function atlasArea(p: Place): { pin: [number, number]; mask: [number, number][] } | null {
  worldPlaces ??= JSON.parse(readFileSync(WORLD_PLACES, "utf8"));
  const world = worldPlaces!;
  const place = world.places.find((x) => x.region === p.region && x.name === p.name);
  if (!place) return null;
  const norm = (v: number, size: number) => Math.round((v / size) * 100000) / 100000;
  return { pin: [norm(place.x, world.W), norm(place.y, world.H)], mask: place.mask.map(([x, y]) => [norm(x, world.W), norm(y, world.H)] as [number, number]) };
}

/** Applies the curation to the locations in place; returns what it changed. */
export function applyCuration(locations: Location[], curation: Curation): string[] {
  const log: string[] = [];
  const find = (p: Place) => locations.find((l) => same(l, p));
  for (const e of curation.audit) {
    const here = locations.find((l) => l.shots.some((s) => s.id === e.id));
    if (!here) continue; // already removed, or never imported
    const shot = here.shots.find((s) => s.id === e.id)!;
    if (e.action === "remove") {
      here.shots = here.shots.filter((s) => s.id !== e.id);
      log.push(`- ${label(here)}: removed ${e.id} (${e.reason})`);
    } else if (e.action === "relabel") {
      if (shot.game === e.to) continue;
      shot.game = e.to;
      shot.family = familyFor(e.to, e.id);
      log.push(`~ ${label(here)}: ${e.id} relabelled ${e.from} → ${e.to}`);
    } else {
      if (same(here, e.to)) continue;
      let dest = find(e.to);
      if (!dest && e.to.parent) {
        dest = { name: e.to.name, region: e.to.region, parent: e.to.parent, shots: [] };
        locations.push(dest);
      }
      if (!dest) throw new Error(`move ${e.id}: no place ${label(e.to)}`);
      here.shots = here.shots.filter((s) => s.id !== e.id);
      dest.shots.push(shot);
      log.push(`→ ${e.id}: ${label(here)} → ${label(dest)}`);
    }
  }
  for (const a of curation.added) {
    if (locations.some((l) => l.shots.some((s) => s.id === a.id))) continue;
    let dest = find(a);
    if (!dest && a.parent) {
      dest = { name: a.name, region: a.region, parent: a.parent, shots: [] };
      locations.push(dest);
    }
    // A place on the atlas that had no shot yet: its pin and area as world-places.json has them.
    if (!dest && !a.parent) {
      const area = atlasArea(a);
      if (area) {
        dest = { name: a.name, region: a.region, ...area, shots: [] };
        locations.push(dest);
      }
    }
    if (!dest) throw new Error(`add ${a.id}: no place ${label(a)}`);
    const family = familyFor(a.game, a.id);
    const over = areaShots(a, family, locations) >= shotCap(a, locations);
    dest.shots.push({ id: a.id, game: a.game, family });
    log.push(`+ ${label(dest)}: ${a.id} (${a.game})${over ? ` ! past the ${placeSize(a, locations)} place cap of ${shotCap(a, locations)}` : ""}`);
  }
  for (const l of locations) for (const s of l.shots) s.family = familyFor(s.game, `${label(l)} ${s.id}`);
  // A building left without shots is no round.
  for (let i = locations.length - 1; i >= 0; i--) if (locations[i].parent && !locations[i].shots.length) locations.splice(i, 1);
  return log;
}

/** A shot's source page, from the ingest's upload cache key. */
function sourceOfKey(key: string): string {
  const bare = key.replace(/@v\d+$/, "").replace(/#(top|bottom)[\d.]+/g, "");
  const crop = bare.match(/^crop:(.+)#(\d+,\d+,\d+,\d+)$/);
  if (crop) return `https://archives.bulbagarden.net/wiki/File:${crop[1]} (view cut at ${crop[2]})`;
  const wiki = bare.match(/^(fandom|pokepedia|pokewiki|wikidex):(.+)$/);
  if (wiki) {
    const [, site, file] = wiki;
    if (site === "fandom") return `https://pokemon.fandom.com/wiki/File:${file}`;
    if (site === "wikidex") return `https://www.wikidex.net/wiki/Archivo:${file}`;
    if (site === "pokepedia") return `https://www.pokepedia.fr/Fichier:${file}`;
    return `https://www.pokewiki.de/Datei:${file}`;
  }
  return `https://archives.bulbagarden.net/wiki/File:${bare}`;
}

/** Every shot's source: kept from before, from the curation's additions, or from the ingest's upload cache. */
function updateSources(locations: Location[], curation: Curation) {
  const sources: Record<string, string> = existsSync(SOURCES) ? JSON.parse(readFileSync(SOURCES, "utf8")) : {};
  const fromCache = new Map<string, string>();
  if (existsSync(SHOT_CACHE)) for (const [key, id] of Object.entries(JSON.parse(readFileSync(SHOT_CACHE, "utf8")) as Record<string, string>)) fromCache.set(id, key);
  for (const a of curation.added) sources[a.id] = a.source;
  let missing = 0;
  for (const l of locations) {
    for (const s of l.shots) {
      if (sources[s.id]) continue;
      const key = fromCache.get(s.id);
      if (key) sources[s.id] = sourceOfKey(key);
      else missing++;
    }
  }
  const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(SOURCES, JSON.stringify(sorted, null, 1) + "\n");
  if (missing) console.log(`  ${missing} shots have no known source`);
}

// ---------------------------------------------------------------------------
// How many shots a place gets: a cap per family that grows with its size
// ---------------------------------------------------------------------------

export const SIZE_CAP = { small: 5, large: 8, big: 12, huge: 20 } as const;
export type PlaceSize = keyof typeof SIZE_CAP;

/** Towns and cities by how much of them there is to see (a town's mask is its icon, so it can't tell). Unlisted: small. */
export const CITY_SIZE: Record<string, PlaceSize> = {
  "Kalos|Lumiose City": "huge",
  "Unova|Castelia City": "huge",
  // Big cities: many streets, plazas and landmark buildings.
  "Alola|Hau'oli City": "big",
  "Alola|Malie City": "big",
  "Paldea|Mesagoza": "big",
  "Paldea|Levincia": "big",
  "Paldea|Cascarrafa": "big",
  "Paldea|Naranja and Uva Academy": "big",
  "Galar|Wyndon": "big",
  "Galar|Hammerlocke": "big",
  "Galar|Motostoke": "big",
  "Sinnoh|Jubilife City": "big",
  "Sinnoh|Veilstone City": "big",
  "Sinnoh|Hearthome City": "big",
  "Johto|Goldenrod City": "big",
  "Kanto|Saffron City": "big",
  "Kanto|Celadon City": "big",
  "Hoenn|Lilycove City": "big",
  "Hoenn|Slateport City": "big",
  "Hoenn|Mauville City": "big",
  "Unova|Nimbasa City": "big",
  "Unova|Driftveil City": "big",
  // Cities with a few districts or several landmark buildings.
  "Alola|Konikoni City": "large",
  "Alola|Heahea City": "large",
  "Alola|Po Town": "large",
  "Alola|Aether Paradise": "large",
  "Paldea|Medali": "large",
  "Paldea|Artazon": "large",
  "Paldea|Porto Marinada": "large",
  "Paldea|Alfornada": "large",
  "Paldea|Montenevera": "large",
  "Paldea|Pokémon League": "large",
  "Kitakami|Mossui Town": "large",
  "Blueberry Academy|Blueberry Academy": "large",
  "Kalos|Anistar City": "large",
  "Kalos|Coumarine City": "large",
  "Kalos|Cyllage City": "large",
  "Kalos|Laverre City": "large",
  "Kalos|Shalour City": "large",
  "Kalos|Snowbelle City": "large",
  "Kalos|Santalune City": "large",
  "Galar|Circhester": "large",
  "Galar|Hulbury": "large",
  "Galar|Stow-on-Side": "large",
  "Galar|Ballonlea": "large",
  "Sinnoh|Sunyshore City": "large",
  "Sinnoh|Canalave City": "large",
  "Sinnoh|Eterna City": "large",
  "Sinnoh|Pastoria City": "large",
  "Sinnoh|Oreburgh City": "large",
  "Johto|Olivine City": "large",
  "Johto|Ecruteak City": "large",
  "Kanto|Vermilion City": "large",
  "Kanto|Cerulean City": "large",
  "Hoenn|Rustboro City": "large",
  "Hoenn|Mossdeep City": "large",
  "Hoenn|Sootopolis City": "large",
  "Hoenn|Fortree City": "large",
  "Hoenn|Ever Grande City": "large",
  "Unova|Opelucid City": "large",
  "Unova|Aspertia City": "large",
  "Unova|Nacrene City": "large",
  "Unova|Striaton City": "large",
  "Unova|Humilau City": "large",
  "Unova|Mistralton City": "large",
  "Unova|Virbank City": "large",
};

/** Open areas in the regions whose masks are single points (Galar, the Isle of Armor, the Crown Tundra), by hand. Unlisted: small. */
export const OPEN_SIZE: Record<string, PlaceSize> = {
  // The Wild Area's open fields and lakes.
  "Galar|Rolling Fields": "large",
  "Galar|Dappled Grove": "large",
  "Galar|Watchtower Ruins": "large",
  "Galar|East Lake Axewell": "large",
  "Galar|West Lake Axewell": "large",
  "Galar|Axew's Eye": "large",
  "Galar|South Lake Miloch": "large",
  "Galar|North Lake Miloch": "large",
  "Galar|Giant's Seat": "large",
  "Galar|Motostoke Riverbank": "large",
  "Galar|Bridge Field": "large",
  "Galar|Stony Wilderness": "large",
  "Galar|Dusty Bowl": "large",
  "Galar|Giant's Mirror": "large",
  "Galar|Hammerlocke Hills": "large",
  "Galar|Giant's Cap": "large",
  "Galar|Lake of Outrage": "large",
  "Isle of Armor|Fields of Honor": "large",
  "Isle of Armor|Soothing Wetlands": "large",
  "Isle of Armor|Forest of Focus": "large",
  "Isle of Armor|Challenge Beach": "large",
  "Isle of Armor|Challenge Road": "large",
  "Isle of Armor|Loop Lagoon": "large",
  "Isle of Armor|Training Lowlands": "large",
  "Isle of Armor|Potbottom Desert": "large",
  "Isle of Armor|Workout Sea": "large",
  "Isle of Armor|Insular Sea": "large",
  "Crown Tundra|Giant's Bed": "big",
  "Crown Tundra|Slippery Slope": "large",
  "Crown Tundra|Frostpoint Field": "large",
  "Crown Tundra|Old Cemetery": "large",
  "Crown Tundra|Snowslide Slope": "large",
  "Crown Tundra|Giant's Foot": "large",
  "Crown Tundra|Ballimere Lake": "large",
  "Crown Tundra|Frigid Sea": "large",
  // Open areas whose mask undersells them: Area Zero is a whole world below the crater's rim.
  "Paldea|Great Crater of Paldea": "huge",
};

/** A region's typical place size: the median mask of its towns, routes and landmarks (buildings have none). */
function regionMedians(locations: Location[]): Map<string, number> {
  const sizes = new Map<string, number[]>();
  for (const l of locations) if (!l.parent && l.mask?.length) sizes.set(l.region, [...(sizes.get(l.region) ?? []), l.mask.length]);
  const out = new Map<string, number>();
  for (const [region, list] of sizes) {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    out.set(region, sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }
  return out;
}

let medians: { of: Location[]; by: Map<string, number> } | null = null;
/** A place's size (a building is sized as its town, since it counts towards the town's cap). */
export function placeSize(place: { region: string; name: string; parent?: string }, locations: Location[]): PlaceSize {
  const name = place.parent ?? place.name;
  const key = `${place.region}|${name}`;
  if (CITY_SIZE[key]) return CITY_SIZE[key];
  if (OPEN_SIZE[key]) return OPEN_SIZE[key];
  if (medians?.of !== locations) medians = { of: locations, by: regionMedians(locations) };
  const median = medians.by.get(place.region) ?? 0;
  const cells = locations.find((l) => l.region === place.region && l.name === name && !l.parent)?.mask?.length ?? 0;
  // A region whose masks are points (median under 5) can't be measured: OPEN_SIZE covers it.
  if (median < 5 || !cells) return "small";
  const ratio = cells / median;
  return ratio >= 6 ? "huge" : ratio >= 4 ? "big" : ratio >= 2 ? "large" : "small";
}

/** The most shots a place (a town and its buildings together) gets in one game family. */
export const shotCap = (place: { region: string; name: string; parent?: string }, locations: Location[]) => SIZE_CAP[placeSize(place, locations)];

/** A place's shots of a family, its buildings' included. */
export function areaShots(place: { region: string; name: string; parent?: string }, family: string, locations: Location[]): number {
  const name = place.parent ?? place.name;
  return locations
    .filter((l) => l.region === place.region && (l.parent ?? l.name) === name)
    .reduce((n, l) => n + l.shots.filter((s) => (s.family ?? familyOfGame(s.game)) === family).length, 0);
}

// ---------------------------------------------------------------------------
// Coverage against the standard
// ---------------------------------------------------------------------------

/** Shots a place needs per family it appears in: 2D families at least 2 (aim for 3), 3D at least 3 (aim for 5). */
export const MINIMUM = { "2d": 2, "3d": 3 } as const;
export const TARGET = { "2d": 3, "3d": 5 } as const;

export interface Coverage {
  region: string;
  family: GeoFamilyId;
  places: number;
  atMinimum: number;
  atTarget: number;
  below: string[];
}

/** For each region and family: the places (a town and its buildings together) with shots of that family, and how many reach the minimum. */
export function coverage(locations: Location[]): Coverage[] {
  const areas = new Map<string, Map<GeoFamilyId, number>>();
  for (const l of locations) {
    const key = `${l.region}|${l.parent ?? l.name}`;
    const counts = areas.get(key) ?? new Map<GeoFamilyId, number>();
    for (const s of l.shots) counts.set(s.family as GeoFamilyId, (counts.get(s.family as GeoFamilyId) ?? 0) + 1);
    areas.set(key, counts);
  }
  const out = new Map<string, Coverage>();
  for (const [key, counts] of areas) {
    const [region, name] = key.split("|");
    for (const [family, n] of counts) {
      const k = `${region}|${family}`;
      const c = out.get(k) ?? { region, family, places: 0, atMinimum: 0, atTarget: 0, below: [] };
      const era = familyEra(family);
      c.places++;
      if (n >= MINIMUM[era]) c.atMinimum++;
      else c.below.push(`${name} (${n})`);
      if (n >= TARGET[era]) c.atTarget++;
      out.set(k, c);
    }
  }
  return [...out.values()].sort((a, b) => a.region.localeCompare(b.region) || a.family.localeCompare(b.family));
}

function report(locations: Location[]) {
  const rows = coverage(locations);
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(`${pad("region", 18)}${pad("family", 8)}${pad("places", 8)}${pad("≥min", 7)}${pad("<min", 7)}≥target`);
  for (const r of rows) console.log(`${pad(r.region, 18)}${pad(r.family, 8)}${pad(r.places, 8)}${pad(r.atMinimum, 7)}${pad(r.places - r.atMinimum, 7)}${r.atTarget}`);
  const fam = new Map<string, [number, number]>();
  for (const r of rows) {
    const [p, m] = fam.get(r.family) ?? [0, 0];
    fam.set(r.family, [p + r.places, m + r.atMinimum]);
  }
  console.log("\nper family:");
  for (const [f, [p, m]] of [...fam].sort()) console.log(`  ${pad(f, 6)} ${pad(geoFamily(f as GeoFamilyId).short, 10)} places ${pad(p, 5)} at minimum ${pad(m, 5)} below ${p - m}`);
  const over: string[] = [];
  for (const l of locations) {
    if (l.parent) continue;
    const fams = new Set(locations.filter((b) => b.region === l.region && (b.parent ?? b.name) === l.name).flatMap((b) => b.shots.map((s) => s.family!)));
    for (const f of fams) {
      const n = areaShots(l, f, locations);
      if (n > shotCap(l, locations)) over.push(`${l.region} | ${l.name} ${f} ${n}/${shotCap(l, locations)}`);
    }
  }
  console.log(`\nover their size cap (${over.length}): ${over.join(", ") || "none"}`);
  const shots = locations.reduce((n, l) => n + l.shots.length, 0);
  const empty = locations.filter((l) => !l.parent && !l.shots.length && !locations.some((b) => b.parent === l.name && b.region === l.region && b.shots.length));
  console.log(`\n${shots} shots; places with no shots: ${empty.map((l) => `${l.region} | ${l.name}`).join(", ") || "none"}`);
}

function main() {
  const data = JSON.parse(readFileSync(DATA, "utf8"));
  const locations: Location[] = data.world.locations;
  const curation = readCuration();
  for (const a of curation.added) if (!isGeoFamily(familyOfGame(a.game))) throw new Error(`add ${a.id}: unknown game ${a.game}`);
  // A shot re-cut under a new id (tests/fixtures/geo-shot-ids-replaced.json) stays out under its old one.
  const replacedFile = path.join(ROOT, "tests/fixtures/geo-shot-ids-replaced.json");
  const replaced = existsSync(replacedFile) ? (JSON.parse(readFileSync(replacedFile, "utf8")) as Record<string, string>) : {};
  curation.added = curation.added.filter((a) => !replaced[a.id]);
  if (process.argv.includes("--report")) {
    applyCuration(locations, curation);
    report(locations);
    return;
  }
  const log = applyCuration(locations, curation);
  writeFileSync(DATA, JSON.stringify(data));
  updateSources(locations, curation);
  for (const line of log) console.log(line);
  console.log(`  ${log.length} changes applied`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) main();
