import type { GeoRegionInfo } from "./geo-types";

/** How PokéGuessr names the places it reveals (shared by the round result, the results map and the learn card). */

type Named = { name: string; parent?: string; region?: string };

/** "Saffron City", without the "Kanto " prefix routes carry. */
export const cleanPlaceName = (s: string) => s.replace(/^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea) (?=Route)/, "");
/** The in-game name, without the wiki's disambiguation ("Iron Ruins (Sinnoh)", "Victory Road (BW)"). */
export const shownPlaceName = (s: string) =>
  cleanPlaceName(s).replace(/ \((Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea|Generation [IVX]+|BW|B2W2|Jagged Pass)\)$/, "");

/** "Silph Co. · Saffron City", plus the region when the map doesn't make it obvious. */
export function placeLabel(answer: Named, map?: Pick<GeoRegionInfo, "name">): string {
  const name = answer.parent ? `${shownPlaceName(answer.name)} · ${shownPlaceName(answer.parent)}` : shownPlaceName(answer.name);
  return answer.region && map && answer.region !== map.name ? `${name}, ${answer.region}` : name;
}

/** The place on the world atlas (Kanto's own map predates the world data, so its places carry no region). */
export const atlasSearchHref = (answer: Named) => `/atlas?q=${encodeURIComponent(`${cleanPlaceName(answer.parent ?? answer.name)} · ${answer.region ?? "Kanto"}`)}`;

/** "2.4 map squares away", or spot on. */
export function squaresText(squares: number): string {
  if (squares === 0) return "Spot on";
  return `${squares.toFixed(1)} square${squares === 1 ? "" : "s"} away`;
}
