/** What the learn card shows after a round, besides the place's name and game (all from the repo's place data). */
export interface GeoLearn {
  /** The place's Pokédex page, when it has one. */
  href: string | null;
  /** "City", "Route", "Gym"… */
  type: string | null;
  /** One verified fact, or null when nothing is on file (the card then shows only the name and game). */
  fact: string | null;
}
