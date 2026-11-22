import "server-only";
import type { Locale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";

/**
 * Official names in a share image's language (src/data/i18n/<locale>, read on the server for that language only).
 * English: the names exactly as the English cards print them.
 */
export interface OgNames {
  species(id: number, english: string): string;
  /** A type by id ("fire"): the language's name; English keeps the id (the cards upper-case it). */
  type(id: string): string;
  /** "Mouse Pokémon" → "ねずみポケモン". */
  genus(english: string): string;
}

/** A name's key in src/data/i18n: the English, without accents, lower case letters and digits only. */
const dataKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const ENGLISH: OgNames = { species: (_id, s) => s, type: (id) => id, genus: (s) => s };

const loaded = new Map<Locale, Promise<OgNames>>();
export function ogNames(locale: Locale): Promise<OgNames> {
  if (locale === "en") return Promise.resolve(ENGLISH);
  let p = loaded.get(locale);
  if (!p) {
    p = Promise.all([import(`@/data/i18n/${locale}/types.json`), import(`@/data/i18n/${locale}/genus.json`)]).then(([types, genus]) => {
      const T = types.default as Record<string, string>;
      const G = genus.default as Record<string, string>;
      return {
        species: (id, english) => speciesName(id, english, locale),
        type: (id) => T[id] ?? id,
        genus: (english) => G[dataKey(english)] ?? english,
      };
    });
    loaded.set(locale, p);
  }
  return p;
}
