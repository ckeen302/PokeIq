import { ALL_FORMATS, PLAY_FORMAT_INFO, type PlayFormatId, type StandardFormatId } from "@/lib/battle/play";
import type { AvatarMap } from "./avatar";

/**
 * Tournaments, shared by the server (which owns every tournament: sign-ups,
 * the bracket, each match's battles) and the pages that show them.
 */

/** Any format matchmaking offers. */
export const TOURNAMENT_FORMATS = ["factory", ...ALL_FORMATS] as readonly (StandardFormatId | "factory")[];
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];
export const isTournamentFormat = (f: unknown): f is TournamentFormat => typeof f === "string" && (TOURNAMENT_FORMATS as readonly string[]).includes(f);

export type TournamentStyle = "elim" | "rr";
export const STYLE_NAME: Record<TournamentStyle, string> = { elim: "Single elimination", rr: "Round robin" };

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 64;
/** Round robin plays everyone against everyone: kept small. */
export const MAX_RR_PLAYERS = 12;
/** Sign-up windows a creator can pick, in minutes. */
export const SIGNUP_MINUTES = [2, 5, 10, 15, 30, 60] as const;

/** A seated player who hasn't opened their match by then loses it. */
export const NO_SHOW_MS = 3 * 60_000;
/** A claim on a match (its battle being created) older than this is taken over. */
export const CLAIM_MS = 30_000;
/** Games in a match; a match is won by the first to more than half. */
export type BestOf = 1 | 3;

/** The official hourly tournament: Random Battle, sign-ups for the first OFFICIAL_SIGNUP_MIN minutes of each hour. */
export const OFFICIAL_FORMAT: TournamentFormat = "gen9randombattle";
export const OFFICIAL_SIGNUP_MIN = 10;

export type TournamentStatus = "signup" | "running" | "finished" | "cancelled";

export interface TournamentPlayerView {
  name: string;
  /** Round robin: points (a win 1, a draw ½). */
  score: number;
  wins: number;
  losses: number;
  dq: boolean;
  /** Out of an elimination bracket. */
  out: boolean;
}

/** A match as everyone may see it (never seat tokens). */
export interface TournamentMatchView {
  id: string;
  a: string;
  b: string;
  /** Games won by a and b. */
  wins: [number, number];
  state: "waiting" | "playing" | "done";
  /** The winner's name (a draw in round robin: null). */
  winner: string | null;
  /** The battle being played now (anyone can watch). */
  code: string | null;
  round: number;
  /** "noshow", "dq": how it was decided, when it wasn't by battles. */
  note?: string;
}

/** A node of the elimination tree: a player, or a match between its two children. */
export interface BracketNodeView {
  name: string | null;
  match?: string;
  children?: [BracketNodeView, BracketNodeView];
  state?: "available" | "finished" | "";
}

export interface TournamentView {
  id: string;
  title: string;
  format: TournamentFormat;
  formatName: string;
  style: TournamentStyle;
  bestOf: BestOf;
  maxPlayers: number;
  official: boolean;
  host: string | null;
  status: TournamentStatus;
  createdAt: number;
  signupEndsAt: number;
  startedAt: number | null;
  endedAt: number | null;
  players: TournamentPlayerView[];
  matches: TournamentMatchView[];
  bracket: BracketNodeView | null;
  /** Final standings, best first (names; ties share a place). */
  results: string[][] | null;
  rated: boolean;
  cancelReason?: string;
  version: number;
  now: number;
  /** The players' avatars, by lower-cased name. */
  avatars?: AvatarMap;
  /** The viewer: joined, and their match waiting to be played (with its seat token). */
  you?: { joined: boolean; host: boolean; match: { code: string; token: string; against: string } | null };
}

export interface TournamentSummary {
  id: string;
  title: string;
  formatName: string;
  style: TournamentStyle;
  bestOf: BestOf;
  official: boolean;
  status: TournamentStatus;
  players: number;
  maxPlayers: number;
  signupEndsAt: number;
  winner: string | null;
  endedAt: number | null;
}

/** "Your match is ready": shown as a toast with the heartbeat. */
export interface TournamentMatchNote {
  tournament: string;
  title: string;
  code: string;
  token: string;
  against: string;
}

export const formatName = (f: PlayFormatId) => PLAY_FORMAT_INFO[f].name;

export function tournamentTitle(format: TournamentFormat, host: string | null): string {
  const name = PLAY_FORMAT_INFO[format].short;
  return host ? `${host}'s ${name} tournament` : `Official hourly ${name}`;
}
