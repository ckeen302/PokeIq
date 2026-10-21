import type { PublicAvatar } from "./avatar";
/**
 * PokéGuessr duels: two trainers, the same rounds, GeoGuessr Duels rules.
 * Shared by the server (which applies every rule) and the client.
 */

import type { GeoAnswer } from "./geo-types";
import type { PvpEmoteView } from "./pvp-types";
import type { ChatLine } from "./chat";

/** Each trainer starts with this much HP. */
export const DUEL_HP = 6000;
/** A duel lasts this many rounds at most; then the trainer with more HP wins. */
export const DUEL_MAX_ROUNDS = 10;
/** The lower score loses the difference times the round's multiplier: 1× at first, rising from round 4. */
const MULTIPLIERS = [1, 1, 1, 1.5, 1.5, 2, 2, 2.5, 2.5, 3];
export const duelMultiplier = (index: number) => MULTIPLIERS[Math.min(index, MULTIPLIERS.length - 1)];

/** A round is open for 90 s at most; once one trainer guesses, the other has 15 s. */
export const DUEL_ROUND_MS = 90_000;
export const DUEL_COUNTDOWN_MS = 15_000;
/** "Round 2" shows for a moment before the screenshot, so both trainers start together. */
export const DUEL_LEAD_MS = 3_000;
/** The reveal stays up this long, unless both trainers press Next sooner. */
export const DUEL_REVEAL_MS = 12_000;
/** A trainer the server hasn't heard from in this long has left: out of the lobby, or a forfeit mid-duel. */
export const DUEL_AWAY_MS = 30_000;
/** Shown as "connection lost" after this long without a word. */
export const DUEL_QUIET_MS = 10_000;
/** No guess in this many rounds in a row is a forfeit. */
export const DUEL_IDLE_ROUNDS = 3;

/** Duel codes: eight letters and digits, without the ones that look alike (0/o, 1/l/i). */
export const DUEL_CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
export const DUEL_NAME_RE = /^[\p{L}\p{N} _.\-']+$/u;

export type DuelStatus = "lobby" | "playing" | "finished";
/** hp: someone ran out. rounds: the last round was played. left: stopped responding or quit. idle: missed rounds in a row. */
export type DuelEndReason = "hp" | "rounds" | "left" | "idle";

export interface DuelEnd {
  reason: DuelEndReason;
  /** The winner's seat, or null for a draw. */
  winner: number | null;
  at: number;
}

export interface DuelPlayerView {
  name: string;
  /** Signed-in trainers' avatars (added by the routes). */
  avatar?: PublicAvatar;
  ready: boolean;
  /** Not heard from for a while (closed the tab, lost the connection). */
  quiet: boolean;
}

export interface DuelRoundResult {
  index: number;
  multiplier: number;
  shot: string;
  answer: GeoAnswer;
  /** One per seat: the pin, its score and distance, or null (no guess in time: 0 points). */
  guesses: ({ x: number; y: number; score: number; squares: number } | null)[];
  damage: number;
  /** The seat that took the damage; null when the scores tie. */
  hurt: number | null;
  /** HP after the round. */
  hp: number[];
}

export interface DuelLiveRound {
  index: number;
  multiplier: number;
  /** Server time the screenshot appears. */
  startsAt: number;
  /** Sent once the round has started. */
  shot?: string;
  /** When guessing closes: 90 s after the start, or 15 s after the first guess. */
  endsAt: number;
  /** Someone has guessed, so the 15 s countdown is on. */
  countdown: boolean;
  guessed: boolean[];
  /** Your own pin, once locked in. The opponent's is never sent before the reveal. */
  yours?: { x: number; y: number };
}

export interface DuelView {
  code: string;
  /** The map: the world or a region. */
  region: string;
  status: DuelStatus;
  /** Server clock, so timers agree whatever the device's clock says. */
  now: number;
  /** Increases with every change, so a slow response never overwrites a newer one. */
  rev: number;
  /** Your seat (0: the trainer who made the duel), or null for a visitor. */
  you: number | null;
  players: DuelPlayerView[];
  hp: number[];
  maxRounds: number;
  /** The round being played, until it's revealed. */
  round?: DuelLiveRound;
  revealed: DuelRoundResult[];
  /** During a reveal: when the next round starts, and who has pressed Next. */
  next?: { at: number; pressed: boolean[] };
  end?: DuelEnd;
  /** Once either trainer asks for a rematch: the new duel's code. */
  rematch?: string;
  /** Reactions sent in the last few seconds, oldest first. */
  emotes?: PvpEmoteView[];
  /** Chat, oldest first: open in the lobby and after the end. */
  chat?: ChatLine[];
}

/** Creating, joining or rematching a duel: its code, your seat's token and the duel. */
export interface DuelSeatResponse {
  code: string;
  token: string;
  view: DuelView;
}
