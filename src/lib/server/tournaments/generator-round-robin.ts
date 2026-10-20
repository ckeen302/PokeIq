/**
 * Round-robin tables: everyone plays everyone once.
 *
 * Ported from Pokémon Showdown's server/tournaments/generator-round-robin.ts
 * (https://github.com/smogon/pokemon-showdown), MIT License,
 * Copyright (c) 2011-2026 Guangcong Luo and other contributors.
 *
 * Changes: singles only (no "double" round robin); the table is plain JSON
 * the server stores, players are indices into the tournament's player list,
 * and the scores (a win 1, a draw ½, as Showdown's tournaments count them)
 * are kept by the caller.
 */

export interface RRMatch {
  state: "available" | "finished";
  result?: "win" | "loss" | "draw";
  score?: number[];
}

export interface RRTable {
  /** matches[row][col], only for col < row (row is player 1). */
  matches: (RRMatch | null)[][];
  pending: number;
}

export function freezeRoundRobin(players: number): RRTable {
  const matches = Array.from({ length: players }, (_, row) => Array.from({ length: players }, (_, col) => (col >= row ? null : { state: "available" as const })));
  return { matches, pending: (players * (players - 1)) / 2 };
}

/** Matches still to play: [row, col] (player 1, player 2). */
export function availableRRMatches(t: RRTable): [number, number][] {
  const out: [number, number][] = [];
  t.matches.forEach((row, r) => row.forEach((m, c) => m?.state === "available" && out.push([r, c])));
  return out;
}

export function setRRResult(t: RRTable, row: number, col: number, result: "win" | "loss" | "draw", score: number[]): string {
  const match = t.matches[row]?.[col];
  if (!match || match.state !== "available") return "InvalidMatch";
  match.state = "finished";
  match.result = result;
  match.score = score.slice();
  t.pending--;
  return "";
}

/** A disqualified player loses every match they haven't played. Returns the matches it decided: [row, col, result]. */
export function disqualifyRR(t: RRTable, player: number): [number, number, "win" | "loss"][] {
  const decided: [number, number, "win" | "loss"][] = [];
  for (const [col, match] of t.matches[player].entries()) {
    if (match?.state !== "available") continue;
    setRRResult(t, player, col, "loss", [0, 1]);
    decided.push([player, col, "loss"]);
  }
  for (const [row, cols] of t.matches.entries()) {
    if (cols[player]?.state !== "available") continue;
    setRRResult(t, row, player, "win", [1, 0]);
    decided.push([row, player, "win"]);
  }
  return decided;
}

export const rrEnded = (t: RRTable) => t.pending === 0;

/** Places by score, best first; equal scores share a place. */
export function rrResults(scores: number[]): number[][] {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const out: number[][] = [];
  let last = Infinity;
  for (const [s, i] of order) {
    if (s < last) {
      out.push([]);
      last = s;
    }
    out[out.length - 1].push(i);
  }
  return out;
}
