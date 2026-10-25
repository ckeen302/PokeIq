import "server-only";
import fs from "node:fs";
import path from "node:path";
import geo from "@/data/geo.json";
import themes from "@/data/geo-themes.json";
import gymData from "@/data/quiz/games/gyms.json";
import { geoFamily, isGeoFamily, familyRank } from "@/lib/geo-families";
import type { EncGen } from "@/lib/pokemon/encounter-types";
import { invertEncounters, mostRecentShot, placeKey, placeSlug, placeType, type PlaceEncounter, type PlaceType, type ShotRef } from "./places";

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
}

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

export const PLACES: PlaceRecord[] = (geo as unknown as { world: { locations: StoredLoc[] } }).world.locations
  .map((l) => {
    const shots = l.shots.filter((s) => isGeoFamily(s.family));
    const fams = [...new Set(shots.map((s) => s.family))].sort((a, b) => familyRank(a) - familyRank(b));
    return {
      slug: placeSlug(l),
      key: placeKey(l),
      name: l.name,
      region: l.region,
      ...(l.parent ? { parent: l.parent } : {}),
      type: placeType(l, tags),
      games: fams.map((f) => (isGeoFamily(f) ? geoFamily(f).name : f)),
      shot: mostRecentShot(shots),
    };
  })
  .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name, "en", { numeric: true }));

const BY_SLUG = new Map(PLACES.map((p) => [p.slug, p]));
export const getPlace = (slug: string) => BY_SLUG.get(slug);
export const placesIn = (region: string, parent: string) => PLACES.filter((p) => p.region === region && p.parent === parent);

let INDEX: ReturnType<typeof invertEncounters> | null = null;
/** Every species file's confidently matched encounter rows, inverted to places (read once per build worker). */
export function placeIndex() {
  if (INDEX) return INDEX;
  const dir = path.join(process.cwd(), "src/data/encounters");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f): [number, EncGen[]] => [Number(f.slice(0, -5)), (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { gens: EncGen[] }).gens]);
  INDEX = invertEncounters(files);
  return INDEX;
}
export const wildAt = (key: string): PlaceEncounter[] => placeIndex().byPlace.get(key) ?? [];

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
