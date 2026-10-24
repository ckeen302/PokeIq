/**
 * PokéGuessr's themed maps: which places each theme plays, written to
 * src/data/geo-themes.json. Towns and routes come from the atlas's own kinds;
 * Gyms are the Gym buildings (and Galar's Gym stadiums); the rest are lists
 * checked by hand, place by place, so a place tagged Cave is a cave. A name
 * here that isn't in the data is an error (a place renamed or merged).
 *
 *   npx tsx scripts/geo/themes.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PLACES = path.join(ROOT, "scripts/geo/world-places.json");
const DATA = path.join(ROOT, "src/data/geo.json");
const OUT = path.join(ROOT, "src/data/geo-themes.json");

type Kind = "town" | "route" | "landmark";
interface Place {
  name: string;
  region: string;
  kind: Kind;
}
interface Located {
  name: string;
  region: string;
  parent?: string;
  shots: unknown[];
}

/** "Region|Name". */
type Key = string;

export interface ThemeTags {
  /** Towns, routes and landmarks played with their buildings. */
  places?: Key[];
  /** Buildings played on their own (Gyms), as "Region|Name". */
  buildings?: Key[];
  /** The place whose screenshot previews the map. */
  preview: Key;
}

/** Not towns, though the atlas files them with towns: Leagues, battle facilities, a school, a Pokémon-only village. */
const NOT_TOWNS = new Set([
  "Alola|Pokémon League",
  "Kalos|Pokémon League",
  "Sinnoh|Pokémon League",
  "Unova|Pokémon League",
  "Kanto|Indigo Plateau",
  "Hoenn|Battle Frontier",
  "Sinnoh|Resort Area",
  "Kalos|Pokémon Village",
  "Unova|Black City / White Forest",
  "Blueberry Academy|Blueberry Academy",
]);

/** Gyms that aren't "… Gym" buildings: Galar's Gym stadiums. Alola's Kantonian Gym has no Gym Leader, so it's left out. */
const GALAR_GYMS = ["Turffield", "Hulbury", "Motostoke", "Stow-on-Side", "Ballonlea", "Circhester", "Hammerlocke"].map((t) => `Galar|${t} Stadium`);
const NOT_GYMS = new Set(["Alola|Kantonian Gym"]);

export function buildThemes(places: Place[], located: Located[]): Record<string, ThemeTags> {
  const key = (p: { region: string; name: string }) => `${p.region}|${p.name}`;
  const played = new Set(located.filter((l) => l.shots.length).map((l) => (l.parent ? `${l.region}|${l.parent}` : key(l))));
  const buildings = new Set(located.filter((l) => l.parent).map(key));
  const check = (list: Key[], set: Set<Key>, what: string) => {
    const missing = list.filter((k) => !set.has(k));
    if (missing.length) throw new Error(`${what}: not in the data: ${missing.join(", ")}`);
    return [...new Set(list)].filter((k) => played.has(k)).sort();
  };
  const gyms = located
    .filter((l) => l.parent && l.shots.length)
    .map(key)
    .filter((k) => (/ Gym$/.test(k) && !NOT_GYMS.has(k)) || GALAR_GYMS.includes(k));
  check(GALAR_GYMS, buildings, "gyms");
  return {
    gyms: { buildings: gyms.sort(), preview: "Kanto|Pewter Gym" },
    towns: { places: places.filter((p) => p.kind === "town" && !NOT_TOWNS.has(key(p)) && played.has(key(p))).map(key).sort(), preview: "Kanto|Celadon City" },
    routes: { places: places.filter((p) => p.kind === "route" && /^Route \d+$/.test(p.name) && played.has(key(p))).map(key).sort(), preview: "Kanto|Route 1" },
  };
}

function main() {
  const places = (JSON.parse(readFileSync(PLACES, "utf8")) as { places: Place[] }).places;
  const located = (JSON.parse(readFileSync(DATA, "utf8")) as { world: { locations: Located[] } }).world.locations;
  const themes = buildThemes(places, located);
  writeFileSync(OUT, JSON.stringify(themes, null, 1) + "\n");
  for (const [id, t] of Object.entries(themes)) console.log(`${id}: ${(t.places ?? t.buildings ?? []).length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) main();
