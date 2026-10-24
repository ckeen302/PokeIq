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
 *             interiors or caves that could be anywhere; near-duplicates of shots already in
 *   Cap each place at 5 shots per game family.
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
    if (!dest) throw new Error(`add ${a.id}: no place ${label(a)}`);
    dest.shots.push({ id: a.id, game: a.game, family: familyFor(a.game, a.id) });
    log.push(`+ ${label(dest)}: ${a.id} (${a.game})`);
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
  const wiki = bare.match(/^(fandom|pokepedia|pokewiki):(.+)$/);
  if (wiki) {
    const [, site, file] = wiki;
    if (site === "fandom") return `https://pokemon.fandom.com/wiki/File:${file}`;
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
  const shots = locations.reduce((n, l) => n + l.shots.length, 0);
  const empty = locations.filter((l) => !l.parent && !l.shots.length && !locations.some((b) => b.parent === l.name && b.region === l.region && b.shots.length));
  console.log(`\n${shots} shots; places with no shots: ${empty.map((l) => `${l.region} | ${l.name}`).join(", ") || "none"}`);
}

function main() {
  const data = JSON.parse(readFileSync(DATA, "utf8"));
  const locations: Location[] = data.world.locations;
  const curation = readCuration();
  for (const a of curation.added) if (!isGeoFamily(familyOfGame(a.game))) throw new Error(`add ${a.id}: unknown game ${a.game}`);
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
