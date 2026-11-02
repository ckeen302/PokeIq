import type { BattleStats } from "@/lib/mass-battle/engine";
import type { BattleOutcome, BattleSpec, MBMove, MBSpecies, Question, Winner } from "@/lib/mass-battle/types";

/** Messages between the page and its battle workers. */

/** The part of the roster a battle needs (move indices still point into the full move list). */
export interface RosterSlice {
  version: number;
  moves: MBMove[];
  species: MBSpecies[];
}

/** One tick of the live battle, as drawn. */
export interface SimFrame {
  tick: number;
  /** x, z per unit (m). */
  pos: Float32Array;
  /** HP per unit (0 once fainted). */
  hp: Uint16Array;
  /** Each unit's foe (−1 none). */
  target: Int32Array;
  /** EVENT_INTS per event (see engine.ts). */
  events: Int32Array;
  left: [number, number];
  ended: boolean;
  winner: Winner;
}

export interface SimReady {
  type: "ready";
  id: number;
  n: number;
  arena: number;
  /** Battle species → roster species. */
  species: number[];
  /** Per unit: battle species index and side. */
  sp: Uint16Array;
  side: Uint8Array;
  /** Per battle species: max HP, body radius (m), battle Speed. */
  maxHp: number[];
  radius: number[];
  start: [number, number];
  /** Move names per battle species (by slot), with type and whether it makes contact / spreads. */
  moves: { name: string; type: string; cat: string; contact: boolean; spread: boolean }[][];
  frame: SimFrame;
  /** Milliseconds the setup took (damage table and placement). */
  setupMs: number;
}

/** A moment worth a camera cut, from a battle played ahead (for the video's plan). */
export interface Moment {
  t: number;
  kind: "crit" | "multi" | "boss-hit" | "ko-boss" | "final" | "big";
  actor: number;
  target: number;
  /** KOs in that action, or damage. */
  value: number;
}

export interface SimEnd {
  outcome: BattleOutcome;
  stats: BattleStats;
  /** KOs per unit's species, per side: [battle species, KOs scored by that species]. */
  kosBySpecies: [number, number][][];
}

export type ToSim =
  | { type: "init"; id: number; roster: RosterSlice; spec: BattleSpec }
  | { type: "step"; id: number; count: number }
  | { type: "plan"; id: number }
  | { type: "recycle"; buffers: ArrayBuffer[] };

export type FromSim =
  | SimReady
  | { type: "frames"; id: number; frames: SimFrame[]; end?: SimEnd; ms: number }
  | { type: "plan"; id: number; seconds: number; moments: Moment[]; outcome: BattleOutcome }
  | { type: "error"; id: number; message: string };

export type ToSolver =
  | { type: "setup"; job: number; roster: RosterSlice; question: Question }
  | { type: "run"; job: number; tag: number; n: number; seed: number };

export type FromSolver =
  | { type: "result"; job: number; tag: number; n: number; seed: number; winner: Winner; seconds: number; ms: number }
  | { type: "error"; job: number; message: string };

/** Only what a battle needs from the roster. */
export function sliceRoster(roster: { version: number; moves: MBMove[]; species: MBSpecies[] }, ids: number[]): RosterSlice {
  const want = new Set(ids);
  return { version: roster.version, moves: roster.moves, species: roster.species.filter((s) => want.has(s.id)) };
}

export const specIds = (spec: BattleSpec) => [...new Set(spec.sides.flatMap((s) => s.units.map((u) => u.id)))];
export const questionIds = (q: Question) => [q.challenger, q.boss];
