import type { Rng } from "@/lib/rng";
import type { BallKind, Cell, Rot, TypeName } from "./types";

/**
 * The material the items are drawn from: a small, fixed roster of Pokémon
 * (ids for /api/art), the 18 types and the Poké Ball kinds. Kept small so
 * the test page ships no Pokédex, and curated so sprites read well tiny.
 */

export const TYPES: readonly TypeName[] = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
];

export const BALLS: readonly BallKind[] = ["poke", "great", "ultra", "master", "premier", "net"];

export const ROTS: readonly Rot[] = [0, 90, 180, 270];

export interface Mon {
  id: number;
  name: string;
  type: TypeName;
}

/** Pokémon whose official artwork is clearly asymmetric (for rotation and matrix items). */
export const MONS: readonly Mon[] = [
  { id: 6, name: "Charizard", type: "fire" },
  { id: 25, name: "Pikachu", type: "electric" },
  { id: 130, name: "Gyarados", type: "water" },
  { id: 123, name: "Scyther", type: "bug" },
  { id: 78, name: "Rapidash", type: "fire" },
  { id: 59, name: "Arcanine", type: "fire" },
  { id: 149, name: "Dragonite", type: "dragon" },
  { id: 94, name: "Gengar", type: "ghost" },
  { id: 143, name: "Snorlax", type: "normal" },
  { id: 131, name: "Lapras", type: "water" },
  { id: 65, name: "Alakazam", type: "psychic" },
  { id: 3, name: "Venusaur", type: "grass" },
  { id: 9, name: "Blastoise", type: "water" },
  { id: 38, name: "Ninetales", type: "fire" },
  { id: 68, name: "Machamp", type: "fighting" },
  { id: 95, name: "Onix", type: "rock" },
  { id: 112, name: "Rhydon", type: "ground" },
  { id: 127, name: "Pinsir", type: "bug" },
  { id: 134, name: "Vaporeon", type: "water" },
  { id: 135, name: "Jolteon", type: "electric" },
  { id: 136, name: "Flareon", type: "fire" },
  { id: 142, name: "Aerodactyl", type: "rock" },
  { id: 144, name: "Articuno", type: "ice" },
  { id: 145, name: "Zapdos", type: "electric" },
  { id: 146, name: "Moltres", type: "fire" },
  { id: 150, name: "Mewtwo", type: "psychic" },
  { id: 196, name: "Espeon", type: "psychic" },
  { id: 197, name: "Umbreon", type: "dark" },
  { id: 212, name: "Scizor", type: "bug" },
  { id: 248, name: "Tyranitar", type: "rock" },
  { id: 254, name: "Sceptile", type: "grass" },
  { id: 257, name: "Blaziken", type: "fire" },
  { id: 282, name: "Gardevoir", type: "psychic" },
  { id: 330, name: "Flygon", type: "dragon" },
  { id: 373, name: "Salamence", type: "dragon" },
  { id: 445, name: "Garchomp", type: "dragon" },
  { id: 448, name: "Lucario", type: "fighting" },
  { id: 460, name: "Abomasnow", type: "grass" },
  { id: 475, name: "Gallade", type: "psychic" },
  { id: 530, name: "Excadrill", type: "ground" },
  { id: 571, name: "Zoroark", type: "dark" },
  { id: 635, name: "Hydreigon", type: "dragon" },
  { id: 658, name: "Greninja", type: "water" },
  { id: 700, name: "Sylveon", type: "fairy" },
  { id: 727, name: "Incineroar", type: "fire" },
  { id: 812, name: "Rillaboom", type: "grass" },
  { id: 887, name: "Dragapult", type: "dragon" },
  { id: 908, name: "Meowscarada", type: "grass" },
];

export const MON_IDS: readonly number[] = MONS.map((m) => m.id);

/** Pokémon that look alike at a glance (for the speed rows): groups of ids. */
export const LOOKALIKES: readonly number[][] = [
  [133, 134, 135, 136, 196, 197, 700],
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [25, 26, 172],
  [92, 93, 94],
  [147, 148, 149],
  [66, 67, 68],
  [74, 75, 76],
  [129, 130],
  [43, 44, 45],
];

/** Picks `n` distinct ids from the roster. */
export function pickMons(rng: Rng, n: number, pool: readonly number[] = MON_IDS): number[] {
  return rng.sample(pool, n);
}

export function monName(id: number): string {
  return MONS.find((m) => m.id === id)?.name ?? `#${id}`;
}

/** Art for a roster Pokémon, from the site's own Pokédex art route. */
export function monArt(id: number, size: 96 | 160 = 96): string {
  return `/api/art/${id}?s=${size}`;
}

/** Shorthand builders. */
export const cell = {
  mon: (id: number, rot: Rot = 0, size: 1 | 2 | 3 = 2, n: 1 | 2 | 3 = 1, flip = false): Cell => ({ k: "mon", id, rot, size, n, ...(flip && { flip: true }) }),
  type: (t: TypeName, n: 1 | 2 | 3 | 4 = 1): Cell => ({ k: "type", t, n }),
  ball: (b: BallKind, n: 1 | 2 | 3 | 4 = 1, rot: Rot = 0): Cell => ({ k: "ball", b, n, rot }),
  dots: (bits: number): Cell => ({ k: "dots", bits: bits & 0x1ff }),
  num: (v: number): Cell => ({ k: "num", v }),
};
