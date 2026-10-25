/**
 * Pure helpers behind the Pokédex Places tab (no I/O, safe in the browser):
 * place slugs, the place type read from the atlas data, the screenshot to
 * show, and the encounter rows inverted from species to places.
 */
import { slugify } from "./build";
import { familyRank } from "@/lib/geo-families";
import { versionOrder, type EncGen } from "@/lib/pokemon/encounter-types";

export const PLACE_TYPES = ["City", "Town", "Route", "Gym", "Forest", "Cave", "Mountain", "Island", "Lake", "Tower", "Ruins", "League", "Building", "Other"] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

/** "Name · Region": the atlas's search query and the encounter rows' `a` field. */
export const placeKey = (p: { name: string; region: string }) => `${p.name} · ${p.region}`;
export const placeSlug = (p: { name: string; region: string }) => `${slugify(p.name)}-${slugify(p.region)}`;
/** Slug from an atlas key ("Route 1 · Kanto"). */
export function slugFromKey(key: string): string | null {
  const i = key.lastIndexOf(" · ");
  return i > 0 ? placeSlug({ name: key.slice(0, i), region: key.slice(i + 3) }) : null;
}

export interface PlaceTags {
  /** "Region|Name" keys from geo-themes.json. */
  gyms: ReadonlySet<string>;
  towns: ReadonlySet<string>;
  routes: ReadonlySet<string>;
}

const NAME_RULES: [RegExp, PlaceType][] = [
  [/\b(Gym|Stadium)$/, "Gym"],
  [/\b(Forest|Woods)\b/, "Forest"],
  [/\b(Cave|Cavern|Caverns|Tunnel|Grotto)\b/, "Cave"],
  [/\b(Mt\.|Mount\b|Mountain\b)/, "Mountain"],
  [/\b(Island|Isle|Islands)\b/, "Island"],
  [/\b(Lake|Pond)\b/, "Lake"],
  [/\bTower\b/, "Tower"],
  [/\bRuins\b/, "Ruins"],
  [/\bLeague\b/, "League"],
];

/**
 * A place's type, only from what the data says: the PokéGuessr theme lists
 * (Gyms, Towns, Routes), then a name suffix/keyword; a building inside a town
 * is "Building"; anything else is "Other".
 */
export function placeType(p: { name: string; region: string; parent?: string }, tags: PlaceTags): PlaceType {
  const k = `${p.region}|${p.name}`;
  if (tags.gyms.has(k)) return "Gym";
  if (tags.routes.has(k) || /^Route \d+$/.test(p.name)) return "Route";
  if (/\bCity$/.test(p.name)) return "City";
  if (/\bTown$/.test(p.name)) return "Town";
  if (tags.towns.has(k)) return "Town";
  for (const [re, t] of NAME_RULES) if (re.test(p.name)) return t;
  return p.parent ? "Building" : "Other";
}

export interface ShotRef {
  id: string;
  game: string;
  family: string;
}

/** The screenshot from the most recent game (release order of the families); the first one on a tie. */
export function mostRecentShot<T extends ShotRef>(shots: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of shots) if (familyRank(s.family) >= 0 && (!best || familyRank(s.family) > familyRank(best.family))) best = s;
  return best;
}

/** One wild encounter at a place: [species id, versions, method, levels, rate, morning/day/night, note]. */
export interface PlaceEncounter {
  id: number;
  v: string[];
  m?: string;
  lv?: string;
  r?: string;
  t?: [string, string, string];
  n?: string;
}

/** Inverts species encounter files into place key -> rows (only rows the atlas matched confidently). */
export function invertEncounters(files: Iterable<[number, EncGen[]]>): { byPlace: Map<string, PlaceEncounter[]>; matched: Set<string>; unmatched: Set<string> } {
  const byPlace = new Map<string, PlaceEncounter[]>();
  const matched = new Set<string>();
  const unmatched = new Set<string>();
  for (const [id, gens] of files) {
    for (const g of gens) {
      for (const r of g.rows) {
        if (r.x || !r.loc) continue;
        if (!r.a) {
          unmatched.add(r.loc);
          continue;
        }
        matched.add(r.loc);
        const list = byPlace.get(r.a) ?? [];
        const e: PlaceEncounter = { id, v: r.v };
        if (r.m) e.m = r.m;
        if (r.lv) e.lv = r.lv;
        if (r.r) e.r = r.r;
        if (r.t) e.t = r.t;
        if (r.n) e.n = r.n;
        list.push(e);
        byPlace.set(r.a, list);
      }
    }
  }
  for (const n of matched) unmatched.delete(n);
  return { byPlace, matched, unmatched };
}

/** A place's rows grouped by game (the row's version set), oldest game first; Pokémon in dex order inside. */
export function groupByGame(rows: readonly PlaceEncounter[]): { versions: string[]; rows: PlaceEncounter[] }[] {
  const groups = new Map<string, PlaceEncounter[]>();
  for (const r of rows) {
    const k = r.v.join(",");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([k, rs]) => ({ versions: k.split(","), rows: [...rs].sort((a, b) => a.id - b.id || (a.m ?? "").localeCompare(b.m ?? "")) }))
    .sort((a, b) => versionOrder(a.versions[0]) - versionOrder(b.versions[0]) || a.versions.length - b.versions.length);
}
