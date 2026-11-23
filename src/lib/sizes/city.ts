/**
 * Which city Pokémon Sizes stands its line in: the sunny Lumiose City
 * tribute (the default) or Castelia City at dusk. Client-safe and pure.
 *
 * The city rides in the address as ?city=castelia (Lumiose has no query),
 * so a shared link, a reload or a video made from the page all open in the
 * same city. Anything unknown is Lumiose.
 */

export type CityId = "lumiose" | "castelia";

export const CITIES: readonly CityId[] = ["lumiose", "castelia"] as const;
export const DEFAULT_CITY: CityId = "lumiose";
export const CITY_PARAM = "city";

/** The city an address asks for (?city=castelia); anything else is Lumiose. */
export function parseCity(raw: string | string[] | null | undefined): CityId {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  return v === "castelia" ? "castelia" : DEFAULT_CITY;
}

/** The city in a full or relative URL's query. */
export function cityFromUrl(href: string): CityId {
  try {
    return parseCity(new URL(href, "https://x.invalid").searchParams.get(CITY_PARAM));
  } catch {
    return DEFAULT_CITY;
  }
}

/**
 * A path (which may already have a query: ?vs=, ?by=) with the city set:
 * Castelia adds ?city=castelia, Lumiose takes any city off. The rest of the
 * query and any #hash stay as they were.
 */
export function withCity(path: string, city: CityId): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const qAt = base.indexOf("?");
  const pathname = qAt >= 0 ? base.slice(0, qAt) : base;
  const parts = (qAt >= 0 ? base.slice(qAt + 1) : "").split("&").filter((p) => p && p.split("=")[0] !== CITY_PARAM);
  if (city !== DEFAULT_CITY) parts.push(`${CITY_PARAM}=${city}`);
  return `${pathname}${parts.length ? `?${parts.join("&")}` : ""}${hash}`;
}
