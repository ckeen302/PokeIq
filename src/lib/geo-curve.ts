import { GEO_FALLOFF, GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";

/**
 * PokéGuessr's scoring curve (GeoGuessr's): `max · e^(−10 · d / D)`, with d the pin's distance to the
 * place's area and D the map's diagonal, both in map pixels, and full points within `perfectPx` (half a
 * town-map square). Whole points. Client safe and pure: the game's server grades with it, and so does
 * Pokémon Hunt's.
 */
export function geoCurveScore(px: number, diagonal: number, perfectPx: number, max = GEO_MAX_ROUND_SCORE): number {
  if (!Number.isFinite(px) || !(diagonal > 0)) return 0;
  if (px <= perfectPx) return max;
  return Math.round(max * Math.exp((-GEO_FALLOFF * px) / diagonal));
}
