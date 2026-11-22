import "server-only";
import type { Locale } from "@/i18n/config";
import type { Movie } from "./data";

/**
 * The Movies tab in another language: src/data/i18n/<locale>/content/movies.json holds each film's translated text
 * (official title, setting, summary, trilogy, characters' names), keyed by slug. Loaded on the server for that
 * language only; English pages never load it.
 */

export interface MovieText {
  title: string;
  /** The title as a page title and in structured data ("Pokémon: Mewtwo Strikes Back"). */
  fullTitle: string;
  kicker?: string;
  setting?: string;
  summary: string;
  trilogy?: string;
  /** Characters' names, keyed by the English name (a name missing here stays as it is). */
  characters: Record<string, string>;
}

const loaded = new Map<Locale, Promise<Record<string, MovieText>>>();

/** A language's film texts (null for English). */
export function movieTexts(locale: Locale): Promise<Record<string, MovieText> | null> {
  if (locale === "en") return Promise.resolve(null);
  let p = loaded.get(locale);
  if (!p) {
    p = import(`../../data/i18n/${locale}/content/movies.json`).then((m: { default: Record<string, MovieText> }) => m.default);
    loaded.set(locale, p);
  }
  return p;
}

/** The film with its text in the language; English (no texts) comes back as it is. */
export function localizeMovie(m: Movie, tx: Record<string, MovieText> | null): Movie {
  const x = tx?.[m.slug];
  if (!x) return m;
  return {
    ...m,
    title: x.title,
    kicker: m.kicker && (x.kicker ?? m.kicker),
    setting: m.setting && (x.setting ?? m.setting),
    summary: x.summary,
    trilogy: m.trilogy && (x.trilogy ?? m.trilogy),
    characters: m.characters.map((c) => ({ ...c, name: x.characters[c.name] ?? c.name })),
  };
}

/** "Pokémon: Wild Card" already says Pokémon; the others read better with it. In another language, its own full title. */
export function fullMovieTitle(m: Movie, tx: Record<string, MovieText> | null): string {
  const x = tx?.[m.slug];
  if (x) return x.fullTitle;
  return m.title.startsWith("Pokémon") ? m.title : `Pokémon: ${m.title}`;
}
