import type { DuelStatus } from "@/lib/duel-types";

/**
 * Name 'em All races, client-safe: 2 to 8 trainers name the same category
 * from a share link, everyone's progress live as bars. The first to name
 * them all wins; when the clock runs out, the most named wins (the earlier
 * last name breaks a tie). Players see each other's counts, never which.
 */

export const RACE_MIN = 2;
export const RACE_MAX = 8;
export const RACE_MINUTES = [3, 5, 10, 15, 20, 30, 60] as const;

export const raceHref = (code: string) => `/quiz/name-em-all/race/${code}`;

export interface NeaRacePlayerView {
  name: string;
  ready: boolean;
  away: boolean;
  host: boolean;
  left: boolean;
}

export interface NeaRaceStanding {
  seat: number;
  name: string;
  /** 1 is ahead. */
  place: number;
  named: number;
  /** Named them all; `ms` is the time. */
  done: boolean;
  /** Left or gone quiet. */
  out: boolean;
  /** Time of the last name. */
  ms?: number;
}

/** GET /api/name-em-all/race/:code — the race as one trainer (or a visitor: you null) may see it. */
export interface NeaRaceView {
  kind: "nea-race";
  code: string;
  rev: number;
  now: number;
  status: DuelStatus;
  you: number | null;
  min: number;
  max: number;
  category: string;
  total: number;
  minutes: number;
  players: NeaRacePlayerView[];
  /** While the race is on (it starts a few seconds after the host's go). */
  round?: { startsAt: number; endsAt: number };
  /** Live placings during the race, final after it; empty in the lobby. */
  standings: NeaRaceStanding[];
  /** The slots you've named, in order. */
  mine?: number[];
  end?: { at: number; winner: number | null };
}

export interface NeaRaceSeatResponse {
  code: string;
  token: string;
  view: NeaRaceView;
}
