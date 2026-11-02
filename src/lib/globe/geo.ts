/**
 * The globe's coordinates: atlas pixels (src: public/atlas/atlas.json, the
 * same space as the World Atlas and geo.json's world map) to degrees. The
 * equirectangular globe texture is the atlas with sea padding above and
 * below, so a pixel's latitude counts that padding. Client-safe.
 */

export const lonOf = (x: number, W: number) => (x / W) * 360 - 180;
export const latOf = (y: number, W: number, H: number) => 90 - ((y + (W / 2 - H) / 2) / (W / 2)) * 180;

/** Texture coordinates (0..1, v down) of an atlas pixel on the padded globe texture. */
export const uvOf = (x: number, y: number, W: number, H: number): [number, number] => [x / W, (y + (W / 2 - H) / 2) / (W / 2)];

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
