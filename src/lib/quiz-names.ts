import "server-only";
import type { OtherLocale } from "@/i18n/config";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { speciesAliases, speciesName } from "@/lib/names/species";
import type { NameEntry } from "@/components/pokedle/search";

/**
 * The Zoom Reveal guess box's names on a page in another language (server only; English pages fetch
 * /api/zoom-reveal/names as before): each Pokémon in that language, and the other names it answers to, the
 * English one always first, which is what a guess sends (see zoomGuess in components/quiz/zoom/ZoomPlay).
 */
const cache = new Map<OtherLocale, NameEntry[]>();

export function zoomNames(locale: OtherLocale): NameEntry[] {
  let names = cache.get(locale);
  if (!names) {
    names = POKEDEX.map((p) => [p.id, speciesName(p.id, p.name, locale), p.gen, [p.name, ...speciesAliases(p.id, p.name, locale).filter((a) => a !== p.name)]]);
    cache.set(locale, names);
  }
  return names;
}
