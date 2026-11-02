/**
 * Which PokéGuessr screenshots the globe shows when a town or route label is
 * hovered. Pure (the route at /guessr/globe/shots.json feeds it the data),
 * so the rules below are unit-tested:
 *
 * - Only pictures the Pokédex's place pages already show: each place's
 *   most recent screenshot (src/lib/dex/places-data.ts), so the globe makes
 *   no new picture public. A town also shows the pictures of the buildings
 *   inside it, each from that building's own page.
 * - Never a Legends: Arceus / Legends: Z-A picture, nor anything in Hisui.
 *   When a place's newest picture is one of those it shows none, rather
 *   than an older picture no public page shows.
 * - Pictures go out under their preview name (an HMAC of the id, see
 *   previewUrl in src/lib/server/geo.ts), never the id a live round uses, and
 *   placeholders are re-encoded so they never equal a round's placeholder.
 */
import { isGeoFamily } from "@/lib/geo-families";
import { mostRecentShot, placeKey } from "@/lib/dex/places";

/** Legends games: PokéGuessr never deals or previews these on the globe. */
export const LEGENDS_FAMILIES: ReadonlySet<string> = new Set(["pla", "za"]);
export const LEGENDS_REGIONS: ReadonlySet<string> = new Set(["Hisui"]);
export const MAX_SHOTS_PER_PLACE = 5;

export interface GlobeShotInput {
  id: string;
  game: string;
  family?: string;
}
export interface GlobeLocationInput {
  name: string;
  region: string;
  parent?: string;
  shots: GlobeShotInput[];
}

/** One picture in a label's popup. */
export interface GlobeShot {
  /** The place it shows (the town itself, or a building in it). */
  n: string;
  /** Its game, as the place page captions it. */
  g: string;
  /** The preview URL (never the round's /api/geo/shot/:id). */
  src: string;
  /** A tiny placeholder image (data URI), when there is one. */
  b?: string;
}

/** Label key ("Name · Region", the atlas query) to its pictures, the label's own place first. */
export type GlobeShotIndex = Record<string, GlobeShot[]>;

export function isLegendsShot(shot: { family?: string; game?: string }, region: string): boolean {
  return LEGENDS_REGIONS.has(region) || LEGENDS_FAMILIES.has(shot.family ?? "") || /^Legends\b/i.test(shot.game ?? "");
}

/** The picture a place's Pokédex page shows, or null (none, or a Legends one). */
export function publicShotOf(l: GlobeLocationInput): (GlobeShotInput & { family: string }) | null {
  const shots = l.shots.filter((s): s is GlobeShotInput & { family: string } => isGeoFamily(s.family));
  const s = mostRecentShot(shots);
  return s && !isLegendsShot(s, l.region) ? s : null;
}

export function buildGlobeShotIndex(
  locations: readonly GlobeLocationInput[],
  opts: { preview(id: string): string; placeholder?(id: string): string | undefined; skip?: ReadonlySet<string>; max?: number },
): GlobeShotIndex {
  const max = opts.max ?? MAX_SHOTS_PER_PLACE;
  const groups = new Map<string, { own: boolean; name: string; shot: GlobeShotInput }[]>();
  for (const l of locations) {
    const s = publicShotOf(l);
    if (!s || opts.skip?.has(s.id)) continue;
    const key = placeKey({ name: l.parent ?? l.name, region: l.region });
    const list = groups.get(key) ?? [];
    list.push({ own: !l.parent, name: l.name, shot: s });
    groups.set(key, list);
  }
  const out: GlobeShotIndex = {};
  for (const [key, list] of groups) {
    list.sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name, "en", { numeric: true }));
    const seen = new Set<string>();
    const shots: GlobeShot[] = [];
    for (const { name, shot } of list) {
      const src = opts.preview(shot.id);
      if (seen.has(src)) continue;
      seen.add(src);
      const b = opts.placeholder?.(shot.id);
      shots.push({ n: name, g: shot.game, src, ...(b ? { b } : {}) });
      if (shots.length >= max) break;
    }
    if (shots.length) out[key] = shots;
  }
  return out;
}
