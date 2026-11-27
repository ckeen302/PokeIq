/**
 * The globe's coordinates: atlas pixels (src: public/atlas/atlas.json, the
 * same space as the World Atlas and geo.json's world map) to degrees. Client-safe.
 *
 * Laid flat on the sphere as is (the atlas with sea padding above and below, its frame at about 79°N–79°S), the
 * land would only reach 70°N and 73°S, leaving an empty cap of sea round each pole, the north one right under the
 * landing's trainer. So the globe stretches the atlas north–south, uniformly: the land runs from GLOBE_LAND_N to
 * GLOBE_LAND_S. Every region keeps its place against the others (one straight scale of latitude, the same for every
 * point), and longitude is unchanged. Only the globe uses this: the flat maps, the guesses and their scoring don't.
 *
 * Everything the globe puts on the world (the mask, the generation map, pins, names, peaks, lights, fly-to targets)
 * goes through latOf / uvOf, so it all stays on the land.
 */

/** The land's extent on the atlas laid flat (the padded equirectangular texture): its northmost and southmost row. */
export const ATLAS_LAND_N = 70.31;
export const ATLAS_LAND_S = -73.3;
/** Where the globe puts them (much further north, and Sinnoh's north coast pinches into slivers at the pole). */
export const GLOBE_LAND_N = 80;
export const GLOBE_LAND_S = -80;

const K = (GLOBE_LAND_N - GLOBE_LAND_S) / (ATLAS_LAND_N - ATLAS_LAND_S);
const B = GLOBE_LAND_N - K * ATLAS_LAND_N;

/** The atlas laid flat (padded, unstretched): a pixel row's latitude. */
export const flatLatOf = (y: number, W: number, H: number) => 90 - ((y + (W / 2 - H) / 2) / (W / 2)) * 180;
/** A flat latitude, stretched onto the globe (the north–south stretch; past a pole only open sea, held at it). */
export const stretchLat = (lat: number) => Math.max(-90, Math.min(90, K * lat + B));
/** ...and back: the flat latitude a globe latitude came from. */
export const unstretchLat = (lat: number) => (lat - B) / K;

export const lonOf = (x: number, W: number) => (x / W) * 360 - 180;
export const latOf = (y: number, W: number, H: number) => stretchLat(flatLatOf(y, W, H));

/** Texture coordinates (0..1, v down) of an atlas pixel on the globe's equirectangular textures. */
export const uvOf = (x: number, y: number, W: number, H: number): [number, number] => [x / W, (90 - latOf(y, W, H)) / 180];

export interface AtlasRegion {
  name: string;
  tier: number;
  x: number;
  y: number;
  parent?: string;
}
export interface AtlasPoint {
  name: string;
  region: string;
  x: number;
  y: number;
  kind: string;
}
export interface Atlas {
  W: number;
  H: number;
  regions: AtlasRegion[];
  markers: AtlasPoint[];
  places: AtlasPoint[];
}
