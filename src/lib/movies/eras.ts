/** The Movies tab's eras: the filter chips on /pokedex/movies and the label on each film's page. Client-safe. */

export const MOVIE_ERAS = [
  { id: "original", label: "Original series" },
  { id: "advanced", label: "Advanced Generation" },
  { id: "dp", label: "Diamond & Pearl" },
  { id: "bw", label: "Best Wishes" },
  { id: "xy", label: "XY" },
  { id: "modern", label: "2017 and later" },
  { id: "live-action", label: "Live-action" },
  { id: "coming-soon", label: "Coming soon" },
] as const;

export type MovieEraId = (typeof MOVIE_ERAS)[number]["id"];

export const MOVIE_ERA_IDS = MOVIE_ERAS.map((e) => e.id) as [MovieEraId, ...MovieEraId[]];

export const MOVIES_PATH = "/pokedex/movies";
export const moviePath = (slug: string) => `${MOVIES_PATH}/${slug}`;

export function eraLabel(id: MovieEraId): string {
  return MOVIE_ERAS.find((e) => e.id === id)?.label ?? id;
}

/** The era a `?era=` value names, or null for "All" (or anything unknown). */
export function parseEra(value: string | null | undefined): MovieEraId | null {
  return MOVIE_ERAS.some((e) => e.id === value) ? (value as MovieEraId) : null;
}
