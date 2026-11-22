/**
 * The Pokémon Tier List Maker's shared types: a roster entry (one species or one form, as the browser gets it) and
 * the bits its compact fields use. Built on the server from the site's own data (roster.server.ts), sent as JSON.
 */

/** Which kind of form an entry is; species have none. */
export type FormKind = "mega" | "gmax" | "regional" | "other";

/** One Pokémon or form, compact (the roster's JSON carries 1,500 of them). */
export interface Mon {
  /** Showdown id, unique and stable: "charizard", "charizardmegax", "unownb". */
  k: string;
  /** English name: "Mega Charizard X". */
  n: string;
  /** National Pokédex number. */
  d: number;
  /** The generation the species comes from. */
  g: number;
  /** Types, lower case. */
  t: string[];
  /** Base stat total. */
  b: number;
  /** Art key, PokéAPI's file name: "6", "10034", "201-b". */
  a: string;
  /** Which pictures exist (ART bits). */
  m: number;
  /** The kind of form, for forms. */
  f?: FormKind;
  /** Category bits (CAT). */
  c: number;
  /** The base species' key, for forms. */
  s?: string;
}

/** Art availability bits (Mon.m). */
export const ART = {
  /** A Pokémon HOME render on PokéAPI's sprite host. */
  home: 1,
  homeShiny: 2,
  /** A pixel sprite on PokéAPI's sprite host. */
  pixel: 4,
  pixelShiny: 8,
  /** The site's own 256 px HOME render (public/sizes/art/256). */
  local: 16,
} as const;

/** Category bits (Mon.c). */
export const CAT = {
  legendary: 1,
  mythical: 2,
  starter: 4,
  pseudo: 8,
  ultraBeast: 16,
  paradox: 32,
  fossil: 64,
  eeveelution: 128,
  champions: 256,
  za: 512,
} as const;
export type Category = keyof typeof CAT;
export const CATEGORIES = Object.keys(CAT) as Category[];

export const TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
] as const;
export type TypeName = (typeof TYPES)[number];

export const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** The roster as served: entries in National Dex order, each species followed by its forms. */
export interface Roster {
  v: number;
  mons: Mon[];
}
