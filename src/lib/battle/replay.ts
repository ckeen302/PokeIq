import type { BattleEndReason, GameType, PlayFormatId } from "./play";
import { translator, type Translator } from "@/i18n/catalog";
import replayWords from "@/messages/battle-replay-words";

/** A replay's words in the page's language (English by default). */
export type ReplayWordsT = Translator<typeof replayWords.en>;

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
  /** The trainers, seat by seat (four in Free-For-All and Multi Battles). */
  players: string[];
  /** Triples and four-player battles: the game type (absent: singles or doubles by format). */
  gameType?: GameType;
  /** Ranked: each trainer's Glicko-2 rating before the battle. */
  ratings?: [number, number];
  /** Ranked: each trainer's Elo before the battle (the number shown), for battles since the ladder had Elo. */
  elos?: [number, number];
  /** The winner's seat (0 played p1), or null for a draw. A Multi Battle's is the winning team's first seat. */
  winner: number | null;
  /** Four-player battles: every winning seat (both partners in a Multi Battle). */
  winners?: number[];
  /** Free-For-All: the seats from first to last. */
  standings?: number[];
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

/** Who played, as two names around a joiner: "Red" vs "Blue", "Red & Gold" vs "Blue & Silver" (Multi), "Red, Blue, Gold" and "Silver" (Free-For-All). */
export function replayMatchup(r: Pick<ReplaySummary, "players" | "gameType">): { a: string; b: string; joiner: "vs" | "and" } {
  const p = r.players;
  if (p.length === 4 && r.gameType === "multi") return { a: `${p[0]} & ${p[2]}`, b: `${p[1]} & ${p[3]}`, joiner: "vs" };
  if (p.length === 4) return { a: p.slice(0, 3).join(", "), b: p[3], joiner: "and" };
  return { a: p[0] ?? "Player 1", b: p[1] ?? "Player 2", joiner: "vs" };
}

/** "Red vs Blue", "Red & Gold vs Blue & Silver", "Red, Blue, Gold and Silver". */
export function replayTitle(r: Pick<ReplaySummary, "players" | "gameType">, t: Translator<typeof replayWords.en> = translator(replayWords, "en", undefined)): string {
  const m = replayMatchup(r);
  return t("title", { a: m.a, joiner: t(`joiner.${m.joiner}`), b: m.b });
}

/** "Red beat Blue", "Red and Blue drew"; "Red & Gold beat Blue & Silver" (Multi); "Red won a Free-For-All". */
export function replayResult(r: Pick<ReplaySummary, "players" | "winner" | "winners" | "gameType">, t: Translator<typeof replayWords.en> = translator(replayWords, "en", undefined)): string {
  if (r.players.length === 4) {
    const names = (seats: number[]) => seats.map((s) => r.players[s] ?? "?").join(" & ");
    if (r.gameType === "multi" || (r.winners?.length === 2 && r.gameType !== "freeforall")) {
      if (r.winner === null) return t("result.teamsDrew", { a: names([0, 2]), b: names([1, 3]) });
      const won = r.winner % 2;
      return t("result.beat", { a: names([won, won + 2]), b: names([1 - won, 3 - won]) });
    }
    if (r.winner === null) return t("result.noWinner", { players: r.players.join(", ") });
    return t("result.wonFfa", { name: r.players[r.winner] });
  }
  if (r.winner === null) return t("result.drew", { a: r.players[0], b: r.players[1] });
  return t("result.beat", { a: r.players[r.winner], b: r.players[1 - r.winner] });
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
