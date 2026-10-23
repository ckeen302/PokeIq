import { CONN_LEVELS, type ConnLevel } from "./types";
import type { CustomSummary } from "./custom";

/**
 * PokéConnections' social layer, client-safe: feedback and reports, group
 * stats, the friends board, "Beat my time" links, hints and creator pages.
 * Only the shapes the API sends and the small rules both sides share live
 * here; nothing in it carries a puzzle's groups.
 */

// Feedback -------------------------------------------------------------------

export const REPORT_REASONS = ["wrong-fact", "unfair", "too-obscure"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_LABELS: Record<ReportReason, string> = { "wrong-fact": "Wrong fact", unfair: "Unfair", "too-obscure": "Too obscure" };

/** POST /api/connections/feedback: what was stored (or already was). `available: false` when feedback is off. */
export interface ConnFeedbackResponse {
  available: boolean;
  rated?: boolean;
  reported?: boolean;
}

// Group stats ----------------------------------------------------------------

/** How many of today's players must have finished before group percentages are shown. */
export const GROUP_STATS_MIN = 5;

/** Per group (index = level): the % of today's players who found it. */
export interface ConnGroupStats {
  players: number;
  pct: [number, number, number, number];
}

/** "Only 12% found purple" / "88% found yellow": null while there are too few players. */
export function groupStatLine(stats: ConnGroupStats | undefined | null, level: ConnLevel): string | null {
  if (!stats || stats.players < GROUP_STATS_MIN) return null;
  const pct = stats.pct[level];
  const colour = CONN_LEVELS[level].name.toLowerCase();
  return pct < 50 ? `Only ${pct}% found ${colour}` : `${pct}% found ${colour}`;
}

// Hints ----------------------------------------------------------------------

/** POST /api/connections/hint: one Pokémon of the easiest unsolved group. Asking again returns the same one. */
export type ConnHintResponse = { available: true; hint: { id: number; level: ConnLevel } } | { available: false };

// Friends and "Beat my time" ---------------------------------------------------

export interface ConnFriendRow {
  name: string;
  mistakes: number;
  ms: number;
  hinted: boolean;
  you: boolean;
}

/** GET /api/connections/leaderboard?scope=friends: you and your friends today (null rows: off, or not signed in). */
export interface ConnFriendsBoardResponse {
  date: string;
  rows: ConnFriendRow[] | null;
  signedIn: boolean;
}

/** A friend's result to beat: from their share link, signed by the server. */
export interface ConnChallenge {
  date: string;
  name: string;
  mistakes: number;
  ms: number;
  hinted: boolean;
}

export const beatPath = (token: string) => `/connections?beat=${encodeURIComponent(token)}`;

export interface ConnScore {
  mistakes: number;
  ms: number;
  hinted: boolean;
}

/** The board's order: hint-free before hinted, then fewer mistakes, then faster. Negative: `a` ranks higher. */
export const compareScores = (a: ConnScore, b: ConnScore) => Number(a.hinted) - Number(b.hinted) || a.mistakes - b.mistakes || a.ms - b.ms;

/** How your result stands against a friend's. */
export function beatVerdict(mine: ConnScore, theirs: ConnScore): "beat" | "lost" | "tied" {
  const c = compareScores(mine, theirs);
  return c < 0 ? "beat" : c > 0 ? "lost" : "tied";
}

// Creators and the Puzzle of the Day ------------------------------------------

export const CREATOR_NAME_RE = /^[\p{L}\p{N} _.'’-]{1,24}$/u;
export const creatorPath = (name: string) => `/connections/creator/${encodeURIComponent(name)}`;
export const FEATURED_BADGE_ID = "conn-featured";

export interface ConnPotdResponse {
  available: boolean;
  puzzle: CustomSummary | null;
}

export interface CreatorPage {
  name: string;
  puzzles: CustomSummary[];
  /** Up votes across their puzzles. */
  votes: number;
  /** Up minus down. */
  score: number;
}

// Admin ------------------------------------------------------------------------

export interface ConnCategoryFeedback {
  category: string;
  label: string;
  reports: number;
  reasons: Record<ReportReason, number>;
  up: number;
  down: number;
  disabled: boolean;
}
