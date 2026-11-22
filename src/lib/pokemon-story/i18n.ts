import "server-only";
import type { Locale, OtherLocale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";
import ja from "@/data/i18n/ja/content/pokemon-story.json";
import es from "@/data/i18n/es/content/pokemon-story.json";
import fr from "@/data/i18n/fr/content/pokemon-story.json";
import de from "@/data/i18n/de/content/pokemon-story.json";
import it from "@/data/i18n/it/content/pokemon-story.json";
import { STORY } from "./data";
import { localizeStory, type StoryContent } from "./content";
import type { Story } from "./types";

/** The Story of Pokémon in the page's language (server only: an English page gets the English data untouched). */
const CONTENT: Partial<Record<OtherLocale, StoryContent>> = { ja, es, fr, de, it };
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
