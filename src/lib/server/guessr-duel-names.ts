import "server-only";
import data from "@/data/geo.json";
import jaLocations from "@/data/i18n/ja/locations.json";
import esLocations from "@/data/i18n/es/locations.json";
import frLocations from "@/data/i18n/fr/locations.json";
import deLocations from "@/data/i18n/de/locations.json";
import itLocations from "@/data/i18n/it/locations.json";
import jaRegions from "@/data/i18n/ja/regions.json";
import esRegions from "@/data/i18n/es/regions.json";
import frRegions from "@/data/i18n/fr/regions.json";
import deRegions from "@/data/i18n/de/regions.json";
import itRegions from "@/data/i18n/it/regions.json";
import jaVersions from "@/data/i18n/ja/versions.json";
import esVersions from "@/data/i18n/es/versions.json";
import frVersions from "@/data/i18n/fr/versions.json";
import deVersions from "@/data/i18n/de/versions.json";
import itVersions from "@/data/i18n/it/versions.json";
import type { OtherLocale } from "@/i18n/config";
import { serverT } from "@/i18n/server";
import type { Keys } from "@/i18n/catalog";
import page from "@/messages/guessr-duel-page";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { nameKey, type GuessrNames } from "@/components/geo/duel-names";

/**
 * The names a duel or party page in another language sends its client components (components/geo/duel-names.ts):
 * the maps (from the page's messages), and the official names of the places, regions and games in PokéGuessr's
 * data (PokéAPI's, src/data/i18n). Only the page's own language travels, and only names the game can show.
 */
type Dict = Record<string, string>;
const LOCATIONS: Record<OtherLocale, Dict> = { ja: jaLocations, es: esLocations, fr: frLocations, de: deLocations, it: itLocations };
const REGIONS: Record<OtherLocale, Dict> = { ja: jaRegions, es: esRegions, fr: frRegions, de: deRegions, it: itRegions };
const VERSIONS: Record<OtherLocale, Dict> = { ja: jaVersions, es: esVersions, fr: frVersions, de: deVersions, it: itVersions };

type World = { locations: { name: string; parent?: string; region?: string; shots: { game?: string }[] }[] };
const WORLD = (data as unknown as { world: World }).world;

/** Every place, parent and region name PokéGuessr can reveal, and every game word in its screenshots' labels, by key. */
const KEYS = (() => {
  const places = new Set<string>();
  const games = new Set<string>();
  const strip = (s: string) => s.replace(/ \([^)]*\)$/, "").replace(/^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea) (?=Route)/, "");
  for (const l of WORLD.locations) {
    for (const n of [l.name, l.parent, l.region]) if (n) places.add(nameKey(strip(n)));
    for (const s of l.shots) {
      const parts = (s.game ?? "").split(" / ");
      for (const p of parts) {
        const k = nameKey(p);
        games.add(k);
        games.add(`letsgo${k}`);
      }
    }
  }
  return { places, games };
})();

const cached = new Map<OtherLocale, Omit<GuessrNames, "maps" | "gameSep">>();
function dictionaries(locale: OtherLocale): Omit<GuessrNames, "maps" | "gameSep"> {
  let d = cached.get(locale);
  if (!d) {
    const places: Dict = {};
    const t = serverT(page);
    for (const k of KEYS.places) {
      // A region's own name first (the maps' names, then PokéAPI's), then the place's.
      const map = `maps.${k}` as Keys<typeof page.en>;
      const name = (t.has(map) ? t(map) : undefined) ?? REGIONS[locale][k] ?? LOCATIONS[locale][k];
      if (name) places[k] = name;
    }
    const games: Dict = {};
    for (const k of KEYS.games) if (VERSIONS[locale][k]) games[k] = VERSIONS[locale][k];
    d = { places, games };
    cached.set(locale, d);
  }
  return d;
}

/** The names for a page in `locale` (undefined on English pages: they show the names as they are). */
export function guessrDuelNames(regions: GeoRegionInfo[]): GuessrNames | undefined {
  const t = serverT(page);
  if (t.locale === "en") return undefined;
  const maps: Dict = {};
  for (const r of regions) {
    const key = `maps.${r.id}` as Keys<typeof page.en>;
    if (t.has(key)) maps[r.id] = t(key);
  }
  return { maps, gameSep: t("gameSep"), ...dictionaries(t.locale) };
}
