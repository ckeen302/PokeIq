"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, type Locale, type OtherLocale } from "@/i18n/config";
import { useT } from "@/i18n/client";
import geoNamesNs from "@/messages/geo-names";
import type { GeoEra } from "./geo-families";
import type { GeoDifficulty } from "./geo-difficulty";
import { placeLabel, type PlaceLocal } from "./geo-names";
import { localDifficulty, localEra, localGame, localMap, localPlace, localRegion } from "./geo-i18n";

/**
 * PokéGuessr's names in the browser, in the page's language (see geo-i18n.ts). Place names come from that language's
 * locations.json, fetched on its own once a game page is up (only the page's language is ever fetched, and an English
 * page fetches nothing).
 */

const LOADERS: Record<OtherLocale, () => Promise<{ default: Record<string, string> }>> = {
  ja: () => import("@/data/i18n/ja/locations.json"),
  es: () => import("@/data/i18n/es/locations.json"),
  fr: () => import("@/data/i18n/fr/locations.json"),
  de: () => import("@/data/i18n/de/locations.json"),
  it: () => import("@/data/i18n/it/locations.json"),
};
const placeCache = new Map<Locale, Record<string, string>>();
const placeLoads = new Map<Locale, Promise<Record<string, string> | null>>();

export function loadPlaceNames(locale: Locale): Promise<Record<string, string> | null> {
  if (locale === DEFAULT_LOCALE) return Promise.resolve(null);
  let p = placeLoads.get(locale);
  if (!p) {
    p = LOADERS[locale]()
      .then((m) => {
        placeCache.set(locale, m.default);
        return m.default;
      })
      .catch(() => null);
    placeLoads.set(locale, p);
  }
  return p;
}

/** The page language's place names (null on English, and until they've arrived). */
export function usePlaceNames(locale: Locale): Record<string, string> | null {
  const [names, setNames] = useState<Record<string, string> | null>(() => placeCache.get(locale) ?? null);
  useEffect(() => {
    if (locale === DEFAULT_LOCALE || names) return;
    let off = false;
    void loadPlaceNames(locale).then((n) => !off && setNames(n));
    return () => {
      off = true;
    };
  }, [locale, names]);
  return names;
}

export interface GeoLocal extends PlaceLocal {
  region: (name: string) => string;
  map: (map: { id: string; name: string }) => string;
  game: (label: string) => string;
  era: (era: GeoEra | "all") => string;
  difficulty: (d: GeoDifficulty) => string;
  /** "Silph Co. · Saffron City", plus the region when the map doesn't make it obvious. */
  placeLabel: (answer: { name: string; parent?: string; region?: string }, map?: { name: string }) => string;
}

/** PokéGuessr's names in the page's language; on another language, its place names are fetched once. */
export function useGeoNames(): GeoLocal {
  const t = useT(geoNamesNs);
  const places = usePlaceNames(t.locale);
  return useMemo(() => {
    const local: GeoLocal = {
      region: (name) => localRegion(t, name),
      map: (map) => localMap(t, map),
      game: (label) => localGame(t, label),
      era: (era) => localEra(t, era),
      difficulty: (d) => localDifficulty(t, d),
      place: (name) => localPlace(t, places, name),
      join: (place, region) => (t.locale === DEFAULT_LOCALE ? `${place}, ${region}` : t("placeIn", { place, region })),
      placeLabel: (answer, map) => placeLabel(answer, map, local),
    };
    return local;
  }, [t, places]);
}
