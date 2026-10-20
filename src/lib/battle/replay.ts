import type { BattleEndReason, PlayFormatId } from "./play";

/**
 * Battle replays: a finished battle's public log (the spectator channel,
 * exactly what Showdown's spectators saw: no team was ever revealed beyond
 * what played out), with who played and how it ended. Shared by the server,
 * the replay viewer and the lists.
 */

/** A replay's id is its battle's code. */
export const REPLAY_ID_RE = /^[a-hjkmnp-z2-9]{8}$/;

export interface ReplaySummary {
  id: string;
  format: PlayFormatId;
  formatName: string;
  players: [string, string];
  /** Ranked: each trainer's rating before the battle. */
  ratings?: [number, number];
  /** The winner's seat (0 played p1), or null for a draw. */
  winner: 0 | 1 | null;
  /** How it ended (a forfeit, the clock, a disconnect, or played out). */
  reason: BattleEndReason;
  turns: number;
  ranked: boolean;
  /** Listed in recent replays (ranked and public battles); otherwise only people with the link can watch it. */
  public: boolean;
  uploadedAt: number;
}

export interface ReplayData extends ReplaySummary {
  /** The spectator channel, line by line. */
  log: string[];
}

export interface ReplayListResponse {
  available: boolean;
  replays: ReplaySummary[];
}

/** "Red beat Blue", "Red and Blue drew". */
export function replayResult(r: Pick<ReplaySummary, "players" | "winner">): string {
  if (r.winner === null) return `${r.players[0]} and ${r.players[1]} drew`;
  return `${r.players[r.winner]} beat ${r.players[1 - r.winner]}`;
}

/**
 * Where each turn starts in a log: `starts[t]` is the index of the
 * `|turn|t` line (`starts[0]` is 0, the lead-up to turn 1).
 */
export function turnStarts(log: readonly string[]): number[] {
  const starts = [0];
  log.forEach((line, i) => {
    const m = /^\|turn\|(\d+)/.exec(line);
    if (m) starts[Number(m[1])] = i;
  });
  // A turn that never came (a malformed log) starts where the previous one did.
  for (let t = 1; t < starts.length; t++) starts[t] ??= starts[t - 1];
  return starts;
}

/** The last turn a log reaches. */
export const lastTurn = (log: readonly string[]) => turnStarts(log).length - 1;

/**
 * The lines up to the start of turn `turn` (its `|turn|` line included);
 * past the last turn, the whole log (the end of the battle).
 */
export function linesThrough(log: readonly string[], turn: number): string[] {
  const starts = turnStarts(log);
  if (turn >= starts.length) return [...log];
  return log.slice(0, starts[Math.max(1, turn)] + 1);
}
