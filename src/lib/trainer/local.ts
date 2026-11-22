import "server-only";
import type { Locale, OtherLocale } from "@/i18n/config";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { speciesName } from "@/lib/names/species";
import type { TrainerLocal } from "@/components/trainer/TrainerCard";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";
import jaRegions from "@/data/i18n/ja/regions.json";
import esRegions from "@/data/i18n/es/regions.json";
import frRegions from "@/data/i18n/fr/regions.json";
import deRegions from "@/data/i18n/de/regions.json";
import itRegions from "@/data/i18n/it/regions.json";
import jaStats from "@/data/i18n/ja/stats.json";
import esStats from "@/data/i18n/es/stats.json";
import frStats from "@/data/i18n/fr/stats.json";
import deStats from "@/data/i18n/de/stats.json";
import itStats from "@/data/i18n/it/stats.json";

/**
 * What the trainer card in another language hands its client components (server only): every species' name, and
 * the type, region and stat names the avatar picker and the coach show, in that language. English sends nothing.
 */

type Dict = Record<string, string>;
const DATA: Record<OtherLocale, { types: Dict; regions: Dict; stats: Dict }> = {
  ja: { types: jaTypes, regions: jaRegions, stats: jaStats },
  es: { types: esTypes, regions: esRegions, stats: esStats },
  fr: { types: frTypes, regions: frRegions, stats: frStats },
  de: { types: deTypes, regions: deRegions, stats: deStats },
  it: { types: itTypes, regions: itRegions, stats: itStats },
};

const made = new Map<Locale, TrainerLocal>();

/** The species' names in the language, by National Dex number (only those that differ from English). */
export function localSpecies(locale: OtherLocale): Record<number, string> {
  const out: Record<number, string> = {};
  for (const p of POKEDEX) {
    const own = speciesName(p.id, p.name, locale);
    if (own !== p.name) out[p.id] = own;
  }
  return out;
}

export function trainerLocal(locale: Locale): TrainerLocal | undefined {
  if (locale === "en") return undefined;
  let out = made.get(locale);
  if (!out) {
    const d = DATA[locale];
    made.set(locale, (out = { species: localSpecies(locale), types: d.types, regions: d.regions, stats: d.stats }));
  }
  return out;
}
