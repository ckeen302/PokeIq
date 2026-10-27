/**
 * Shapes of the committed trainer data (src/data/trainers/<game>.json), built by
 * scripts/trainers/import.ts from the pret decompilation projects (Gen I–IV)
 * and scripts/trainers/wiki-import.ts from Bulbapedia (Gen V–IX). Client safe.
 */

/** One Pokémon on a trainer's team, exactly as the game's party data builds it. */
export interface TrainerMon {
  /** National Pokédex number. */
  s: number;
  /** Level. */
  lv: number;
  /** Move slugs (our Pokédex move pages), in slot order. */
  m: string[];
  /** 1 when the game fills the moves from the level-up learnset (the party data names none). */
  d?: 1;
  /** Held item: our item slug when we have the item, else its in-game name. */
  i?: string;
  /** Form index when it isn't the base form. */
  f?: number;
  /** Form name when the source names it rather than numbering it ("Alolan Form", "Gigantamax"). */
  fn?: string;
  /** Ability, when the source lists it (Gen V+ full sets). */
  ab?: string;
  /** Tera Type (Scarlet & Violet). */
  tt?: string;
}

/** A place a trainer stands: an area (route, town, dungeon) and, inside it, the map. */
export interface TrainerSpot {
  /** Index into the game file's `areas`. */
  a: number;
  /** Map / floor inside the area ("B2F", "Gym"), when the area has several. */
  s?: string;
}

export interface TrainerTeam {
  /** Stable id from the decompilation (trainer constant + party index). */
  id: string;
  /** Trainer class as the game prints it ("Bug Catcher", "Leader"). */
  cls: string;
  /** Personal name; Gen I generic trainers have none. */
  name?: string;
  /** Where the trainer is fought. Empty when the decompilation doesn't tie the party to a map. */
  at: TrainerSpot[];
  /** Battles of one trainer (first battle, rematches, rival variants) share this key; absent = the team's own id. */
  g?: string;
  /** "Rematch 2", "If you chose Charmander", … */
  tag?: string;
  /** Versions this team appears in when it isn't every version the file covers. */
  ver?: string[];
  double?: 1;
  /** Items the trainer can use in battle (slugs or in-game names). */
  items?: string[];
  team: TrainerMon[];
  /** Notable trainer slug (see notable.ts) when this team belongs to one. */
  n?: string;
}

export interface TrainerArea {
  slug: string;
  name: string;
  region: string;
}

export interface TrainerGameFile {
  game: string;
  source: { repo: string; commit: string };
  areas: TrainerArea[];
  teams: TrainerTeam[];
}
