import type { Entrant } from "@/lib/race/types";

/**
 * A page in another language's names for /pokedex/race (built on the server: ./local): each runner's name where it
 * differs from English, the other spellings the picker accepts besides English (Japanese rōmaji), and the type names
 * for the lane introductions. English pages have none.
 */
export interface RaceLocal {
  names: Record<string, string>;
  alt: Record<string, string[]>;
  types: Record<string, string>;
}

/** /api/race's runners with the page language's names; `alt` gets every other name the search accepts (English first). */
export function localizeEntrants(all: Entrant[], local: RaceLocal, alt: Map<string, string[]>): Entrant[] {
  return all.map((e) => {
    const own = local.names[e.key];
    alt.set(e.key, [...(own ? [e.name] : []), ...(local.alt[e.key] ?? [])]);
    return own ? { ...e, name: own } : e;
  });
}
