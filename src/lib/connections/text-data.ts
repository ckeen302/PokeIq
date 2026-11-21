import SPECIES from "@/data/species-names.json";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";
import jaAbilities from "@/data/i18n/ja/abilities.json";
import esAbilities from "@/data/i18n/es/abilities.json";
import frAbilities from "@/data/i18n/fr/abilities.json";
import deAbilities from "@/data/i18n/de/abilities.json";
import itAbilities from "@/data/i18n/it/abilities.json";
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
import jaEgg from "@/data/i18n/ja/egg-groups.json";
import esEgg from "@/data/i18n/es/egg-groups.json";
import frEgg from "@/data/i18n/fr/egg-groups.json";
import deEgg from "@/data/i18n/de/egg-groups.json";
import itEgg from "@/data/i18n/it/egg-groups.json";
import jaColors from "@/data/i18n/ja/colors.json";
import esColors from "@/data/i18n/es/colors.json";
import frColors from "@/data/i18n/fr/colors.json";
import deColors from "@/data/i18n/de/colors.json";
import itColors from "@/data/i18n/it/colors.json";
import jaStats from "@/data/i18n/ja/stats.json";
import esStats from "@/data/i18n/es/stats.json";
import frStats from "@/data/i18n/fr/stats.json";
import deStats from "@/data/i18n/de/stats.json";
import itStats from "@/data/i18n/it/stats.json";
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

/**
 * The official names PokéConnections' groups are written with, in every language but English (src/data/i18n, from
 * PokéAPI; keys are English names in lower case, letters and digits only). Server-side only: the categories are
 * built on the server, and a page gets only its own language's Pokémon names (./names).
 */

type Table = Record<string, string>;

export interface LocalNames {
  types: Table;
  abilities: Table;
  moves: Table;
  /** Evolution stones and held items. */
  items: Table;
  eggGroups: Table;
  colors: Table;
  stats: Table;
  regions: Table;
  versions: Table;
  /** Pokédex number → name. */
  species: Record<number, string>;
}

const speciesIn = (l: OtherLocale): Record<number, string> =>
  Object.fromEntries(Object.entries(SPECIES as Record<string, Record<string, string>>).flatMap(([id, n]) => (n[l] ? [[Number(id), n[l]]] : [])));

const pack = (l: OtherLocale, types: Table, abilities: Table, moves: Table, items: Table, eggGroups: Table, colors: Table, stats: Table, regions: Table, versions: Table): LocalNames => ({
  types,
  abilities,
  moves,
  items,
  eggGroups,
  colors,
  stats,
  regions,
  versions,
  get species() {
    const value = speciesIn(l);
    Object.defineProperty(this, "species", { value });
    return value;
  },
});

export const LOCAL_NAMES: Record<OtherLocale, LocalNames> = {
  ja: pack("ja", jaTypes, jaAbilities, jaMoves, jaItems, jaEgg, jaColors, jaStats, jaRegions, jaVersions),
  es: pack("es", esTypes, esAbilities, esMoves, esItems, esEgg, esColors, esStats, esRegions, esVersions),
  fr: pack("fr", frTypes, frAbilities, frMoves, frItems, frEgg, frColors, frStats, frRegions, frVersions),
  de: pack("de", deTypes, deAbilities, deMoves, deItems, deEgg, deColors, deStats, deRegions, deVersions),
  it: pack("it", itTypes, itAbilities, itMoves, itItems, itEgg, itColors, itStats, itRegions, itVersions),
};
