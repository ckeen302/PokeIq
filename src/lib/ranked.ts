/**
 * Ranked Pokédle duels: the rating maths and the tiers, shared by the server
 * (which applies every rating change) and the client (which draws the badge
 * and the progress bar).
 *
 * Ratings are Elo. Everyone starts at 1,000. A trainer's first ten ranked
 * games are provisional and move their rating faster (a larger K), so they
 * find their level quickly; after that the K settles down. A win scores 1, a
 * draw ½, a loss 0. Leaving (or sitting out) is a loss; when both trainers
 * walk away from a duel that has no winner, both take the loss.
 */

import type { PvpEndReason } from "./pvp-types";

export const RANKED_START = 1000;
/** Games before a rating stops being provisional. */
export const RANKED_PROVISIONAL_GAMES = 10;
export const RANKED_K_PROVISIONAL = 48;
export const RANKED_K = 24;
/** Nobody drops below this. */
export const RANKED_FLOOR = 100;

export interface RatingState {
  rating: number;
  /** Ranked games finished before this one. */
  games: number;
  /** Battle ladders: the trainer's Elo (the number the battle shows), paired by `rating` (Glicko-2). */
  elo?: number;
}

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
}

export const isProvisional = (games: number) => games < RANKED_PROVISIONAL_GAMES;
export const kFactor = (games: number) => (isProvisional(games) ? RANKED_K_PROVISIONAL : RANKED_K);

/** The chance (0 to 1) Elo gives `a` of beating `b`. */
export const expectedScore = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/**
 * Each seat's score (1 win, ½ draw, 0 loss) from how a duel ended. A duel
 * played out to a draw is ½ each; one that ended because both trainers left
 * or sat out, with no winner, is a loss for both.
 */
export function matchScores(reason: PvpEndReason, winner: number | null): [number, number] {
  if (winner === 0) return [1, 0];
  if (winner === 1) return [0, 1];
  return reason === "played" ? [0.5, 0.5] : [0, 0];
}

/** Both trainers' new ratings after a game. Each moves by its own K (provisional or not). */
export function rateMatch(players: readonly [RatingState, RatingState], scores: readonly [number, number]): [RatingChange, RatingChange] {
  const [a, b] = players;
  const change = (me: RatingState, them: RatingState, score: number): RatingChange => {
    const after = Math.max(RANKED_FLOOR, Math.round(me.rating + kFactor(me.games) * (score - expectedScore(me.rating, them.rating))));
    return { before: me.rating, after, delta: after - me.rating };
  };
  return [change(a, b, scores[0]), change(b, a, scores[1])];
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export const RANKED_TIERS = [
  { id: "poke", name: "Poké Ball", from: 0 },
  { id: "great", name: "Great Ball", from: 1200 },
  { id: "ultra", name: "Ultra Ball", from: 1500 },
  { id: "master", name: "Master Ball", from: 1800 },
] as const;
export type RankedTierId = (typeof RANKED_TIERS)[number]["id"];

/** Every tier but Master has three divisions, III (lowest) to I, 100 points each. */
const DIVISION_SPAN = 100;
const DIVISIONS = ["III", "II", "I"] as const;
/** Poké Ball III has no floor; its bar starts here. */
const BOTTOM = 900;

export interface RankedTier {
  tier: RankedTierId;
  name: string;
  /** "III", "II", "I", or null in Master Ball. */
  division: (typeof DIVISIONS)[number] | null;
  /** "Great Ball II". */
  label: string;
  /** A number that grows with every division: compare two to spot a promotion. */
  step: number;
  /** How far through this division (0 to 1); Master Ball is always full. */
  progress: number;
  /** The next division's label and the rating it starts at, or null at the top. */
  next: { label: string; at: number } | null;
}

/** The division a rating sits in, and how far it is to the next. */
export function tierOf(rating: number): RankedTier {
  const t = [...RANKED_TIERS].reverse().find((x) => rating >= x.from)!;
  if (t.id === "master") return { tier: t.id, name: t.name, division: null, label: t.name, step: 9, progress: 1, next: null };
  const index = RANKED_TIERS.findIndex((x) => x.id === t.id);
  const top = RANKED_TIERS[index + 1].from;
  // Divisions count down from the top of the tier: [top - 100, top) is I.
  const fromTop = Math.max(0, Math.min(2, Math.floor((top - 1 - rating) / DIVISION_SPAN)));
  const division = DIVISIONS[2 - fromTop];
  const floor = top - (fromTop + 1) * DIVISION_SPAN;
  const start = index === 0 && fromTop === 2 ? BOTTOM : floor;
  const end = floor + DIVISION_SPAN;
  const progress = Math.max(0, Math.min(1, (rating - start) / (end - start)));
  const nextLabel = division === "I" ? (RANKED_TIERS[index + 1].id === "master" ? "Master Ball" : `${RANKED_TIERS[index + 1].name} III`) : `${t.name} ${DIVISIONS[3 - fromTop]}`;
  return { tier: t.id, name: t.name, division, label: `${t.name} ${division}`, step: index * 3 + (2 - fromTop), progress, next: { label: nextLabel, at: end } };
}

/** A ranked player's standing, as /api/pokedle/ranked returns it. */
export interface RankedStanding {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Ranked wins in a row, right now. */
  streak: number;
  bestStreak: number;
  /** Place on the ladder (1 is the top), or null before a first game. */
  position: number | null;
  /** Ranked players in all. */
  players: number;
  /** Glicko-2 ladders (battles): the rating deviation and GXE. */
  rd?: number;
  gxe?: number;
  /** Battle ladders: the trainer's Elo, the headline rating and the ladder's order (lib/rating/elo.ts). */
  elo?: number;
}

export interface RankedLeaderRow {
  position: number;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  /** Glicko-2 ladders (battles): the rating deviation and GXE. */
  rd?: number;
  gxe?: number;
  /** Battle ladders: the trainer's Elo, the headline rating and the ladder's order. */
  elo?: number;
}

export type RankedResponse =
  | { available: false; id?: string }
  | { available: true; id?: string; you: RankedStanding | null; top?: RankedLeaderRow[] };

