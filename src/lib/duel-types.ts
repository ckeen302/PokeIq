import type { PublicAvatar } from "./avatar";
import type { GeoEra } from "./geo-families";
/**
 * PokéGuessr duels: two trainers, the same rounds, GeoGuessr Duels rules.
 * Shared by the server (which applies every rule) and the client.
 */

import type { GeoAnswer, GeoRounds } from "./geo-types";
import type { GeoDuelRankedView } from "./geo-ranked";
import type { PvpEmoteView } from "./pvp-types";
import type { ChatLine } from "./chat";

import { DUEL_COUNTDOWN_MS, DUEL_HP, DUEL_TURBO_CAP_MS, rampMultiplier } from "./geo-duel-rules";

export { DUEL_COUNTDOWN_MS, DUEL_HP, DUEL_TURBO_CAP_MS };
/** A duel lasts this many rounds at most; then the trainer with more HP wins. */
export const DUEL_MAX_ROUNDS = 10;
/** The ramp's multiplier for a round (geo-duel-rules.ts): ×1 for rounds 1–3, ×1.5 for 4–6, ×2 for 7–9, then +0.5 every three. */
export const duelMultiplier = rampMultiplier;

/** A round is open for 90 s at most; once one trainer guesses, the other has 15 s (10 s in Turbo). */
export const DUEL_ROUND_MS = 90_000;
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

/** hp: the lower score each round loses HP (default). race: a fixed number of rounds, highest total wins. */
export type DuelMode = "hp" | "race";
export const DUEL_MODES: readonly DuelMode[] = ["hp", "race"];

/** How a duel is set up: the mode and, for a points race, how many rounds. */
export interface DuelSettings {
  mode: DuelMode;
  rounds?: GeoRounds;
  /** Turbo: a guess caps the opponent's remaining time at 10 s instead of 15. */
  turbo?: boolean;
}

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
  /** The Gym Leader bot (PokéGuessr ranked matchmaking when no trainer turns up). Never a human. */
  bot?: boolean;
}

export interface DuelRoundResult {
  index: number;
  /** The multiplier that applied: the round winner's own (1 on a tie). */
  multiplier: number;
  /** Each seat's own multiplier for the round. */
  multipliers: number[];
  shot: string;
  answer: GeoAnswer;
  /** One per seat: the pin, its score and distance, or null (no guess in time: 0 points). */
  guesses: ({ x: number; y: number; score: number; squares: number } | null)[];
  /** The score gap times the winner's multiplier, in full: it can exceed the loser's remaining HP. */
  damage: number;
  /** The seat that took the damage; null when the scores tie. */
  hurt: number | null;
  /** The seat that won the round; null when the scores tie. */
  winner: number | null;
  /** HP before and after the round. */
  hpBefore: number[];
  hp: number[];
}

export interface DuelLiveRound {
  index: number;
  /** The ramp's multiplier for the round. */
  multiplier: number;
  /** Each seat's own multiplier for the round (the winner's applies). */
  multipliers: number[];
  /** Server time the screenshot appears. */
  startsAt: number;
  /** Sent once the round has started. */
  shot?: string;
  /** When guessing closes: 90 s after the start, or 15 s (Turbo: 10 s) after the first guess. */
  endsAt: number;
  /** Someone has guessed, so the countdown is on. */
  countdown: boolean;
  guessed: boolean[];
  /** Your own pin, once locked in. The opponent's is never sent before the reveal. */
  yours?: { x: number; y: number };
}

export interface DuelView {
  code: string;
  /** The map: the world or a region. */
  region: string;
  /** Only Classic 2D or Modern 3D screenshots (every game when unset). */
  era?: GeoEra;
  /** "race": a set number of rounds, highest total wins (with `totals` per seat). */
  mode: DuelMode;
  totals?: number[];
  /** Turbo: a guess caps the opponent's remaining time at 10 s. */
  turbo?: boolean;
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
  /** A ranked duel: each seat's Elo going in and, once counted, how it moved. */
  ranked?: GeoDuelRankedView;
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
