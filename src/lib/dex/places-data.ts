import "server-only";
import fs from "node:fs";
import path from "node:path";
import geo from "@/data/geo.json";
import themes from "@/data/geo-themes.json";
import gymData from "@/data/quiz/games/gyms.json";
import placesData from "@/data/places.json";
import { geoFamily, isGeoFamily, familyRank } from "@/lib/geo-families";
import { VERSION_BY_KEY, versionOrder, type EncGen } from "@/lib/pokemon/encounter-types";
import { invertEncounters, mostRecentShot, versionRegions, placeKey, placeSlug, placeType, type PlaceEncounter, type PlaceType, type ShotRef } from "./places";

export interface PlaceRecord {
  slug: string;
  key: string;
  name: string;
  region: string;
  parent?: string;
  type: PlaceType;
  /** Game family names the place has PokéGuessr screenshots from, in release order. */
  games: string[];
  shot: ShotRef | null;
  /** On the World Atlas (has a map pin; screenshot when PokéGuessr has one). */
  atlas: boolean;
  /** Floors, areas and sectors (PokéAPI areas, encounter labels). */
  sections: string[];
}

interface ExtraPlace {
  name: string;
  region: string;
  parent?: string;
  /** Generations PokéAPI lists the location in. */
  gens?: number[];
  sections?: string[];
}
const PD = placesData as unknown as {
  places: ExtraPlace[];
  sections: Record<string, string[]>;
  enc: Record<string, { k: string; s?: string }>;
  pseudo: Record<string, string>;
};

export interface GymInfo {
  game: string;
  leader: string;
  /** Only when the gym list has it. */
  type?: string;
  badge?: string;
  source: string;
}

interface StoredLoc {
  name: string;
  region: string;
  parent?: string;
  shots: ShotRef[];
}

const T = themes as unknown as Record<string, { places?: string[]; buildings?: string[] }>;
const tags = {
  gyms: new Set(T.gyms?.buildings ?? []),
  towns: new Set(T.towns?.places ?? []),
  routes: new Set(T.routes?.places ?? []),
};

const ATLAS_PLACES: PlaceRecord[] = (geo as unknown as { world: { locations: StoredLoc[] } }).world.locations.map((l) => {
  const shots = l.shots.filter((s) => isGeoFamily(s.family));
  const fams = [...new Set(shots.map((s) => s.family))].sort((a, b) => familyRank(a) - familyRank(b));
  const key = placeKey(l);
  return {
    slug: placeSlug(l),
    key,
    name: l.name,
    region: l.region,
    ...(l.parent ? { parent: l.parent } : {}),
    type: placeType(l, tags),
    games: fams.map((f) => (isGeoFamily(f) ? geoFamily(f).name : f)),
    shot: mostRecentShot(shots),
    atlas: true,
    sections: PD.sections[key] ?? [],
  };
});

let INDEX: ReturnType<typeof invertEncounters> | null = null;
/** Every species file's confidently matched encounter rows, inverted to places (read once per build worker). */
export function placeIndex() {
  if (INDEX) return INDEX;
  const dir = path.join(process.cwd(), "src/data/encounters");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f): [number, EncGen[]] => [Number(f.slice(0, -5)), (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { gens: EncGen[] }).gens]);
  INDEX = invertEncounters(files, (loc, v) => {
    for (const r of versionRegions(v)) {
      const hit = PD.enc[`${loc}|${r}`];
      if (hit) return hit;
    }
    return null;
  });
  return INDEX;
}
/** Encounter labels that are not one place (roaming, Tera Raid Battles…), with why. */
export const PSEUDO_LOCATIONS = PD.pseudo;
export const wildAt = (key: string): PlaceEncounter[] => placeIndex().byPlace.get(key) ?? [];

/** The only main-series games set in these regions. */
const REGION_GAMES: Record<string, string[]> = {
  Hisui: ["legends-arceus"],
  Galar: ["sword", "shield"],
  "Isle of Armor": ["sword", "shield"],
  "Crown Tundra": ["sword", "shield"],
  Paldea: ["scarlet", "violet"],
  Kitakami: ["scarlet", "violet"],
  "Blueberry Academy": ["scarlet", "violet"],
};
const ORDINAL = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

/** Places beyond the atlas (scripts/dex/build-places.ts): no pin or screenshot; games from their wild Pokémon, else the region / PokéAPI generation. */
const EXTRA_PLACES: PlaceRecord[] = PD.places.map((p) => {
  const key = placeKey(p);
  const versions = new Set<string>(REGION_GAMES[p.region] ?? []);
  for (const r of wildAt(key)) r.v.forEach((v) => versions.add(v));
  const games = [...versions].sort((a, b) => versionOrder(a) - versionOrder(b)).map((v) => VERSION_BY_KEY[v]?.name ?? v);
  return {
    slug: placeSlug(p),
    key,
    name: p.name,
    region: p.region,
    ...(p.parent ? { parent: p.parent } : {}),
    type: placeType(p, tags),
    games: games.length ? games : (p.gens ?? []).map((g) => `Generation ${ORDINAL[g]} games`),
    shot: null,
    atlas: false,
    sections: p.sections ?? [],
  };
});

/** A place in both lists (the atlas gained a pin and screenshots for it) is one page: the atlas record, with the parent and sections the extra data knows. */
function mergePlaces(atlas: PlaceRecord[], extra: PlaceRecord[]): PlaceRecord[] {
  const bySlug = new Map(atlas.map((p) => [p.slug, p]));
  const out = [...atlas];
  for (const e of extra) {
    const a = bySlug.get(e.slug);
    if (!a) {
      out.push(e);
      continue;
    }
    if (!a.parent && e.parent) a.parent = e.parent;
    if (!a.sections.length && e.sections.length) a.sections = e.sections;
  }
  return out;
}

export const PLACES: PlaceRecord[] = mergePlaces(ATLAS_PLACES, EXTRA_PLACES).sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name, "en", { numeric: true }));

const BY_SLUG = new Map(PLACES.map((p) => [p.slug, p]));
export const getPlace = (slug: string) => BY_SLUG.get(slug);
export const placesIn = (region: string, parent: string) => PLACES.filter((p) => p.region === region && p.parent === parent);


/** The quiz's gym list (each entry cites Bulbapedia) uses a family name; these are the regions its towns are in. */
const GYM_REGIONS: Record<string, string[]> = {
  kanto: ["Kanto"],
  johto: ["Johto", "Kanto"],
  hoenn: ["Hoenn"],
  sinnoh: ["Sinnoh"],
  unova: ["Unova"],
  unova2: ["Unova"],
  kalos: ["Kalos"],
  alola: ["Alola"],
  galar: ["Galar"],
  paldea: ["Paldea"],
};
type GymRow = GymInfo & { family: string; place: string };

/** Gym leaders of a town (or of the town a Gym building stands in), straight from the repo's sourced gym list. */
export function gymsFor(p: PlaceRecord): GymInfo[] {
  const town = p.type === "Gym" && p.parent ? p.parent : p.type === "City" || p.type === "Town" ? p.name : null;
  if (!town) return [];
  return (gymData as unknown as GymRow[])
    .filter((g) => g.place === town && (GYM_REGIONS[g.family] ?? []).includes(p.region))
    .map(({ game, leader, type, badge, source }) => ({ game: game.replace(/^Pokémon /, ""), leader, type, badge, source }));
}
