import type { RankedLeaderRow, RankedStanding } from "@/lib/ranked";
import type { BattleEndReason } from "./play";
import type { PvpEndReason } from "@/lib/pvp-types";
import { PLAY_FORMATS, type StandardFormatId } from "./play";

/**
 * The battle ladder: one Elo rating per trainer per format, with the same
 * maths and tiers as ranked Pokédle (lib/ranked.ts): everyone starts at
 * 1,000, the first ten games are provisional (a larger K), a forfeit, a
 * timeout or leaving is a loss, and each battle counts once.
 */

/** Ranked queues: Random Battle, Random Doubles, OU, UU, Ubers and Doubles OU. */
export const LADDER_FORMATS: readonly StandardFormatId[] = PLAY_FORMATS;
export const isLadderFormat = (f: unknown): f is StandardFormatId => typeof f === "string" && (LADDER_FORMATS as readonly string[]).includes(f);

/**
 * How a battle's end counts for the ratings, as the Pokédle ladder reads
 * it: a winner is a win and a loss whatever the reason (a forfeit, the clock
 * or a disconnect lose); a battle played out to a tie is a draw. Null: it
 * doesn't count at all (the battle couldn't go on: no contest).
 */
export function ladderReason(end: { reason: BattleEndReason; winner: 0 | 1 | null }): PvpEndReason | null {
  if (end.reason === "nocontest") return null;
  if (end.winner !== null) return "played";
  return end.reason === "normal" ? "played" : "left";
}

export type LadderResponse =
  | { available: false; id?: string }
  | { available: true; id?: string; format: StandardFormatId; you: RankedStanding | null; top?: RankedLeaderRow[] };
