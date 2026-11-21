import { DEFAULT_LOCALE } from "@/i18n/config";
import type { Keys, Translator } from "@/i18n/catalog";
import type geoNamesNs from "@/messages/geo-names";
import { WORLD_REGION } from "./geo-types";
import { themeOf } from "./geo-themes";
import { geoFamily, type GeoEra, type GeoFamilyId } from "./geo-families";
import type { GeoDifficulty } from "./geo-difficulty";

/**
 * PokéGuessr's names in the page's language, given the geo-names translator (server or browser): regions and games
 * (the geo-names messages, PokéAPI's official names), places (a language's locations.json, see geo-i18n-client.ts),
 * and the themed maps, eras and difficulties. On an English page every name comes back exactly as given. Places only
 * ever pass through here after the reveal: nothing names a place before it.
 */

export type GeoNamesT = Translator<typeof geoNamesNs.en>;
type NameKey = Keys<typeof geoNamesNs.en>;

/** How src/data/i18n keys a name: the English, without accents, lowercase letters and digits only. */
export const nameKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const own = (t: GeoNamesT, key: string): string | null => (t.has(key) ? t(key as NameKey) : null);

/** A region ("Kanto", "Isle of Armor") in the language; English, or a region with no official name there, as given. */
export function localRegion(t: GeoNamesT, name: string): string {
  if (t.locale === DEFAULT_LOCALE) return name;
  return own(t, `regions.${nameKey(name)}`) ?? name;
}

/** A map's name: the world, a themed map or a region. English keeps the map's own name. */
export function localMap(t: GeoNamesT, map: { id: string; name: string }): string {
  if (t.locale === DEFAULT_LOCALE) return map.name;
  if (map.id === WORLD_REGION) return t("world");
  const theme = themeOf(map.id);
  if (theme) return t(`themes.${theme.id}.name`);
  return localRegion(t, map.name);
}

/** A screenshot's game label ("FireRed / LeafGreen", "Crystal") in the language's official titles. */
export function localGame(t: GeoNamesT, label: string): string {
  if (t.locale === DEFAULT_LOCALE) return label;
  const parts = label === "Let's Go, Pikachu! / Eevee!" ? ["letsgopikachu", "letsgoeevee"] : label.split(" / ").map(nameKey);
  const names = parts.map((k) => own(t, `games.${k}`));
  return names.every(Boolean) ? names.join(" / ") : label;
}

export const localFamily = (t: GeoNamesT, id: GeoFamilyId) => localGame(t, geoFamily(id).name);
export const localEra = (t: GeoNamesT, era: GeoEra | "all") => t(`eras.${era}`);
export const localDifficulty = (t: GeoNamesT, d: GeoDifficulty) => t(`difficulty.${d}.name`);

/** A place's official name in the language, a numbered route by the games' pattern, else the English name. */
export function localPlace(t: GeoNamesT, places: Record<string, string> | null, name: string): string {
  if (t.locale === DEFAULT_LOCALE) return name;
  const found = places?.[nameKey(name)];
  if (found) return found;
  const route = /^Route (\d+)$/.exec(name);
  return route ? t("route", { n: route[1] }) : name;
}
