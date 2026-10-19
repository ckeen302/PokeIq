/**
 * Duels beyond PokéGuessr: head-to-head Pokédle (and quizzes), played
 * through a share link like PokéGuessr duels. Shared by the server (which
 * applies every rule) and the client.
 */

import { DLE_MAX_GUESSES, type CellStatus, type DleRow } from "./dle-types";
import type { DuelPlayerView, DuelStatus } from "./duel-types";

export const PVP_KINDS = ["pokedle"] as const;
export type PvpKind = (typeof PVP_KINDS)[number];

/** "Round 2" shows for a moment before play, so both trainers start together. */
export const PVP_LEAD_MS = 3_000;
/** A trainer the server hasn't heard from in this long has left: out of the lobby, or a forfeit mid-duel. */
export const PVP_AWAY_MS = 30_000;
/** Shown as "connection lost" after this long without a word. */
export const PVP_QUIET_MS = 10_000;

/** played: the duel ran its course. left: stopped responding or quit. idle: sat out rounds in a row. */
export type PvpEndReason = "played" | "left" | "idle";

export interface PvpEnd {
  reason: PvpEndReason;
  /** The winner's seat, or null for a draw. */
  winner: number | null;
  at: number;
}

interface PvpViewBase {
  code: string;
  status: DuelStatus;
  /** Server clock, so timers agree whatever the device's clock says. */
  now: number;
  /** Increases with every change, so a slow response never overwrites a newer one. */
  rev: number;
  /** Your seat (0: the trainer who made the duel), or null for a visitor. */
  you: number | null;
  players: DuelPlayerView[];
  end?: PvpEnd;
  /** Once either trainer asks for a rematch: the new duel's code. */
  rematch?: string;
}

// ---------------------------------------------------------------------------
// Pokédle duels
// ---------------------------------------------------------------------------

/** Every duel is three rounds; the most points across them wins. */
export const DLE_DUEL_ROUNDS = 3;
/** Each round is open for three minutes at most. */
export const DLE_DUEL_ROUND_MS = 180_000;
/** The reveal stays up this long, unless both trainers press Next sooner. */
export const DLE_DUEL_REVEAL_MS = 15_000;
/** Running out the clock without a single guess this many rounds in a row is a forfeit. */
export const DLE_DUEL_IDLE_ROUNDS = 2;

/** A first-guess solve. Each guess after the first costs DLE_DUEL_GUESS_COST, down to 300 on the last guess. */
export const DLE_DUEL_SOLVE_POINTS = 1000;
export const DLE_DUEL_GUESS_COST = Math.round(700 / (DLE_MAX_GUESSES - 1));
/** Solving at once earns this much more, falling linearly to 0 at the round's time limit. */
export const DLE_DUEL_SPEED_BONUS = 150;

/** Hints are opt-in in a duel, once each per round after your first guess, and cost points. */
export const DLE_DUEL_HINTS = ["genus", "silhouette"] as const;
export type DleDuelHint = (typeof DLE_DUEL_HINTS)[number];
export const DLE_DUEL_HINT_COST: Record<DleDuelHint, number> = { genus: 150, silhouette: 300 };

/** Points for solving in `guesses`. */
export const dleDuelBase = (guesses: number) => DLE_DUEL_SOLVE_POINTS - (guesses - 1) * DLE_DUEL_GUESS_COST;
/** The speed bonus for solving `ms` into a round. */
export const dleDuelSpeed = (ms: number) => Math.round(DLE_DUEL_SPEED_BONUS * Math.max(0, 1 - ms / DLE_DUEL_ROUND_MS));

/** One trainer's guesses in a round, as the opponent may see them: colours only, never the Pokémon. */
export interface DleDuelBoard {
  /** Each guess's feedback, oldest first, in DLE_COLUMNS order. */
  colours: CellStatus[][];
  solved: boolean;
  /** Solved, or out of guesses. */
  done: boolean;
  /** Time from the round's start to the solve. */
  ms?: number;
  /** Hints bought this round: the opponent sees which, never the hints themselves. */
  hints: DleDuelHint[];
}

/** A trainer's points for a round, and how they add up. */
export interface DleDuelScore {
  guesses: number;
  solved: boolean;
  /** Time to the solve. */
  ms?: number;
  /** For solving in that many guesses (0 if unsolved). */
  base: number;
  speed: number;
  /** Hints bought. */
  cost: number;
  /** base + speed − cost, never below 0. */
  points: number;
}

export interface DleDuelLiveRound {
  index: number;
  /** Server time guessing opens. */
  startsAt: number;
  /** Server time the round closes, solved or not. */
  endsAt: number;
  /** One per seat. */
  boards: DleDuelBoard[];
  /** Your own guesses with full feedback (empty for a visitor). */
  rows: DleRow[];
  /** The hints you bought. */
  hints: { silhouetteUrl?: string; genus?: string };
}

export interface DleDuelRoundResult {
  index: number;
  answer: { id: number; name: string; imageUrl: string; genus: string };
  /** Both trainers' guesses in full, now that the round is over. */
  boards: (DleDuelBoard & { rows: DleRow[] })[];
  scores: DleDuelScore[];
  /** Points so far, after this round. */
  totals: number[];
  /** The clock ran out. */
  timedOut: boolean;
}

export interface DleDuelView extends PvpViewBase {
  kind: "pokedle";
  /** The generations secrets come from (none: all of them). The creator picks in the lobby. */
  gens?: number[];
  rounds: number;
  /** Points so far. */
  totals: number[];
  /** The round being played, until it's over. */
  round?: DleDuelLiveRound;
  revealed: DleDuelRoundResult[];
  /** During a reveal: when the next round starts, and who has pressed Next. */
  next?: { at: number; pressed: boolean[] };
}

export type PvpView = DleDuelView;

/** Creating, joining or rematching a duel: its code, your seat's token and the duel. */
export interface PvpSeatResponse {
  code: string;
  token: string;
  view: PvpView;
}

/** Where each kind of duel is played. */
export const pvpHref = (kind: PvpKind, code: string) => `/${kind}/duel/${code}`;
