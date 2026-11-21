import "server-only";
import { toRomaji } from "wanakana";
import SPECIES from "@/data/species-names.json";
import type { Locale } from "@/i18n/config";

/**
 * Pokémon species' official names in each language (src/data/species-names.json, from PokéAPI), for the server:
 * what a page in that language shows, and what its guess boxes accept besides (English always works; Japanese also
 * takes the official rōmaji and a typed one).
 */
type Names = Record<string, Record<string, string>>;
const NAMES = SPECIES as Names;

/** The species' name in the language (English when the language has none). */
export function speciesName(id: number, english: string, locale: Locale): string {
  if (locale === "en") return english;
  return NAMES[id]?.[locale] ?? english;
}

/** Other spellings a guess box accepts for the species in this language: English, and for Japanese, rōmaji. */
export function speciesAliases(id: number, english: string, locale: Locale): string[] {
  if (locale === "en") return [];
  const own = speciesName(id, english, locale);
  const out = new Set<string>([english]);
  if (locale === "ja") {
    const roma = NAMES[id]?.["ja-roma"];
    if (roma) out.add(roma);
    // As typed on a keyboard: ピカチュウ → pikachuu.
    out.add(toRomaji(own.replace(/[♀♂]/g, "")));
  }
  out.delete(own);
  return [...out];
}
