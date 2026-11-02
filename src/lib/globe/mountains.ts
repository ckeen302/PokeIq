/**
 * The mountains that rise off the globe: every atlas place the Pokédex's
 * place types call a mountain (the same name rule as src/lib/dex/places.ts),
 * plus the summits and volcanoes the atlas names. Positions are the atlas
 * pins, never placed by hand; only the height is a matter of style.
 * Client-safe.
 */
import { latOf, lonOf, type AtlasPoint } from "./geo";

/** The Places tab's Mountain rule, and named summits/volcanoes. */
const MOUNTAIN_RE = /\b(Mt\.|Mount\b|Mountain\b)/;
const SUMMIT_RE = /\b(Volcano|Spear Pillar)\b/;
/** Tunnels and caves through a mountain stay caves. */
const NOT_A_PEAK_RE = /\b(Tunnel|Cave|Cavern|Path to)\b/;

/** The great peaks: drawn taller, with snow. A peak not listed here is drawn at the standard height. */
const GREAT = new Set(["Mt. Silver", "Mt. Coronet", "Mount Lanakila", "Glaseado Mountain", "Mt. Chimney", "Stark Mountain"]);
const VOLCANO_RE = /Chimney|Volcano|Ember/;

/** Footprint radius and summit height on the unit globe: the great peaks, the rest, and Spear Pillar (a ruin on a summit). */
const BASE_GREAT = 0.011, BASE = 0.008, BASE_SMALL = 0.006;
const TALL_GREAT = 0.03, TALL = 0.019, TALL_SMALL = 0.013;
/** A peak squeezed by a close neighbour keeps most of its height (a slimmer spire), up to this height-to-radius ratio. */
const MAX_SLENDER = 3.6;
/** A footprint never reaches past this share of the way to the nearest other place's pin. */
export const PIN_CLEARANCE = 0.75;
/** Pins closer than this to a peak's pin share its spot (the label layout keeps one of them); they don't shrink it. */
const SAME_SPOT = 1e-4;

export interface GlobeMountain {
  name: string;
  region: string;
  /** The atlas pin. */
  x: number;
  y: number;
  lon: number;
  lat: number;
  /** Relative height: 1 for the great peaks, less for the rest. */
  scale: number;
  /** Footprint radius and summit height, on a globe of radius 1. */
  radius: number;
  height: number;
  volcano: boolean;
  /** Snow-capped (the great peaks that aren't volcanoes). */
  snow: boolean;
}

export function isMountain(name: string): boolean {
  return !NOT_A_PEAK_RE.test(name) && (MOUNTAIN_RE.test(name) || SUMMIT_RE.test(name));
}

/** Great-circle angle between two lon/lat points, in radians (the distance on a globe of radius 1). */
export function arc(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const d = Math.PI / 180;
  const s = Math.sin(((lat2 - lat1) * d) / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lon2 - lon1) * d) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The atlas's mountains, from its places and town markers, each once. */
export function atlasMountains(atlas: { W: number; H: number; places: AtlasPoint[]; markers?: AtlasPoint[] }): GlobeMountain[] {
  const pins = [...(atlas.markers ?? []), ...atlas.places];
  const ll = pins.map((p) => [lonOf(p.x, atlas.W), latOf(p.y, atlas.W, atlas.H)]);
  const seen = new Set<string>();
  const out: GlobeMountain[] = [];
  pins.forEach((p, i) => {
    const key = `${p.name}|${p.region}`;
    if (seen.has(key) || !isMountain(p.name)) return;
    seen.add(key);
    const [lon, lat] = ll[i];
    // The nearest other place: the footprint stops well short of its pin, so the peak never sits on its label.
    let near = Infinity;
    pins.forEach((q, j) => {
      if (q.name === p.name && q.region === p.region) return;
      const d = arc(lon, lat, ll[j][0], ll[j][1]);
      if (d > SAME_SPOT && d < near) near = d;
    });
    const great = GREAT.has(p.name);
    const volcano = VOLCANO_RE.test(p.name);
    const radius = Math.min(great ? BASE_GREAT : p.name === "Spear Pillar" ? BASE_SMALL : BASE, near * PIN_CLEARANCE);
    out.push({
      name: p.name,
      region: p.region,
      x: p.x,
      y: p.y,
      lon,
      lat,
      scale: great ? 1 : p.name === "Spear Pillar" ? 0.55 : 0.68,
      radius,
      // Slim: taller than wide, and low (the great peaks under 0.04 of the globe's radius).
      height: Math.min(great ? TALL_GREAT : p.name === "Spear Pillar" ? TALL_SMALL : TALL, radius * MAX_SLENDER),
      volcano,
      snow: great && !volcano,
    });
  });
  return out;
}
