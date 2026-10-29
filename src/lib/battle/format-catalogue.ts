/**  * The full catalogue: every format Pokémon Showdown ships, generated from the
 * engine by scripts/build-formats.ts. Each one was started as a real battle;
 * those that couldn't be are kept with the reason but never offered.
 */

import catalogueData from "@/data/battle/formats.json";

export interface CatalogueFormat {
  /** Showdown's format id. */
  id: string;
  name: string;
  /** Showdown's own section ("S/V Singles", "Randomized Metas", ...). */
  section: string;
  gen: number;
  gameType: "singles" | "doubles" | "triples" | "freeforall" | "multi";
  /** Teams are dealt by the engine. */
  random: boolean;
  /** Pokémon each side brings. */
  teamSize: number;
  /** Team preview: how many of them battle (null: all). */
  pick: number | null;
  /** The level every Pokémon battles at, or the cap (null: the generator's own levels). */
  level: number | null;
  /** Showdown's own description of the format, when it has one. */
  desc?: string;
  /** Showdown won't let players challenge with it. */
  hidden: boolean;
  supported: boolean;
  /** Why it isn't supported. */
  reason?: string;
}

/** Showdown's ruleset, bans, unbans and restricted lists for a format, verbatim (format-rules.json). */
export interface FormatRules {
  rules: string[];
  bans: string[];
  unbans: string[];
  restricted: string[];
}

export const FORMAT_CATALOGUE = catalogueData as CatalogueFormat[];

/** The formats players can pick: supported ones Showdown itself lists. */
export const PLAYABLE_FORMATS = FORMAT_CATALOGUE.filter((f) => f.supported && !f.hidden);

const byId = new Map(FORMAT_CATALOGUE.map((f) => [f.id, f]));
export const catalogueFormat = (id: string): CatalogueFormat | undefined => byId.get(id);
export const isPlayableFormat = (id: unknown): id is string => typeof id === "string" && !!byId.get(id)?.supported && !byId.get(id)?.hidden;

/** Shown first in the picker (only those that are playable). */
export const POPULAR_FORMAT_IDS = [
  "gen9randombattle",
  "gen9ou",
  "gen9randomdoublesbattle",
  "gen9vgc2025regi",
  "gen9ubers",
  "gen9monotype",
  "gen9nationaldex",
  "gen9doublesou",
  "gen9uu",
  "gen9lc",
  "gen9almostanyability",
  "gen9balancedhackmons",
  "gen9hackmonscup",
  "gen91v1",
  "gen7randombattle",
  "gen4ou",
  "gen3ou",
  "gen1ou",
];
