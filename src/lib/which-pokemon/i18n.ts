import "server-only";
import jaTexts from "@/data/i18n/ja/which-pokemon.json";
import esTexts from "@/data/i18n/es/which-pokemon.json";
import frTexts from "@/data/i18n/fr/which-pokemon.json";
import deTexts from "@/data/i18n/de/which-pokemon.json";
import itTexts from "@/data/i18n/it/which-pokemon.json";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";
import type { Locale, OtherLocale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";
import { ALL_SPECIES, POOL, speciesInfo } from "./pool";
import type { PooledPokemon } from "./types";

/**
 * Which Pokémon Are You? in another language, on the server: each pooled Pokémon's archetype, write-up and evidence
 * (src/data/i18n/<locale>/which-pokemon.json, keyed by slug), official species and type names, and what a page sends
 * its client components (WpLocal). English pages use the pool's own text and get none of this.
 */

export interface WpText {
  title: string;
  blurb: string;
  why: string;
}

/** A page in another language's words for its client components: every species' name, every archetype, the types. */
export interface WpLocal {
  /** Species names by id. */
  names: Record<number, string>;
  /** Archetypes by slug. */
  titles: Record<string, string>;
  /** Type names by English key ("fire"). */
  types: Record<string, string>;
}

const TEXTS: Record<OtherLocale, Record<string, WpText>> = { ja: jaTexts, es: esTexts, fr: frTexts, de: deTexts, it: itTexts };
const TYPES: Record<OtherLocale, Record<string, string>> = { ja: jaTypes, es: esTypes, fr: frTypes, de: deTypes, it: itTypes };

/** A pooled Pokémon's archetype, write-up and evidence in the language (English where it has none). */
export function wpText(p: PooledPokemon, locale: Locale): WpText {
  if (locale === "en") return p;
  return TEXTS[locale][p.slug] ?? p;
}

/** A species' official name in the language. */
export function wpName(id: number, locale: Locale): string {
  const english = speciesInfo(id)?.name ?? String(id);
  return speciesName(id, english, locale);
}

/** A type's official name in the language ("fire" → "Fuego"). */
export function wpType(type: string, locale: Locale): string {
  if (locale === "en") return type;
  return TYPES[locale][type] ?? type;
}

const built = new Map<OtherLocale, WpLocal>();

/** What a page in the language sends its client components (undefined in English). */
export function wpLocal(locale: Locale): WpLocal | undefined {
  if (locale === "en") return undefined;
  let local = built.get(locale);
  if (!local) {
    const names: Record<number, string> = {};
    for (const [id, , english] of ALL_SPECIES) names[id] = speciesName(id, english, locale);
    const titles: Record<string, string> = {};
    for (const p of POOL) titles[p.slug] = wpText(p, locale).title;
    local = { names, titles, types: TYPES[locale] };
    built.set(locale, local);
  }
  return local;
}

/** A write-up's first sentence (for a page description): up to the first full stop, or 。 in Japanese. */
export function firstSentence(blurb: string, locale: Locale): string {
  return (locale === "ja" ? blurb.split(/(?<=。)/) : blurb.split(/(?<=\.)\s/))[0];
}
