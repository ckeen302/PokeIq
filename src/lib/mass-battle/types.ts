/**
 * Pokémon Mass Battle: the shapes shared by the roster (built on the server
 * from the repo's data), the damage table, the simulation and the page.
 * Client-safe: no data in here.
 */

export type SideIndex = 0 | 1;
export type Formation = "line" | "wedge" | "swarm" | "surround";
export type ArenaId = "plains" | "volcano" | "snowfield" | "colosseum";
export type BattleLevel = 50 | 100;

export const FORMATIONS: Formation[] = ["line", "wedge", "swarm", "surround"];
export const ARENAS: ArenaId[] = ["plains", "volcano", "snowfield", "colosseum"];
export const LEVELS: BattleLevel[] = [100, 50];

export const FORMATION_LABEL: Record<Formation, string> = { line: "Line", wedge: "Wedge", swarm: "Swarm", surround: "Surround" };
export const ARENA_LABEL: Record<ArenaId, string> = { plains: "Plains", volcano: "Volcano", snowfield: "Snowfield", colosseum: "Colosseum" };

export type StatTable = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };

/** A move as the battle uses it: Showdown's data (@pkmn/dex) for its rules, the calculator for its damage. */
export interface MBMove {
  /** Showdown's name (what the damage calculator takes). */
  name: string;
  /** Capitalised type ("Water"). */
  type: string;
  cat: "Physical" | "Special";
  /** Base power (0 for moves whose power the calculator works out: Flail, Low Kick…). */
  bp: number;
  /** Accuracy in percent; 0 never misses. */
  acc: number;
  pri: number;
  contact: boolean;
  /** Hits every foe around the user (Showdown's target allAdjacent or allAdjacentFoes). */
  spread: boolean;
  /** Multi-hit moves: fewest and most hits. */
  hits: [number, number] | null;
  /** Each hit of a multi-hit move checks accuracy (Triple Axel, Population Bomb). */
  multiAcc: boolean;
  /** Critical-hit stage bonus (1 for Stone Edge, Slash…); 3 always lands a critical hit. */
  crit: number;
  recoil: [number, number] | null;
  drain: [number, number] | null;
}

/** A species and its set, as the battle needs it. Stats from src/data/pokedex.json. */
export interface MBSpecies {
  id: number;
  slug: string;
  name: string;
  /** The damage calculator's name for it. */
  calc: string;
  /** Lowercase types. */
  types: string[];
  base: StatTable;
  /** Height (m) and weight (kg). */
  m: number;
  kg: number;
  shape: string | null;
  gen: number;
  legendary: boolean;
  mythical: boolean;
  fullyEvolved: boolean;
  ability: string;
  /** Empty for none. */
  item: string;
  /** Moves by level: the random-battle set (the same at both levels) or the level-up moves known by then. */
  moves: Record<BattleLevel, number[]>;
  /** Where the moves come from. */
  source: "randbats" | "learnset";
  /** The HOME render's visible box [x, y, w, h, image size], for the 3D figure. */
  box: [number, number, number, number, number];
}

/** Everything the battle can use: species by National Dex number, moves by index. */
export interface Roster {
  version: number;
  moves: MBMove[];
  species: MBSpecies[];
}

/** One army: up to a few species with a count each. */
export interface ArmySpec {
  units: { id: number; count: number }[];
  formation: Formation;
}

/** A battle, fully determined (the share link encodes exactly this). */
export interface BattleSpec {
  sides: [ArmySpec, ArmySpec];
  level: BattleLevel;
  arena: ArenaId;
  seed: number;
}

/** "How many X beat Y?": an army of one species against one boss. */
export interface Question {
  challenger: number;
  boss: number;
  level: BattleLevel;
  arena: ArenaId;
}

export type Winner = 0 | 1 | 2; // side A, side B, draw (time ran out)

export interface BattleOutcome {
  winner: Winner;
  /** Simulated seconds. */
  seconds: number;
  /** Units left standing per side. */
  left: [number, number];
  /** KOs each side scored. */
  kos: [number, number];
  /** Damage each side dealt. */
  dealt: [number, number];
}
