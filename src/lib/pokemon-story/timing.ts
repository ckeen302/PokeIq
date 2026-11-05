import { buildFilm as buildAny, storyVideoPlan as planAny, STORY_SECONDS, type Film } from "@/lib/world-history/timing";
import { CHAPTERS, STORY_PACING } from "./data";

/**
 * The Story of Pokémon runs on World History's clock (same title hold,
 * reading speed, hall walks and slow-motion maths); only its chapters and
 * their pacing differ, and those live in the data.
 */
export function buildFilm(): Film {
  return buildAny(CHAPTERS, STORY_PACING);
}

export function storyVideoPlan(f: Film, seconds = STORY_SECONDS) {
  return planAny(f, seconds, CHAPTERS);
}
