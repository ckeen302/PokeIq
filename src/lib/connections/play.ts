/**
 * PokéConnections tallies kept in a trainer's progress: games won, perfect
 * and Hard solves, and the duel record. Shared by the client (lib/progress),
 * the sync code (lib/progress-merge, also on the server) and the profiles,
 * so no "use client" here.
 */
export interface ConnPlay {
  wins: number;
  perfect: number;
  hard: number;
  duelWins: number;
  duelLosses: number;
  duelDraws: number;
  /** The last duels counted (their codes), so a reload never counts one twice. */
  duels: string[];
}

export const EMPTY_CONN_PLAY: ConnPlay = { wins: 0, perfect: 0, hard: 0, duelWins: 0, duelLosses: 0, duelDraws: 0, duels: [] };
