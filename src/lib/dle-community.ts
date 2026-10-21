/**
 * Pokédle community stats: how everyone did on a day's puzzle, shown only
 * once you've finished it. Shared by the server (which records results and
 * adds them up) and the client (which places you among them).
 */

import { DLE_MAX_GUESSES } from "./dle-types";
import type { DleAssist } from "./dle-assist";

/** How everyone did on one day's puzzle. The same for every trainer, so it's cached. */
export interface DleDaySummary {
  date: string;
  /** Trainers who finished the puzzle. */
  players: number;
  solved: number;
  /** dist[k]: trainers who solved it in k + 1 guesses. */
  dist: number[];
  /** Trainers who ran out of guesses. */
  failed: number;
  /** The most popular first guesses, most popular first. */
  openers: { id: number; name: string; count: number }[];
}

/** Your own result as the server kept it, and where it puts you. Never cached. */
export interface DlePersonal {
  /** This request recorded the result; false when an earlier one was kept (the first result each day counts). */
  recorded: boolean;
  guesses: number;
  solved: boolean;
  firstGuess: { id: number; name: string };
  /** The Pokédex assist level of the result kept, and its points at that level. */
  assist: DleAssist;
  score: number;
  /** Trainers who finished before you, plus you. */
  position: number;
  /** "You were the #N trainer to solve today" (null when not solved). */
  rank: number | null;
  /** Trainers who opened with the same Pokémon, you included. */
  sameOpener: number;
}

/** GET /api/pokedle/stats?date= */
export type DleStatsResponse = ({ available: true } & DleDaySummary) | { available: false };
/** POST /api/pokedle/result */
export type DleResultResponse = { available: true; you: DlePersonal } | { available: false };

/** Where you stand among everyone who finished. */
export interface DleStanding {
  /** The share of the day's trainers (0–100, whole) this result beat or tied, you included: the share text's percentile. */
  percentile: number;
  /** "Top N%" as the share text words it: 100 − percentile, 1–100, lower is better. */
  top: number;
  better: number;
  /** Did as well as you, you included. */
  same: number;
  worse: number;
}

/** What the share text can brag with: buildPokedleShare's `community`. */
export interface DleShareCommunity {
  /** The share of the day's trainers this result beat or tied (0–100). */
  percentile: number;
  players: number;
}

/** Below this many trainers a percentile says little, so it isn't shown or shared. */
export const DLE_MIN_PLAYERS_FOR_PERCENTILE = 10;

/** A result's bucket in the distribution: solves by guess count, then a miss after them all. */
export function bucketOf(result: { guesses: number; solved: boolean }, max: number = DLE_MAX_GUESSES): number {
  return result.solved ? Math.min(Math.max(result.guesses, 1), max) - 1 : max;
}

/** The distribution as one list: solves in 1 … DLE_MAX_GUESSES, then misses. */
export const buckets = (s: Pick<DleDaySummary, "dist" | "failed">) => [...s.dist, s.failed];

/** Average guesses over the solves, or null with none. */
export function averageGuesses(s: Pick<DleDaySummary, "dist">): number | null {
  const solves = s.dist.reduce((a, b) => a + b, 0);
  return solves ? s.dist.reduce((sum, n, k) => sum + n * (k + 1), 0) / solves : null;
}

/**
 * The summary with your result in it. The cached summary can be a few
 * seconds older than your result: if it has fewer trainers than had
 * finished by the time you did, you aren't in it yet, so you're added.
 */
export function withYou(summary: DleDaySummary, you: DlePersonal): DleDaySummary {
  if (summary.players >= you.position) return summary;
  const max = summary.dist.length;
  const k = bucketOf(you, max);
  const all = buckets(summary).map((n, i) => (i === k ? n + 1 : n));
  return {
    ...summary,
    players: summary.players + 1,
    solved: summary.solved + (you.solved ? 1 : 0),
    dist: all.slice(0, max),
    failed: all[max],
  };
}

/**
 * Where a result stands in the summary (which should already include it;
 * see withYou). Fewer guesses is better and a miss is worst; ties count in
 * your favour, as "beat or tied". Null when nobody has finished.
 */
export function standingOf(summary: Pick<DleDaySummary, "dist" | "failed">, result: { guesses: number; solved: boolean }): DleStanding | null {
  const all = buckets(summary);
  const k = bucketOf(result, summary.dist.length);
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  const better = sum(all.slice(0, k));
  const same = Math.max(1, all[k]);
  const worse = sum(all.slice(k + 1));
  const players = better + same + worse;
  if (players === 0) return null;
  // Whole numbers, rounded down: never claims more than the result earned.
  const percentile = Math.floor(((worse + same) * 100) / players);
  return { percentile, top: Math.min(100, Math.max(1, 100 - percentile)), better, same, worse };
}

/** For the share text, once enough trainers have finished for it to mean something. */
export function shareCommunity(summary: DleDaySummary, you: DlePersonal): DleShareCommunity | undefined {
  const s = withYou(summary, you);
  const standing = standingOf(s, you);
  return standing && s.players >= DLE_MIN_PLAYERS_FOR_PERCENTILE ? { percentile: standing.percentile, players: s.players } : undefined;
}

/** A whole-number percentage, never "0%" for a share that isn't zero. */
export function percentText(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const pct = (part / whole) * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}
