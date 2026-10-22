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

/**
 * Caves: places that are a cave (or a mine or tunnel) all the way through.
 * Left out: mountains and roads that are partly outdoors (Mt. Silver, Mt.
 * Coronet, Iron Island, Stark Mountain, Reversal Mountain, the Kalos and
 * B2W2 Victory Roads, Ten Carat Hill), ruins and tombs (Dotted Hole too),
 * Sea Spirit's Den, and the man-made Underground Path.
 */
const CAVES = [
  "Kanto|Cerulean Cave",
  "Kanto|Diglett's Cave",
  "Kanto|Mt. Moon",
  "Kanto|Rock Tunnel",
  "Kanto|Seafoam Islands",
  "Kanto|Victory Road",
  "Kanto|Tohjo Falls",
  "Johto|Dark Cave",
  "Johto|Dragon's Den",
  "Johto|Ice Path",
  "Johto|Mt. Mortar",
  "Johto|Union Cave",
  "Johto|Slowpoke Well",
  "Johto|Whirl Islands",
  "Hoenn|Altering Cave",
  "Hoenn|Granite Cave",
  "Hoenn|Fiery Path",
  "Hoenn|Meteor Falls",
  "Hoenn|Rusturf Tunnel",
  "Hoenn|Seafloor Cavern",
  "Hoenn|Shoal Cave",
  "Hoenn|Scorched Slab",
  "Hoenn|Island Cave",
  "Hoenn|Victory Road",
  "Sevii Islands|Altering Cave",
  "Sevii Islands|Lost Cave",
  "Sinnoh|Oreburgh Mine",
  "Sinnoh|Ravaged Path",
  "Sinnoh|Turnback Cave",
  "Sinnoh|Wayward Cave",
  "Sinnoh|Victory Road",
  "Unova|Cave of Being",
  "Unova|Challenger's Cave",
  "Unova|Chargestone Cave",
  "Unova|Clay Tunnel",
  "Unova|Mistralton Cave",
  "Unova|Seaside Cave",
  "Unova|Wellspring Cave",
  "Unova|Twist Mountain",
  "Kalos|Connecting Cave",
  "Kalos|Frost Cavern",
  "Kalos|Glittering Cave",
  "Kalos|Reflection Cave",
  "Kalos|Terminus Cave",
  "Alola|Diglett's Tunnel",
  "Alola|Dividing Peak Tunnel",
  "Alola|Resolution Cave",
  "Alola|Sandy Cave",
  "Alola|Verdant Cavern",
  "Galar|Galar Mine",
  "Galar|Galar Mine No. 2",
  "Galar|Route 9 Tunnel",
  "Isle of Armor|Courageous Cavern",
  "Isle of Armor|Warm-Up Tunnel",
  "Crown Tundra|Lakeside Cave",
  "Crown Tundra|Roaring-Sea Caves",
  "Crown Tundra|Tunnel to the Top",
  "Paldea|Alfornada Cavern",
  "Paldea|Dalizapa Passage",
  "Paldea|Inlet Grotto",
];

/**
 * Water and coasts: seas, bays, lakes, lagoons and beaches, and the routes
 * that are mostly sea or coast. Left out: Galar's Wild Area lake zones and
 * Alola's Lake of the Sunne / Moone and Route 7, whose screenshots are
 * nearly all dry land.
 */
const WATER = [
  "Kanto|Route 19",
  "Kanto|Route 20",
  "Kanto|Route 21",
  "Johto|Route 40",
  "Johto|Route 41",
  "Johto|Lake of Rage",
  ...[105, 106, 107, 108, 109, 122, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134].map((n) => `Hoenn|Route ${n}`),
  "Sevii Islands|Treasure Beach",
  "Sevii Islands|Water Labyrinth",
  ...[213, 218, 219, 220, 230].map((n) => `Sinnoh|Route ${n}`),
  "Sinnoh|Lake Verity",
  "Sinnoh|Lake Valor",
  "Sinnoh|Lake Acuity",
  "Unova|Route 21",
  "Unova|Undella Bay",
  "Kalos|Route 8",
  "Kalos|Route 12",
  "Kalos|Azure Bay",
  "Alola|Route 14",
  "Alola|Route 15",
  "Alola|Big Wave Beach",
  "Alola|Hano Beach",
  "Alola|Heahea Beach",
  "Alola|Kala'e Bay",
  "Alola|Poni Beach",
  "Alola|Poni Breaker Coast",
  "Alola|Poni Coast",
  "Alola|Ula'ula Beach",
  "Galar|Route 9",
  "Isle of Armor|Challenge Beach",
  "Isle of Armor|Honeycalm Sea",
  "Isle of Armor|Insular Sea",
  "Isle of Armor|Loop Lagoon",
  "Isle of Armor|Stepping-Stone Sea",
  "Isle of Armor|Workout Sea",
  "Crown Tundra|Ballimere Lake",
  "Crown Tundra|Frigid Sea",
  "Paldea|Casseroya Lake",
  "Paldea|East Paldean Sea",
];

/** Forests and woods (Kalos Route 20 is the Winding Woods). */
const FORESTS = [
  "Kanto|Viridian Forest",
  "Johto|Ilex Forest",
  "Hoenn|Petalburg Woods",
  "Sevii Islands|Berry Forest",
  "Sinnoh|Eterna Forest",
  "Unova|Pinwheel Forest",
  "Unova|Lostlorn Forest",
  "Kalos|Santalune Forest",
  "Kalos|Route 20",
  "Alola|Lush Jungle",
  "Galar|Slumbering Weald",
  "Galar|Glimwood Tangle",
  "Galar|Dappled Grove",
  "Isle of Armor|Forest of Focus",
  "Paldea|Tagtree Thicket",
  "Kitakami|Timeless Woods",
];

/** Where a legendary Pokémon is met (mythical ones left out). */
const LEGENDARY = [
  "Kanto|Cerulean Cave",
  "Kanto|Seafoam Islands",
  "Kanto|Power Plant",
  "Sevii Islands|Mt. Ember",
  "Sevii Islands|Navel Rock",
  "Johto|Bell Tower",
  "Johto|Burned Tower",
  "Johto|Whirl Islands",
  "Hoenn|Sky Pillar",
  "Hoenn|Southern Island",
  "Hoenn|Seafloor Cavern",
  "Hoenn|Desert Ruins",
  "Hoenn|Island Cave",
  "Hoenn|Ancient Tomb",
  "Sinnoh|Spear Pillar",
  "Sinnoh|Lake Verity",
  "Sinnoh|Lake Valor",
  "Sinnoh|Lake Acuity",
  "Sinnoh|Turnback Cave",
  "Sinnoh|Distortion World",
  "Sinnoh|Stark Mountain",
  "Sinnoh|Snowpoint Temple",
  "Sinnoh|Fullmoon Island",
  "Unova|Dragonspiral Tower",
  "Unova|N's Castle",
  "Unova|Giant Chasm",
  "Unova|Abundant Shrine",
  "Unova|Cave of Being",
  "Kalos|Terminus Cave",
  "Kalos|Sea Spirit's Den",
  "Alola|Altar of the Sunne / Moone",
  "Alola|Ruins of Conflict",
  "Alola|Ruins of Life",
  "Alola|Ruins of Abundance",
  "Alola|Ruins of Hope",
  "Galar|Slumbering Weald",
  "Crown Tundra|Crown Shrine",
  "Crown Tundra|Iron Ruins",
  "Crown Tundra|Split-Decision Ruins",
  "Crown Tundra|Max Lair",
  "Paldea|Great Crater of Paldea",
];

/** Where each adventure starts: the hero's home town, and where the first partner is handed over when that's elsewhere. */
const STARTERS = [
  "Kanto|Pallet Town",
  "Johto|New Bark Town",
  "Hoenn|Littleroot Town",
  "Sinnoh|Twinleaf Town",
  "Unova|Nuvema Town",
  "Unova|Aspertia City",
  "Kalos|Vaniville Town",
  "Kalos|Aquacorde Town",
  "Alola|Iki Town",
  "Galar|Postwick",
  "Paldea|Cabo Poco",
];

export function buildThemes(places: Place[], located: Located[]): Record<string, ThemeTags> {
  const key = (p: { region: string; name: string }) => `${p.region}|${p.name}`;
  const known = new Set(places.map(key));
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
    caves: { places: check(CAVES, known, "caves"), preview: "Kalos|Reflection Cave" },
    towns: { places: places.filter((p) => p.kind === "town" && !NOT_TOWNS.has(key(p)) && played.has(key(p))).map(key).sort(), preview: "Kanto|Celadon City" },
    routes: { places: places.filter((p) => p.kind === "route" && /^Route \d+$/.test(p.name) && played.has(key(p))).map(key).sort(), preview: "Kanto|Route 1" },
    water: { places: check(WATER, known, "water"), preview: "Hoenn|Route 105" },
    forests: { places: check(FORESTS, known, "forests"), preview: "Kanto|Viridian Forest" },
    legendary: { places: check(LEGENDARY, known, "legendary"), preview: "Johto|Bell Tower" },
    starters: { places: check(STARTERS, known, "starters"), preview: "Kanto|Pallet Town" },
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
