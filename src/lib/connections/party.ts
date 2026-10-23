import type { ConnGroupExplained, ConnGroupReveal, ConnGuessKind, ConnTile } from "./types";
import { CONN_DUEL_PENALTY_MS } from "@/lib/pvp-types";
import type { DuelStatus } from "@/lib/duel-types";

/**
 * PokéConnections party mode, client-safe: 2 to 8 trainers race the same
 * puzzle from a share link. Everyone sees the others' placings as counts
 * (groups found, mistakes), never which tiles; the answers reach a trainer
 * only as they find groups, and all of them once the party is over.
 */

export const PARTY_MIN = 2;
export const PARTY_MAX = 8;
/** The party's clock: from the start of the race to the end at the latest. */
export const PARTY_MS = 10 * 60_000;
/** A mistake adds this to a solve's time (as in a duel). */
export const PARTY_PENALTY_MS = CONN_DUEL_PENALTY_MS;

export const partyHref = (code: string) => `/connections/party/${code}`;

export interface PartyPlayerView {
  name: string;
  ready: boolean;
  /** Not heard from for a while. */
  away: boolean;
  host: boolean;
  /** Left the party mid-race. */
  left: boolean;
}

/** One line of the placings. */
export interface PartyStanding {
  seat: number;
  name: string;
  /** 1 is ahead. */
  place: number;
  /** Groups found (a count, never which). */
  found: number;
  mistakes: number;
  solved: boolean;
  /** Out of mistakes, or gone. */
  out: boolean;
  /** A solve's time (from the start to the last group). */
  ms?: number;
  /** A solve's time plus the penalties: the lower wins. */
  score?: number;
}

/** GET /api/connections/party/:code: the party as one player (or a visitor) may see it. */
export interface PartyView {
  kind: "party";
  code: string;
  rev: number;
  now: number;
  status: DuelStatus;
  /** Your seat, or null for a visitor. */
  you: number | null;
  min: number;
  max: number;
  players: PartyPlayerView[];
  /** While the race is on (the start is a few seconds after the last ready-up). */
  round?: { startsAt: number; endsAt: number };
  /** The sixteen tiles, once the race has started. */
  tiles?: ConnTile[];
  /** Live placings during the race; the final standings after it. Empty in the lobby. */
  standings: PartyStanding[];
  /** Your own guesses, results and the groups you found. */
  mine?: { guesses: number[][]; results: ConnGuessKind[]; found: ConnGroupReveal[] };
  /** After the end only: all four groups, explained. */
  reveal?: ConnGroupExplained[];
  /** Set when the party is over: the winning seat (null: nobody found a group). */
  end?: { at: number; winner: number | null };
}

export interface PartySeatResponse {
  code: string;
  token: string;
  view: PartyView;
}
