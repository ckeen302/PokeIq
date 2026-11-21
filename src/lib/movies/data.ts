import "server-only";
import { z } from "zod";
import raw from "@/data/movies.json";
import { MOVIE_ERA_IDS, eraLabel, moviePath, type MovieEraId } from "./eras";

/**
 * Every Pokémon film for the Pokédex's Movies tab (src/data/movies.json), in
 * release order. Each fact was checked against Bulbapedia's film and location
 * pages (Wild Card also against TMDB); what couldn't be confirmed is left out
 * rather than guessed. Summaries cover the set-up only.
 */

const Character = z.object({
  name: z.string().min(1),
  role: z.enum(["hero", "guest", "villain"]),
  /** National Dex number of the Pokémon they're partnered with in this film. */
  partner: z.number().int().positive().optional(),
});

const Film = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** Anime films 1–23; Detective Pikachu and Wild Card have none. */
  number: z.number().int().positive().nullable(),
  title: z.string().min(1),
  era: z.enum(MOVIE_ERA_IDS),
  /** Overrides "Movie N · <era> era" on the film's page (the CGI remake). */
  kicker: z.string().optional(),
  /** First theatrical release (YYYY-MM-DD), when there has been one. */
  premiere: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  year: z.number().int(),
  years: z.object({ japan: z.number().int().optional(), us: z.number().int().optional() }),
  setting: z.string().optional(),
  summary: z.string().min(1),
  featured: z.array(z.number().int().positive()).min(1),
  characters: z.array(Character),
  trilogy: z.string().optional(),
  related: z.array(z.string()),
  poster: z.string().regex(/^\/movies\/[a-z0-9-]+\.webp$/),
});

export type MovieCharacter = z.infer<typeof Character>;
export type Movie = z.infer<typeof Film>;

export const MOVIES: Movie[] = z.object({ films: z.array(Film) }).parse(raw).films;

const BY_SLUG = new Map(MOVIES.map((m) => [m.slug, m]));
export const getMovie = (slug: string) => BY_SLUG.get(slug);

/** The label over a film's title: "Movie 10 · Diamond & Pearl era", "Live-action", "Coming soon". */
export function movieKicker(m: Movie): string {
  if (m.number === null) return eraLabel(m.era);
  const era = m.kicker ?? (m.era === "modern" ? eraLabel(m.era) : `${eraLabel(m.era)} era`);
  return `Movie ${m.number} · ${era}`;
}

/** Release years as shown on the page: "Japan 2007 · US 2008", or just the year when there's no confirmed release yet. */
export function movieYears(m: Movie): string {
  const parts = [m.years.japan && `Japan ${m.years.japan}`, m.years.us && `US ${m.years.us}`].filter(Boolean);
  if (!m.premiere) return `Coming ${m.year}`;
  return parts.length ? parts.join(" · ") : String(m.year);
}

/** Its trilogy, or the other films of its era (plus the remake or the original), with a heading for them. */
export function relatedFor(m: Movie): { title: string; films: Movie[] } {
  const films = m.related.map((s) => BY_SLUG.get(s)).filter((x): x is Movie => Boolean(x));
  const sameEra = films.every((f) => f.era === m.era);
  const title = m.trilogy
    ? `The ${m.trilogy} trilogy`
    : !sameEra
      ? "Related films"
      : m.era === "modern"
        ? "More from 2017 and later"
        : `More from the ${eraLabel(m.era)} era`;
  return { title, films };
}

export { moviePath, type MovieEraId };
