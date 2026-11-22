import "server-only";
import type { Locale, OtherLocale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";
import { HISTORY } from "./data";
import { localizeHistory, type HistoryContent } from "./content";
import type { WorldHistory } from "./types";

/** The History of the Pokémon World in the page's language (server only: an English page gets the English data untouched). */
const CONTENT: Partial<Record<OtherLocale, HistoryContent>> = {};
const cache = new Map<Locale, WorldHistory>();

export function localHistory(locale: Locale): WorldHistory {
  const content = locale === "en" ? undefined : CONTENT[locale];
  if (!content) return HISTORY;
  let h = cache.get(locale);
  if (!h) {
    h = localizeHistory(HISTORY, content, (dex, english) => speciesName(dex, english, locale));
    cache.set(locale, h);
  }
  return h;
}
