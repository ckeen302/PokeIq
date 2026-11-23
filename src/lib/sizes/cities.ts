/**
 * The cities Pokémon Sizes can stand its line in. Client-safe and pure.
 *
 * - Lumiose City (Kalos): the default, a sunny late morning on the Grand
 *   Boulevard and round Prism Tower.
 * - Nimbasa City (Unova): the city of entertainment at night, down its main
 *   promenade and round the great Ferris wheel.
 *
 * The city rides on the address as ?city=nimbasa (nothing for the default),
 * so a shared link opens in the same city. Like ?vs=, it is read in the
 * browser: every page is one cached page whatever the city.
 */

export const CITY_IDS = ["lumiose", "nimbasa"] as const;
export type CityId = (typeof CITY_IDS)[number];
export const DEFAULT_CITY: CityId = "lumiose";
export const CITY_PARAM = "city";

/** A city from the address (any case, surrounding spaces ignored), or the default. */
export function parseCity(raw: string | null | undefined): CityId {
  const k = (raw ?? "").trim().toLowerCase();
  return (CITY_IDS as readonly string[]).includes(k) ? (k as CityId) : DEFAULT_CITY;
}

/** A path with the city's query added (nothing for the default; it may already have a query). */
export function withCity(path: string, city: CityId): string {
  if (city === DEFAULT_CITY) return path;
  const hash = path.indexOf("#");
  const base = hash >= 0 ? path.slice(0, hash) : path;
  const tail = hash >= 0 ? path.slice(hash) : "";
  return `${base}${base.includes("?") ? "&" : "?"}${CITY_PARAM}=${city}${tail}`;
}

/** The same address with its city set (an existing ?city= replaced or removed); the rest of the query is kept exactly as written (?vs=a,b stays readable). */
export function setCityInUrl(href: string, city: CityId): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = noHash.indexOf("?");
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const parts = (qAt >= 0 ? noHash.slice(qAt + 1) : "").split("&").filter((p) => p && p.split("=")[0] !== CITY_PARAM);
  if (city !== DEFAULT_CITY) parts.push(`${CITY_PARAM}=${city}`);
  return `${path}${parts.length ? `?${parts.join("&")}` : ""}${hash}`;
}

/** A video's file-name slug in a city (the default's is unchanged). */
export const citySlug = (slug: string, city: CityId) => (city === DEFAULT_CITY ? slug : `${slug}-${city}`);
