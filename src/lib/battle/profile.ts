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
  /** On the ladder: the rating and ranked games in this format. */
  rating?: number;
  ratedGames?: number;
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
  ratingBefore?: number;
  ratingAfter?: number;
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
