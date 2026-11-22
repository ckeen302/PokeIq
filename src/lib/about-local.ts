import "server-only";
import type { Locale, OtherLocale } from "@/i18n/config";
import { GAMES, REGIONS } from "@/lib/about-data";
import { localSpecies } from "@/lib/trainer/local";
import jaVersions from "@/data/i18n/ja/versions.json";
import esVersions from "@/data/i18n/es/versions.json";
import frVersions from "@/data/i18n/fr/versions.json";
import deVersions from "@/data/i18n/de/versions.json";
import itVersions from "@/data/i18n/it/versions.json";
import jaRegions from "@/data/i18n/ja/regions.json";
import esRegions from "@/data/i18n/es/regions.json";
import frRegions from "@/data/i18n/fr/regions.json";
import deRegions from "@/data/i18n/de/regions.json";
import itRegions from "@/data/i18n/it/regions.json";

/**
 * What a profile in another language hands its About me (server only): every species' name in that language (for
 * the picker and the picks), and the official names of the games and regions it offers. English sends nothing.
 * The trainers, rivals, professors and teams keep their English names.
 */
export interface AboutLocal {
  species: Record<number, string>;
  /** A game or region choice's name, by its id ("lets-go-pikachu"). */
  choices: Record<string, string>;
  /** The regions, keyed by the English name in lowercase (the gym leaders' groups). */
  regions: Record<string, string>;
}

type Dict = Record<string, string>;
const DATA: Record<OtherLocale, { versions: Dict; regions: Dict }> = {
  ja: { versions: jaVersions, regions: jaRegions },
  es: { versions: esVersions, regions: esRegions },
  fr: { versions: frVersions, regions: frRegions },
  de: { versions: deVersions, regions: deRegions },
  it: { versions: itVersions, regions: itRegions },
};

/** As src/data/i18n keys names: the English, lowercased, letters and digits only. */
const key = (english: string) => english.toLowerCase().replace(/[^a-z0-9]/g, "");

const made = new Map<Locale, AboutLocal>();

export function aboutLocal(locale: Locale): AboutLocal | undefined {
  if (locale === "en") return undefined;
  let out = made.get(locale);
  if (!out) {
    const d = DATA[locale];
    const choices: Dict = {};
    for (const c of GAMES) if (d.versions[key(c.label)]) choices[c.id] = d.versions[key(c.label)];
    for (const c of REGIONS) if (d.regions[key(c.label)]) choices[c.id] = d.regions[key(c.label)];
    made.set(locale, (out = { species: localSpecies(locale), choices, regions: d.regions }));
  }
  return out;
}
