import type { LuckTally, RollTally } from "./luck-math";

/**
 * The shape of a battle's stats (stats.ts works them out from the replay's
 * log on the server; the analysis panel only reads them). Types only, so
 * the page that shows them doesn't load the simulator's tracker.
 */

export type StatsSide = 0 | 1;

/** Damage that didn't come straight from a foe's move. */
export type IndirectKind = "hazard" | "weather" | "status" | "recoil" | "lifeorb" | "other";

export const INDIRECT_LABELS: Record<IndirectKind, string> = {
  hazard: "Hazards",
  weather: "Weather",
  status: "Status",
  recoil: "Recoil",
  lifeorb: "Life Orb",
  other: "Other",
};

export interface MonStats {
  /** "p1: Name", stable for the whole battle. */
  key: string;
  side: StatsSide;
  species: string;
  /** For its sprite: Showdown id and National Dex number. */
  sprite: { id: string; num: number } | null;
  /** % of foes' HP its moves took off (100 = one whole Pokémon). */
  dealt: number;
  /** The same in HP, when every target's max HP is known (estimated: see maxHp); else null. */
  dealtHp: number | null;
  /** % of foes' HP its hazards, status, weather and the like took off. */
  dealtIndirect: number;
  /** % of its HP lost to foes' moves. */
  taken: number;
  /** % of its HP lost any other way, by cause. */
  takenIndirect: Partial<Record<IndirectKind, number>>;
  /** % of its HP restored. */
  healed: number;
  kos: number;
  fainted: boolean;
  /** The key of the foe credited with knocking it out, if one was. */
  koBy: string | null;
  /** Turns it spent in battle (any part of a turn counts). */
  turns: number;
  /** Its moves' hits on foes. */
  hits: number;
  /** Its max HP, estimated from the assumed set (random formats, where the spread is fixed); null when unknown. */
  maxHp: number | null;
}

export interface SideLuck {
  critsLanded: LuckTally;
  critsReceived: LuckTally;
  /** This side's moves that missed. */
  missesOwn: LuckTally;
  /** The foe's moves that missed this side. */
  missesFoe: LuckTally;
  /** Secondary effects (burn, paralysis, flinch, stat drops…) this side's moves got, and suffered. */
  procsLanded: LuckTally;
  procsReceived: LuckTally;
  /** Damage rolls placed in their range (0 lowest, 1 highest). */
  rollsOwn: RollTally;
  rollsReceived: RollTally;
  /** Lucky breaks above expectation (see luckScore); the two sides' are opposites. */
  score: number;
  /** The spread luck alone gives this battle. */
  sd: number;
  parts: { crits: number; misses: number; procs: number; rolls: number };
}

export type NoteKind = "crit" | "miss" | "ko" | "status" | "flinch" | "proc" | "switch" | "hazard" | "weather" | "terrain" | "tera" | "move";

/** Something that happened in a turn, from the log, by the side that did it. */
export interface TurnNote {
  kind: NoteKind;
  side: StatsSide;
  /** The Pokémon that did it (species). */
  mon: string;
  /** The Pokémon it happened to (species), if any. */
  target?: string;
  move?: string;
  /** The odds it had, when it was a matter of luck. */
  chance?: number;
  /** Status id, hazard or weather name, Tera type, the "how" of a KO ("Stealth Rock"). */
  detail?: string;
  /** A move in a double battle: a spread move's targets (species, and whether each is on the mover's own side). */
  spread?: { species: string; ally: boolean }[];
  /** A move in a double battle aimed at the mover's partner (species). */
  ally?: string;
}

/** A single lucky (or unlucky) moment, for the luck meter's list. */
export interface LuckEvent {
  turn: number;
  /** The side it helped. */
  side: StatsSide;
  kind: "crit" | "miss" | "proc";
  /** "Garchomp's Stone Edge missed Corviknight". */
  text: string;
  /** Its chance of happening. */
  chance: number;
}

export interface BattleStats {
  version: number;
  gen: number;
  players: [string, string];
  winner: StatsSide | null;
  turns: number;
  mons: MonStats[];
  luck: [SideLuck, SideLuck];
  luckEvents: LuckEvent[];
  /** notes[t]: what happened during turn t (notes[0]: before turn 1). */
  notes: TurnNote[][];
  /** Each side's first Pokémon out (species). */
  leads: [string | null, string | null];
  /** Damage rolls were placed using assumed sets (and how many hits couldn't be). */
  rolls: { placed: number; unplaced: number };
  /** A double battle. */
  doubles?: boolean;
}

export const STATS_VERSION = 2;
