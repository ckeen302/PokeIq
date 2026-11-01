/** Shapes of src/data/trainer-teams.json (built by scripts/whose-team/build.ts). */

export interface TeamMon {
  /** English species name. */
  species: string;
  /** National Pokédex number. */
  dex: number;
  /** Artwork id when it isn't the species' own (regional and other forms). */
  art?: number;
  /** Form label ("Alolan", "Sandy Cloak"), when not the base form. */
  form?: string;
}

export interface TeamEntry {
  id: string;
  /** The answer: the trainer's English name. */
  trainer: string;
  kind: "game" | "anime";
  /** Filter value: the game's generation, or the anime series' region (Kanto = 1 … Paldea = 9). */
  gen: number;
  /** Trainer data game key (src/data/trainers), for game rounds. */
  game?: string;
  /** Anime series, for anime rounds. */
  series?: string;
  /** Exactly which battle or appearance this team is from. */
  appearance: string;
  /** For rivals whose team depends on the player's starter: which variant this is. */
  variant?: string;
  /** In party order where the source gives one. */
  team: TeamMon[];
  /** The signature / ace Pokémon (revealed last in Hard). */
  ace: string;
  /** The Bulbapedia page for this trainer. */
  source: string;
  /** Where the team itself was taken from and checked. */
  data: string;
}
