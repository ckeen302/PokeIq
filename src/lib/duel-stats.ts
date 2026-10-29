/**
 * A trainer's public duel record, as the versus intro shows it before a
 * duel. Every number comes from logged rounds; anything without enough data
 * is null or empty, and the intro shows "—" for it.
 */

export type VersusResult = "win" | "loss" | "draw";

export interface VersusStats {
  /** Duels finished and logged (casual and ranked). */
  duels: number;
  /** Share of duel rounds in which they locked in first, in percent (null before any). */
  guessedFirst: number | null;
  /** Up to three regions with their best and worst average round score. */
  strongest: string[];
  toughest: string[];
  /** The latest duels' results, newest first (at most five). */
  recent: VersusResult[];
}

export interface VersusStatsResponse {
  /** By lower-cased trainer name; null for a name that isn't an account or has no stats store. */
  stats: Record<string, VersusStats | null>;
}

export const EMPTY_VERSUS_STATS: VersusStats = { duels: 0, guessedFirst: null, strongest: [], toughest: [], recent: [] };
