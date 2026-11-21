import "server-only";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";
import type { Locale, OtherLocale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";
import { LOOKALIKES, MONS, TYPES } from "./materials";
import type { CogLocal } from "./types";

/**
 * What the PokéIQ Test page in another language sends its client components: the official names of every Pokémon
 * the items use and of the types, and the short label each type icon carries (built once per language). English
 * pages get none: the items show the roster's English names and the icons their three English letters, as before.
 */

const TYPE_NAMES: Record<OtherLocale, Record<string, string>> = { ja: jaTypes, es: esTypes, fr: frTypes, de: deTypes, it: itTypes };

/**
 * A type icon's label: the first three letters of the type's name in the language, as English shows "FIR" for Fire,
 * or in Japanese its first character (ほのお → ほ). Unique within each language (tests/i18n-iq-test.test.ts), so a
 * speed row or a matrix is exactly as easy to read as in English.
 */
export function typeAbbr(name: string, locale: Locale): string {
  const chars = [...name];
  return (locale === "ja" ? chars.slice(0, 1) : chars.slice(0, 3)).join("");
}

const built = new Map<OtherLocale, CogLocal>();

export function cognitiveLocal(locale: Locale): CogLocal | undefined {
  if (locale === "en") return undefined;
  let local = built.get(locale);
  if (!local) {
    const mons: Record<number, string> = {};
    for (const m of MONS) mons[m.id] = speciesName(m.id, m.name, locale);
    for (const id of LOOKALIKES.flat()) mons[id] ??= speciesName(id, `#${id}`, locale);
    const types: Record<string, string> = {};
    const abbr: Record<string, string> = {};
    for (const t of TYPES) {
      types[t] = TYPE_NAMES[locale][t] ?? t;
      abbr[t] = typeAbbr(types[t], locale);
    }
    local = { mons, types, abbr };
    built.set(locale, local);
  }
  return local;
}
