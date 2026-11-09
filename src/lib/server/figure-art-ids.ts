import "server-only";
import { RACE_ENTRANTS } from "@/lib/race/data";
import { FIGURE_ARTS as HISTORY_ARTS } from "@/lib/world-history/data";
import { FIGURE_ARTS as STORY_ARTS } from "@/lib/pokemon-story/data";

/** Every HOME render the race can field (each Pokémon and form). */
export const RACE_ART_IDS: ReadonlySet<number> = new Set(RACE_ENTRANTS.map((e) => e.art));
/** Every HOME render the films (The History of the Pokémon World, The Story of Pokémon) show. */
export const FILM_ART_IDS: ReadonlySet<number> = new Set([...HISTORY_ARTS, ...STORY_ARTS]);

/** Every figure with a static picture in public/race/art (scripts/figure-art.ts), in id order. */
export function figureArtIds(): number[] {
  return [...new Set([...RACE_ART_IDS, ...FILM_ART_IDS])].sort((a, b) => a - b);
}
