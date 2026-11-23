/**
 * Matching an encounter row's place to a pinned place on the PokéGuessr map.
 * Pure functions (no file access) so the tests can run them and check they're deterministic.
 *
 * A row's versions decide the regions it can be in (VERSION_REGIONS); the place name
 * decides which place in those regions. Exactly one pinned place must match, otherwise
 * the row is uncertain and the Pokémon is left out (rules 2, 4 and 5).
 */
import { normPlace } from "../../src/lib/pokemon/encounter-transform";
import { METHODS, MAX_RAID_VERSIONS, OFF_MAP_PLACES, PLACE_ALIASES, VERSION_REGIONS, ZA_PLACE } from "./rules";

export interface GeoPlace {
  name: string;
  region: string;
  pin?: [number, number];
  mask?: [number, number][];
  parent?: string;
}

/** A pinned place: what an answer points at. */
export interface PinnedPlace {
  region: string;
  name: string;
  pin: [number, number];
  mask: [number, number][];
}

export interface PlaceIndex {
  /** region → normalised name → pinned places it names (a building names its parent). */
  byRegion: Map<string, Map<string, Set<string>>>;
  /** "Region|Name" → the pinned place. */
  pinned: Map<string, PinnedPlace>;
}

const REGION_NAMES = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
/** The wiki's disambiguation on a few map names: "Pokémon Mansion (Kanto)", "Battle Tower (Generation II)". */
const DISAMBIG = new RegExp(` \\((${REGION_NAMES.join("|")}|Generation [IVX]+|Jagged Pass)\\)$`);

export const placeKey = (region: string, name: string) => `${region}|${name}`;

export function buildPlaceIndex(locations: GeoPlace[]): PlaceIndex {
  const pinned = new Map<string, PinnedPlace>();
  for (const l of locations) if (l.pin && l.mask && !l.parent) pinned.set(placeKey(l.region, l.name), { region: l.region, name: l.name, pin: l.pin, mask: l.mask });
  const byRegion = new Map<string, Map<string, Set<string>>>();
  const add = (region: string, key: string, target: string) => {
    const m = byRegion.get(region) ?? new Map<string, Set<string>>();
    byRegion.set(region, m);
    const s = m.get(key) ?? new Set<string>();
    s.add(target);
    m.set(key, s);
  };
  for (const l of locations) {
    const target = l.parent ? placeKey(l.region, l.parent) : placeKey(l.region, l.name);
    if (!pinned.has(target)) continue;
    add(l.region, normPlace(l.name), target);
    const plain = l.name.replace(DISAMBIG, "");
    if (plain !== l.name) add(l.region, normPlace(plain), target);
  }
  return { byRegion, pinned };
}

export type MethodClass = { kind: "counted"; label: string } | { kind: "excluded"; why: string } | { kind: "unknown"; why: string };

export function classifyMethod(m: string | undefined, versions: string[]): MethodClass {
  if (!m) return { kind: "unknown", why: "no method" };
  if (!(m in METHODS)) return { kind: "unknown", why: `method "${m}" isn't in the rules` };
  const label = METHODS[m];
  if (label === null) return { kind: "excluded", why: `method ${m}` };
  if (m === "Max Raid" && !versions.every((v) => MAX_RAID_VERSIONS.has(v))) return { kind: "unknown", why: "Max Raid outside Sword / Shield" };
  return { kind: "counted", label };
}

const OFF_MAP = new Set(OFF_MAP_PLACES.map(normPlace));
/** Rows whose place is a whole region ("Johto", "Kalos (Roaming)", "Wild Area"): roaming Pokémon, with no one spot. */
const WHOLE_REGION = /^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Kalos \(Roaming\)|Wild Area|(The )?Isle of Armor|(The )?Crown Tundra)$/;
export const isOffMap = (loc: string) => OFF_MAP.has(normPlace(loc)) || /^Ultra Space/.test(loc) || WHOLE_REGION.test(loc);

export type PlaceMatch = { kind: "place"; key: string; via: string } | { kind: "none"; why: string };

function lookup(idx: PlaceIndex, regions: string[], name: string): Set<string> {
  const hits = new Set<string>();
  for (const r of regions) for (const t of idx.byRegion.get(r)?.get(normPlace(name)) ?? []) hits.add(t);
  return hits;
}

/**
 * The one pinned place a row's `loc` names, for one version. Steps, each tried only when the
 * one before found nothing: the exact name; the alias table; without a "Sea " prefix
 * ("Sea Route 41"); without a region prefix ("Johto Safari Zone"). More than one hit at any
 * step is ambiguous: no match.
 */
export function matchPlace(idx: PlaceIndex, loc: string, version: string): PlaceMatch {
  if (version === "legends-za") return { kind: "place", key: placeKey(ZA_PLACE.region, ZA_PLACE.name), via: "Legends: Z-A is all Lumiose City" };
  const regions = VERSION_REGIONS[version];
  if (!regions) return { kind: "none", why: `unknown version ${version}` };
  if (!regions.length) return { kind: "none", why: `${version} isn't on the map` };
  const base = loc.replace(/ \([^()]*\)$/, "");
  const steps: [string, () => Set<string>][] = [
    ["name", () => lookup(idx, regions, loc)],
    ["name without its sub-area", () => (base !== loc ? lookup(idx, regions, base) : new Set())],
    [
      "alias",
      () => {
        const hits = new Set<string>();
        for (const a of PLACE_ALIASES)
          if (regions.includes(a.region) && normPlace(a.from) === normPlace(loc) && (!a.versions || a.versions.includes(version))) for (const t of lookup(idx, [a.region], a.to)) hits.add(t);
        return hits;
      },
    ],
    [
      // A few Pearl rows glue the sub-area on: "Route 210South", "Lost Tower1F", "Mt. CoronetRoute 211 Entrance".
      "without a glued-on sub-area",
      () => {
        const m = /^(.+?(?:[a-z](?=[A-Z0-9])|[0-9](?=[A-Z])))/.exec(loc);
        return m && m[1] !== loc ? lookup(idx, regions, m[1]) : new Set();
      },
    ],
    ["without 'Sea'", () => (/^Sea /.test(loc) ? lookup(idx, regions, loc.slice(4)) : new Set())],
    [
      "without the region prefix",
      () => {
        const m = /^(\S+) (.+)$/.exec(loc);
        const r = m && regions.find((x) => x.toLowerCase() === m[1].toLowerCase());
        return m && r ? lookup(idx, [r], m[2]) : new Set();
      },
    ],
  ];
  for (const [via, run] of steps) {
    const hits = run();
    if (hits.size === 1) return { kind: "place", key: [...hits][0], via };
    if (hits.size > 1) return { kind: "none", why: `"${loc}" names ${hits.size} places in ${regions.join(" / ")}: ${[...hits].join(", ")}` };
  }
  return { kind: "none", why: `"${loc}" isn't on the map in ${regions.join(" / ")}` };
}
