import type { Locale } from "@/i18n/config";
import { speciesAliases, speciesName } from "@/lib/names/species";
import type { NameEntry } from "@/components/pokedle/search";
import { FACTS } from "./facts";
import { LOCAL_NAMES } from "./text-data";

/**
 * What a PokéConnections page in another language sends its tiles' names with: every Pokémon's name in that
 * language, by Pokédex number, where it differs from the English one the API sends (Spanish and Italian keep most
 * names, Japanese none). Null for English, whose pages carry nothing extra. Server-side only.
 */
const cache = new Map<Locale, Record<number, string>>();

export function connTileNames(locale: Locale): Record<number, string> | null {
  if (locale === "en") return null;
  let out = cache.get(locale);
  if (!out) {
    const local = LOCAL_NAMES[locale].species;
    out = {};
    for (const f of FACTS) if (local[f.id] && local[f.id] !== f.name) out[f.id] = local[f.id];
    cache.set(locale, out);
  }
  return out;
}

/**
 * Every Pokémon for the Create page's search box in another language: its name there, its generation, and the
 * other names it answers to (English; for Japanese, rōmaji). English pages search on the server instead.
 */
export function connSearchNames(locale: Locale): NameEntry[] {
  return FACTS.map((f): NameEntry => [f.id, speciesName(f.id, f.name, locale), f.gen, speciesAliases(f.id, f.name, locale)]);
}
