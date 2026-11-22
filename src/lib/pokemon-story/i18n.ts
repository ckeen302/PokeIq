import "server-only";
import type { Locale, OtherLocale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";
import { STORY } from "./data";
import { localizeStory, type StoryContent } from "./content";
import type { Story } from "./types";

/** The Story of Pokémon in the page's language (server only: an English page gets the English data untouched). */
const CONTENT: Partial<Record<OtherLocale, StoryContent>> = {};
const cache = new Map<Locale, Story>();

export function localStory(locale: Locale): Story {
  const content = locale === "en" ? undefined : CONTENT[locale];
  if (!content) return STORY;
  let s = cache.get(locale);
  if (!s) {
    s = localizeStory(STORY, content, (dex, english) => speciesName(dex, english, locale));
    cache.set(locale, s);
  }
  return s;
}
