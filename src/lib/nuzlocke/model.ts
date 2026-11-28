/**
 * The Nuzlocke Tracker's game data: for each game, its areas in story order and every Pokémon that can be met in each,
 * built from the sources by scripts/nuzlocke/ (never typed by hand). One file per game: src/data/nuzlocke/{game}.json.
 *
 * A Nuzlocke run allows one encounter per area: the first Pokémon met there. So an area here is what a player counts
 * as one place (a route, a cave, a town's water…), and its encounters are everything that area can give in that game.
 */

/** How a Pokémon is met, as far as a run's rules care (gifts, static encounters and trades are optional by rule). */
export type EncounterKind = "wild" | "gift" | "static" | "trade" | "egg" | "fossil" | "roaming";

export interface NuzEncounter {
  /** National Pokédex number. */
  species: number;
  /** The exact form met, as PokéAPI names it (e.g. "rattata-alola"); absent for the species' default form. It decides the art and the types. */
  form?: string;
  /** With `form`: the form's PokéAPI pokemon id (10xxx), whose art is /sizes/art/256/{art}.webp. Absent for the default form (its art is the species number). */
  art?: number;
  kind: EncounterKind;
  /** How it is met, in the game's own words ("Grass", "Surf", "Old Rod", "Headbutt", "Horde"…). */
  method: string;
  /** Only in these versions (version exclusives), by version id; absent when every version of the game has it. */
  versions?: string[];
  /** The source's encounter chance for this method in this area, in percent; absent when the source gives none. */
  rate?: number;
  /** The source's level range; absent when the source gives none. */
  levels?: [number, number];
  /** A time of day, season, swarm or other condition, worded as the source words it. */
  condition?: string;
}

export interface NuzArea {
  /** Stable key, unique within the game (a run's saved encounters point at it, so it never changes once shipped). */
  id: string;
  /** English name, as the game names the place. */
  name: string;
  encounters: NuzEncounter[];
}

/** A boss between areas in story order (a Gym Leader, the Elite Four…), with its strongest Pokémon's level: the usual level cap. */
export interface NuzBoss {
  name: string;
  /** The badge or title won, when there is one. */
  badge?: string;
  /** The level of the boss's highest-level Pokémon in this game, from the source; absent when not sourced. */
  cap?: number;
  /** When a boss's team or levels differ by version (or by starter), the per-version caps. */
  capByVersion?: Record<string, number>;
}

/** One step of the game in story order: an area to encounter in, or a boss. */
export type NuzStep = { type: "area"; area: NuzArea } | { type: "boss"; boss: NuzBoss };

export interface NuzVersion {
  /** PokéAPI's version id ("firered"). */
  id: string;
  /** English name ("FireRed"). */
  name: string;
}

export interface NuzGame {
  /** URL slug ("firered-leafgreen"). */
  id: string;
  /** English name ("FireRed & LeafGreen"). */
  name: string;
  gen: number;
  region: string;
  /** The versions a run can pick (one per run, so exclusives are right). */
  versions: NuzVersion[];
  /** The game in story order: areas with the bosses between them. */
  steps: NuzStep[];
  /** Areas the sources don't place in the story order (optional side areas, post-game), in the sources' order. */
  extra: NuzArea[];
  /** Where every part of this file came from (URLs), so it can be checked. */
  sources: string[];
}
