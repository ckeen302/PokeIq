import "server-only";
import type { Locale, OtherLocale } from "@/i18n/config";
import { GENERATION_REGIONS } from "@/lib/pokemon/constants";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { speciesAliases, speciesName } from "@/lib/names/species";
import type { NameEntry } from "@/components/pokedle/search";
import type { DleLabels } from "./dle-i18n";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";
import jaColors from "@/data/i18n/ja/colors.json";
import esColors from "@/data/i18n/es/colors.json";
import frColors from "@/data/i18n/fr/colors.json";
import deColors from "@/data/i18n/de/colors.json";
import itColors from "@/data/i18n/it/colors.json";
import jaRegions from "@/data/i18n/ja/regions.json";
import esRegions from "@/data/i18n/es/regions.json";
import frRegions from "@/data/i18n/fr/regions.json";
import deRegions from "@/data/i18n/de/regions.json";
import itRegions from "@/data/i18n/it/regions.json";

/**
 * What a Pokédle page in another language hands its client components (server only): the guessable Pokémon's
 * names in that language with the other names they answer to, and the type, colour and region names the board,
 * the Pokédex and the settings show. Only the page's language travels; English pages send neither.
 */

type Dict = Record<string, string>;
const DATA: Record<OtherLocale, { types: Dict; colors: Dict; regions: Dict }> = {
  ja: { types: jaTypes, colors: jaColors, regions: jaRegions },
  es: { types: esTypes, colors: esColors, regions: esRegions },
  fr: { types: frTypes, colors: frColors, regions: frRegions },
  de: { types: deTypes, colors: deColors, regions: deRegions },
  it: { types: itTypes, colors: itColors, regions: itRegions },
};

/** Only the entries a Pokédle page can show. */
const pick = (all: Dict, keys: Iterable<string>): Dict => Object.fromEntries([...keys].flatMap((k) => (all[k] ? [[k, all[k]]] : [])));

const TYPES = new Set(POKEDEX.flatMap((p) => p.types));
const COLORS = new Set(POKEDEX.map((p) => p.color));
const REGIONS = Object.values(GENERATION_REGIONS).map((r) => r.toLowerCase());

/** The labels for a language; undefined for English. */
export function dleLabels(locale: Locale): DleLabels | undefined {
  if (locale === "en") return undefined;
  const d = DATA[locale];
  return { types: pick(d.types, TYPES), colors: pick(d.colors, COLORS), regions: pick(d.regions, REGIONS) };
}

/**
 * The guess box's names: [id, name, gen] in English, exactly as before (no answers: nothing else goes to the
 * browser); in another language, the name in it and the other names it answers to.
 */
export function dleNames(locale: Locale): NameEntry[] {
  if (locale === "en") return POKEDEX.map((p) => [p.id, p.name, p.gen] as [number, string, number]);
  let names = localNames.get(locale);
  if (!names) localNames.set(locale, (names = POKEDEX.map((p) => [p.id, speciesName(p.id, p.name, locale), p.gen, speciesAliases(p.id, p.name, locale)])));
  return names;
}
const localNames = new Map<Locale, NameEntry[]>();
