import "server-only";
import jaLocations from "@/data/i18n/ja/locations.json";
import esLocations from "@/data/i18n/es/locations.json";
import frLocations from "@/data/i18n/fr/locations.json";
import deLocations from "@/data/i18n/de/locations.json";
import itLocations from "@/data/i18n/it/locations.json";
import jaVersions from "@/data/i18n/ja/versions.json";
import esVersions from "@/data/i18n/es/versions.json";
import frVersions from "@/data/i18n/fr/versions.json";
import deVersions from "@/data/i18n/de/versions.json";
import itVersions from "@/data/i18n/it/versions.json";
import jaMoves from "@/data/i18n/ja/moves.json";
import esMoves from "@/data/i18n/es/moves.json";
import frMoves from "@/data/i18n/fr/moves.json";
import deMoves from "@/data/i18n/de/moves.json";
import itMoves from "@/data/i18n/it/moves.json";
import jaItems from "@/data/i18n/ja/items.json";
import esItems from "@/data/i18n/es/items.json";
import frItems from "@/data/i18n/fr/items.json";
import deItems from "@/data/i18n/de/items.json";
import itItems from "@/data/i18n/it/items.json";
import jaAbilities from "@/data/i18n/ja/abilities.json";
import esAbilities from "@/data/i18n/es/abilities.json";
import frAbilities from "@/data/i18n/fr/abilities.json";
import deAbilities from "@/data/i18n/de/abilities.json";
import itAbilities from "@/data/i18n/it/abilities.json";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";
import type { Locale, OtherLocale } from "@/i18n/config";
import { serverT } from "@/i18n/server";
import geoNamesNs from "@/messages/geo-names";
import { localGame, localRegion, nameKey } from "@/lib/geo-i18n";
import { cleanPlaceName } from "@/lib/geo-names";
import { speciesName } from "@/lib/names/species";
import { VERSION_BY_KEY } from "@/lib/pokemon/encounter-types";

/**
 * The official names the Places and Trainers pages show, in the render's language (server only): places, regions,
 * games and versions, moves, items, abilities and species, from src/data/i18n (PokéAPI) and the geo-names messages.
 * A name the language's data doesn't have stays English (nothing is made up); on an English page every name comes
 * back exactly as given.
 */

type Dict = Record<string, string>;
const DATA: Record<OtherLocale, { places: Dict; versions: Dict; moves: Dict; items: Dict; abilities: Dict; types: Dict }> = {
  ja: { places: jaLocations, versions: jaVersions, moves: jaMoves, items: jaItems, abilities: jaAbilities, types: jaTypes },
  es: { places: esLocations, versions: esVersions, moves: esMoves, items: esItems, abilities: esAbilities, types: esTypes },
  fr: { places: frLocations, versions: frVersions, moves: frMoves, items: frItems, abilities: frAbilities, types: frTypes },
  de: { places: deLocations, versions: deVersions, moves: deMoves, items: deItems, abilities: deAbilities, types: deTypes },
  it: { places: itLocations, versions: itVersions, moves: itMoves, items: itItems, abilities: itAbilities, types: itTypes },
};

export interface DexNames {
  locale: Locale;
  /** A place ("Saffron City", "Route 24", "Pokémon Mansion (Kanto)"). */
  place: (name: string) => string;
  /** A region ("Kanto", "Isle of Armor"). */
  region: (name: string) => string;
  /** A version by its key ("firered"), from its English name when the data has no key. */
  version: (key: string) => string;
  /** A version's official name by its English name ("FireRed"), or undefined when the language's data has none. */
  versionOf: (english: string) => string | undefined;
  /** A game label made of version names ("FireRed / LeafGreen", "Red & Blue"). */
  game: (label: string) => string;
  /** A list of games as the gym list writes it ("Red, Blue and Yellow"). */
  gameList: (label: string) => string;
  /** A game given by its version keys, joined like the English label ("Red & Blue"). */
  versions: (keys: string[], english: string, sep?: string) => string;
  move: (english: string) => string;
  /** A move's official name, or undefined when the language's data has none. */
  moveOf: (english: string) => string | undefined;
  item: (english: string) => string;
  ability: (english: string) => string;
  /** A type ("Rock"). */
  type: (english: string) => string;
  species: (id: number, english: string) => string;
}

const ENGLISH: DexNames = {
  locale: "en",
  place: (n) => n,
  region: (n) => n,
  version: (k) => VERSION_BY_KEY[k]?.name ?? k,
  versionOf: (n) => n,
  game: (l) => l,
  gameList: (l) => l,
  versions: (_k, english) => english,
  move: (n) => n,
  moveOf: (n) => n,
  item: (n) => n,
  ability: (n) => n,
  type: (n) => n,
  species: (_id, n) => n,
};

const REGION_SUFFIX = / \(([^)]+)\)$/;

/** The names in the render's language. */
export function dexNames(): DexNames {
  const t = serverT(geoNamesNs);
  const locale = t.locale;
  if (locale === "en") return ENGLISH;
  const d = DATA[locale];
  const versionKey = (k: string) => nameKey(VERSION_BY_KEY[k]?.name ?? k.replace(/-/g, ""));
  const version = (k: string) => d.versions[versionKey(k)] ?? d.versions[nameKey(k)] ?? VERSION_BY_KEY[k]?.name ?? k;
  const region = (n: string) => localRegion(t, n);
  const place = (name: string): string => {
    const own = d.places[nameKey(name)];
    if (own) return own;
    const route = /^(?:Sea )?Route (\d+)$/.exec(name);
    if (route) return d.places[`route${route[1]}`] ?? t("route", { n: route[1] });
    // "Kanto Route 1", "Iron Ruins (Sinnoh)": the place's own name, with its region when the English gave one.
    const clean = cleanPlaceName(name);
    if (clean !== name) return place(clean);
    const suffix = REGION_SUFFIX.exec(name);
    if (suffix) {
      const base = name.slice(0, suffix.index);
      const local = place(base);
      if (local !== base) return `${local} (${region(suffix[1])})`;
    }
    // "Black City / White Forest"
    if (name.includes(" / ")) {
      const parts = name.split(" / ");
      const names = parts.map(place);
      if (names.some((n, i) => n !== parts[i])) return names.join(" / ");
    }
    return name;
  };
  return {
    locale,
    place,
    region,
    version,
    versionOf: (n) => d.versions[nameKey(n)],
    game: (label) => {
      const own = localGame(t, label);
      if (own !== label) return own;
      const parts = label.split(" / ").map((p) => d.versions[nameKey(p)]);
      return parts.every(Boolean) ? parts.join(" / ") : label;
    },
    gameList: (label) => {
      const parts = label.split(/, | and /).map((p) => d.versions[nameKey(p)]);
      return parts.every(Boolean) ? new Intl.ListFormat(locale, { type: "conjunction" }).format(parts) : label;
    },
    versions: (keys, english, sep = " & ") => {
      const names = keys.map((k) => d.versions[versionKey(k)]);
      return names.every(Boolean) ? names.join(sep) : english;
    },
    move: (n) => d.moves[nameKey(n)] ?? n,
    moveOf: (n) => d.moves[nameKey(n)],
    item: (n) => d.items[nameKey(n)] ?? n,
    ability: (n) => d.abilities[nameKey(n)] ?? n,
    type: (n) => d.types[nameKey(n)] ?? n,
    species: (id, n) => speciesName(id, n, locale),
  };
}
