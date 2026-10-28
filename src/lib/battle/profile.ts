import type { PlayFormatId } from "./play";

/**
 * A trainer's battle record: wins and losses per format (live battles
 * against other trainers), their ladder rating where they have one, and
 * their latest battles with links to the replays that were saved.
 */

export type BattleOutcome = "win" | "loss" | "draw";

export interface BattleFormatRecord {
  format: PlayFormatId;
  formatName: string;
  wins: number;
  losses: number;
  draws: number;
  /** On the ladder: the Glicko-2 rating and ranked games in this format. */
  rating?: number;
  ratedGames?: number;
  /** Glicko-2: the rating deviation and GXE. */
  rd?: number;
  gxe?: number;
  /** On the ladder: the Elo, the headline rating (lib/rating/elo.ts). */
  elo?: number;
  /** Place on the format's ladder. */
  position?: number | null;
}

export interface BattleRecentEntry {
  code: string;
  format: PlayFormatId;
  formatName: string;
  name: string;
  opponent: string;
  result: BattleOutcome;
  ranked: boolean;
  /** Ranked: the Glicko-2 rating before and after. */
  ratingBefore?: number;
  ratingAfter?: number;
  /** Ranked: the Elo before and after (battles since the ladder had Elo). */
  eloBefore?: number;
  eloAfter?: number;
  /** A replay was saved: it's at /battle/replay/<code>. */
  replay: boolean;
  at: number;
}

export interface BattleProfile {
  /** The account's name, on a public profile. */
  name?: string;
  formats: BattleFormatRecord[];
  recent: BattleRecentEntry[];
}

export type BattleProfileResponse = { available: false } | ({ available: true } & BattleProfile);

/** The trainer's own result, from their seat and how the battle ended. */
export function outcomeOf(seat: 0 | 1, winner: 0 | 1 | null): BattleOutcome {
  return winner === null ? "draw" : winner === seat ? "win" : "loss";
}
