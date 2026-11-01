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

/** The great peaks: drawn taller. A peak not listed here is drawn at the standard height. */
const GREAT = new Set(["Mt. Silver", "Mt. Coronet", "Mount Lanakila", "Glaseado Mountain", "Mt. Chimney", "Stark Mountain"]);

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
}

export function isMountain(name: string): boolean {
  return !NOT_A_PEAK_RE.test(name) && (MOUNTAIN_RE.test(name) || SUMMIT_RE.test(name));
}

/** The atlas's mountains, from its places and town markers, each once. */
export function atlasMountains(atlas: { W: number; H: number; places: AtlasPoint[]; markers?: AtlasPoint[] }): GlobeMountain[] {
  const seen = new Set<string>();
  const out: GlobeMountain[] = [];
  for (const p of [...(atlas.markers ?? []), ...atlas.places]) {
    const key = `${p.name}|${p.region}`;
    if (seen.has(key) || !isMountain(p.name)) continue;
    seen.add(key);
    out.push({
      name: p.name,
      region: p.region,
      x: p.x,
      y: p.y,
      lon: lonOf(p.x, atlas.W),
      lat: latOf(p.y, atlas.W, atlas.H),
      scale: GREAT.has(p.name) ? 1 : p.name === "Spear Pillar" ? 0.55 : 0.68,
    });
  }
  return out;
}
