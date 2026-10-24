/**
 * PokéGuessr's themed maps: the whole world, played on one kind of place
 * (Gyms, caves, towns…). Each is a map of its own, with its own boards
 * (its id is the board key's map part). Which places each plays is in
 * src/data/geo-themes.json (scripts/geo/themes.ts writes it).
 */
import { WORLD_REGION } from "./geo-types";

export const GEO_THEME_IDS = ["gyms", "caves", "towns", "routes", "water", "forests", "legendary"] as const;
export type GeoThemeId = (typeof GEO_THEME_IDS)[number];

export interface GeoTheme {
  id: GeoThemeId;
  name: string;
  /** One line for the map picker. */
  blurb: string;
}

export const GEO_THEMES: GeoTheme[] = [
  { id: "gyms", name: "Gyms", blurb: "Every Gym, from Pewter to Montenevera (Galar's Gym stadiums too)." },
  { id: "caves", name: "Caves", blurb: "Caves, mines and tunnels: find your way out." },
  { id: "towns", name: "Towns and Cities", blurb: "Every town and city, from Pallet to Mesagoza." },
  { id: "routes", name: "Routes", blurb: "The numbered routes between them." },
  { id: "water", name: "Water and Coasts", blurb: "Seas, bays, lakes and beaches." },
  { id: "forests", name: "Forests", blurb: "Woods, jungles and thickets." },
  { id: "legendary", name: "Legendary spots", blurb: "Where the legends wait." },
];

/** A theme's map id: "theme-caves". */
export const themeMapId = (id: GeoThemeId) => `theme-${id}`;

/** The theme a map id plays, or null for the world and the regions. */
export function themeOf(mapId: string): GeoTheme | null {
  return mapId.startsWith("theme-") ? (GEO_THEMES.find((t) => `theme-${t.id}` === mapId) ?? null) : null;
}

/** Maps on the whole world (the world itself and every theme): scored and dealt like the world map. */
export const isWorldwide = (mapId: string) => mapId === WORLD_REGION || themeOf(mapId) !== null;
