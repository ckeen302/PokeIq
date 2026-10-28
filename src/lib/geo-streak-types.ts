import type { GeoAnswer } from "./geo-types";

/** Region Streak (PokéGuessr): one screenshot, name the region. Shared by the server and the client. */

/** The regions a player can name, in release order (DLC areas and the Sevii Islands count as their region). */
export const GEO_STREAK_REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"] as const;
export type GeoStreakRegion = (typeof GEO_STREAK_REGIONS)[number];

/** The leaderboard board a region streak is saved under (geo_runs.mode). */
export const GEO_REGION_STREAK_BOARD = "world:region-streak";
/** The personal-best key in local progress. */
export const GEO_REGION_STREAK_KEY = "region-streak";

export interface GeoStreakStartResponse {
  token: string;
  /** The first screenshot. Nothing else: the answer stays on the server. */
  shot: string;
  regions: GeoStreakRegion[];
}

export interface GeoStreakResult {
  sid: string;
  streak: number;
  durationMs: number;
  finishedAt: number;
}

export interface GeoStreakGuessResponse {
  correct: boolean;
  /** The clock ran out with no region picked. */
  timedOut?: boolean;
  /** The region the place is in (null for a place outside the nine, which never comes up). */
  region: GeoStreakRegion | null;
  picked: GeoStreakRegion | null;
  /** Regions named right so far, this one included. */
  streak: number;
  /** The place, now that it's been picked: for the reveal and the learn card. */
  answer: GeoAnswer;
  token: string;
  /** The next screenshot, after a right pick. */
  next?: { shot: string };
  done: boolean;
  /** Signed, when the run is over: for the leaderboard and the result page. */
  resultToken?: string;
  /** Signed-in trainers: their best after this run. */
  best?: { best: number; runs: number };
}
