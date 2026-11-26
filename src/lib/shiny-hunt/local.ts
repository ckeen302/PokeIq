import "server-only";
import type { OtherLocale } from "@/i18n/config";
import { normalizeName } from "@/components/pokedle/search";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { getPokemon } from "@/lib/pokemon/pokedex";
import type { HuntLocal } from "@/components/tools/shiny-hunt/names";
import { LAST_SPECIES } from "./store";

/**
 * The Shiny Hunt Counter on a page in another language (server only; English pages send nothing): every Pokémon's
 * official name there, and the other names its search takes (English, and rōmaji for Japanese), folded as the search
 * folds them.
 */

const cache = new Map<OtherLocale, HuntLocal>();

export function huntLocal(locale: OtherLocale): HuntLocal {
  let out = cache.get(locale);
  if (out) return out;
  const names: Record<number, string> = {};
  const alt: Record<number, string> = {};
  for (let id = 1; id <= LAST_SPECIES; id++) {
    const english = getPokemon(id)?.name;
    if (!english) continue;
    names[id] = speciesName(id, english, locale);
    alt[id] = [...new Set([english, ...speciesAliases(id, english, locale)].map(normalizeName).filter(Boolean))].join(" ");
  }
  out = { names, alt };
  cache.set(locale, out);
  return out;
}
