import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { OtherLocale } from "@/i18n/config";
import { normalizeName } from "@/components/pokedle/search";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { getPokemon } from "@/lib/pokemon/pokedex";
import type { ShinyLocal } from "@/components/tools/shiny-maker/local";
import { LAST_ID } from "./data";

/**
 * The Shiny Pokémon Maker on a page in another language (server only; English pages send nothing): every Pokémon's
 * official name there, the other names its picker takes (English, and rōmaji for Japanese), folded as the picker
 * folds them, and the parts' names (src/data/i18n/<locale>/shiny-parts.json, keyed by the English part name).
 */

const cache = new Map<OtherLocale, ShinyLocal>();

export function shinyLocal(locale: OtherLocale): ShinyLocal {
  let out = cache.get(locale);
  if (out) return out;
  const names: Record<number, string> = {};
  const alt: Record<number, string> = {};
  for (let id = 1; id <= LAST_ID; id++) {
    const english = getPokemon(id)?.name;
    if (!english) continue;
    names[id] = speciesName(id, english, locale);
    alt[id] = [...new Set([english, ...speciesAliases(id, english, locale)].map(normalizeName).filter(Boolean))].join(" ");
  }
  const parts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/data/i18n", locale, "shiny-parts.json"), "utf8")) as Record<string, string>;
  out = { names, alt, parts };
  cache.set(locale, out);
  return out;
}

/** A species' name in the language, for titles (null when the number isn't a Pokémon). */
export function speciesNameIn(id: number, locale: OtherLocale): string | null {
  const english = id >= 1 && id <= LAST_ID ? getPokemon(id)?.name : undefined;
  return english ? speciesName(id, english, locale) : null;
}
