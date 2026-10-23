import type { PdkGuess } from "./types";

/**
 * Pikadoku tallies kept in a trainer's progress, shared by the client
 * (lib/progress), the sync code (lib/progress-merge, also on the server) and
 * the profiles, so no "use client" here.
 */
export interface PdkPlay {
  games: number;
  wins: number;
  duelWins: number;
  duelLosses: number;
  duelDraws: number;
  /** The last duels counted (their codes), so a reload never counts one twice. */
  duels: string[];
}
export const PDK_COUNTERS = ["games", "wins", "duelWins", "duelLosses", "duelDraws"] as const;
export const EMPTY_PDK_PLAY: PdkPlay = { games: 0, wins: 0, duelWins: 0, duelLosses: 0, duelDraws: 0, duels: [] };

/** A Pikadoku daily on this device: the guesses made, and how it went. */
export interface PdkRecord {
  guesses: PdkGuess[];
  won: boolean;
  over: boolean;
  /** Cells filled. */
  solved: number;
  /** The uniqueness score the server computed (null when stats are off). */
  score: number | null;
  ms?: number;
}
