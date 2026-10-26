/**
 * "How you compared" on a Daily: the day's scores in buckets, and where a
 * score sits among them. Shared by the API (which counts) and the summary
 * screen (which draws it).
 */
import { GEO_MAX_ROUND_SCORE, GEO_ROUNDS } from "./geo-types";

/** Buckets across 0–25,000: ten of 2,500. */
export const COMPARE_BUCKETS = 10;
export const COMPARE_MAX = GEO_ROUNDS * GEO_MAX_ROUND_SCORE;
/** Fewer players than this and there's nothing worth comparing to. */
export const COMPARE_MIN_PLAYERS = 5;

export interface GeoDailyStats {
  date: string;
  /** Ranked games that day (first games, saved to the leaderboard). */
  players: number;
  /** Players per bucket, lowest scores first. */
  buckets: number[];
  /** With a score asked about: how many scored less, and how many the same. */
  below?: number;
  equal?: number;
  median?: number;
}

export const bucketOf = (score: number) => Math.min(COMPARE_BUCKETS - 1, Math.max(0, Math.floor((score / COMPARE_MAX) * COMPARE_BUCKETS)));

export function dailyStats(date: string, scores: number[], score?: number): GeoDailyStats {
  const buckets = Array.from({ length: COMPARE_BUCKETS }, () => 0);
  for (const s of scores) buckets[bucketOf(s)]++;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
  if (score === undefined) return { date, players: scores.length, buckets, ...(median !== undefined ? { median } : {}) };
  return {
    date,
    players: scores.length,
    buckets,
    below: scores.filter((s) => s < score).length,
    equal: scores.filter((s) => s === score).length,
    ...(median !== undefined ? { median } : {}),
  };
}

/** "Better than 72% of players" (ties count half), or null with too few players. */
export function percentBeaten(stats: Pick<GeoDailyStats, "players" | "below" | "equal">): number | null {
  if (stats.players < COMPARE_MIN_PLAYERS || stats.below === undefined) return null;
  return Math.round(((stats.below + (stats.equal ?? 0) / 2) / stats.players) * 100);
}
