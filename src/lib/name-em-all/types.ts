/**
 * Name 'em All, client-safe types: a recall quiz where the player types the
 * name of every Pokémon in a category, in any order (or the order the mode
 * asks for), against the clock.
 */

export type NeaFormKind = "mega" | "gmax" | "regional";

/** One slot of a category, in the order the grid shows it. */
export interface NeaTarget {
  /** Sprite id: the species' national number, or PokéAPI's form id (10001+). */
  id: number;
  /** The number shown on the slot: national, or the regional dex's own number. */
  num: number;
  /** National dex number of the species (its Pokédex page and its generation). */
  species: number;
  name: string;
  /** Pokédex page slug of the species. */
  slug: string;
  gen: number;
  /** Forms only: what kind of form, the species' name, and the words that tell it from its siblings. */
  form?: {
    kind: NeaFormKind;
    base: string;
    /** Debut region of a regional form (alola, galar, hisui, paldea). */
    region?: string;
    /** "x", "amped", "combat breed", "zen"… */
    qualifier?: string;
    /** The default of several same-kind forms of one species (Standard Darmanitan, Amped Toxtricity, Combat Breed Tauros). */
    primary?: boolean;
  };
}

export type NeaMode = "regular" | "chaos" | "dex";

export const NEA_MODES: { id: NeaMode; label: string; blurb: string }[] = [
  { id: "regular", label: "Regular", blurb: "Any order you like." },
  { id: "chaos", label: "Chaos", blurb: "Name the one we point at, in random order." },
  { id: "dex", label: "Dex order", blurb: "One after another, in Pokédex order." },
];

export type NeaBoard = "clear" | "count";

/** One leaderboard line. */
export interface NeaBoardRow {
  name: string;
  named: number;
  total: number;
  ms: number;
  you?: boolean;
}

export interface NeaBoardResponse {
  scope: string;
  board: NeaBoard;
  /** Null when the leaderboard isn't available on this server. */
  rows: NeaBoardRow[] | null;
}

/** POST /api/name-em-all/result's answer. */
export interface NeaResultResponse {
  /** False when the run can't be ranked (the reason says why). */
  ranked: boolean;
  reason?: string;
  /** Names named inside the category's standard time. */
  counted: number;
  /** A name is needed to post: send it back with this claim. */
  claim?: string;
  /** Where the run placed, per board it was posted to. */
  places?: Partial<Record<NeaBoard, { position: number; total: number }>>;
}
