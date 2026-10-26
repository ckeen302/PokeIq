import type { RankedLeaderRow, RankedStanding } from "@/lib/ranked";
import type { BattleEndReason } from "./play";
import type { PvpEndReason } from "@/lib/pvp-types";
import { PLAY_FORMATS, type StandardFormatId } from "./play";

/**
 * The battle ladder: one Glicko-2 rating per trainer per format (glicko.ts),
 * shown with GXE as on Pokémon Showdown: everyone starts at 1500 ± 350, a
 * forfeit, a timeout or leaving is a loss, and each battle counts once.
 */

/** Ranked queues: every current format, Random Battle and Random Doubles included. */
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
