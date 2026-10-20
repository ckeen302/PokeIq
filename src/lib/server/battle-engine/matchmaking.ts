import "server-only";
import type { PvpFailure } from "../duel-core";
import { cancelQueue, searchQueue } from "../match-queue";
import { cancelRankedQueue, searchRankedQueue } from "../ranked-queue";
import type { RatingState } from "@/lib/ranked";
import { PLAY_FORMAT_INFO, battleHref, type PlayFormatId, type StandardFormatId } from "@/lib/battle/play";
import { battleToken, checkTeam, createMatchedBattle, type MatchedPlayer } from "./service";
import { deleteBattle } from "./store";

/**
 * "Find an opponent" for battles: trainers searching for the same format
 * are paired into a live battle that starts at once, both seated and ready.
 * The queue is the duels' (one `duel_queue` row per format, keyed
 * "battle:<format>"); see match-queue.ts.
 *
 * In bring-your-own formats each trainer brings their own team: it's
 * checked against the format's rules before they join the queue (a team
 * that fails never waits), and the waiting trainer's team waits with them,
 * packed, in the queue row (which only the server reads).
 */

export const battleQueueKey = (format: PlayFormatId) => `battle:${format}`;

export type BattleSearchResult =
  | { ok: true; status: "waiting"; ticket: string; since: number }
  | { ok: true; status: "matched"; code: string; token: string; href: string };

/** A search for `format` (or the next poll of one). `team` is Showdown team text, for bring-your-own formats. */
export async function searchBattle(format: PlayFormatId, name: string, ticket: string, team?: string, player?: string): Promise<BattleSearchResult | PvpFailure> {
  const out = await searchQueue(
    battleQueueKey(format),
    {
      ticket,
      name,
      player,
      bring: () => {
        const checked = checkTeam(format, team);
        return checked.ok ? { ok: true, team: checked.packed } : checked;
      },
    },
    async (players, now) => {
      // Every waiter in a team format brought a checked team (`bring` ran before they waited); never start without one.
      if (!PLAY_FORMAT_INFO[format].random && players.some((p) => !p.team)) return null;
      const opened = await createMatchedBattle(format, players, now);
      return opened && { ...opened, remove: () => deleteBattle(opened.code) };
    }
  );
  if (!out.ok || out.status === "waiting") return out;
  return { ok: true, status: "matched", code: out.code, token: battleToken(out.code, out.playerId, out.seat), href: battleHref("pvp", out.code) };
}

/** Gives up a search. */
export function cancelBattleSearch(format: PlayFormatId, ticket: string, ranked = false): Promise<void> {
  return ranked ? cancelRankedQueue(ticket, rankedBattleQueueKey(format as StandardFormatId)) : cancelQueue(battleQueueKey(format), ticket);
}

// ---------------------------------------------------------------------------
// Ranked
// ---------------------------------------------------------------------------

/** One ranked queue per ladder format; trainers in it are paired by rating (ranked-queue.ts). */
export const rankedBattleQueueKey = (format: StandardFormatId) => `battle-ranked:${format}`;

/**
 * A ranked search (or its next poll): paired with the closest rating in the
 * format's queue, within a window that widens the longer either trainer has
 * waited, as on the Pokédle ladder. `player` is the trainer's ladder key;
 * `rating` reads their rating in this format (only when it's needed). In
 * bring-your-own formats the team is checked before anything else.
 */
export async function searchRankedBattle(
  format: StandardFormatId,
  name: string,
  ticket: string,
  player: string,
  rating: () => Promise<RatingState>,
  team?: string
): Promise<BattleSearchResult | PvpFailure> {
  const checked = checkTeam(format, team);
  if (!checked.ok) return checked;
  const out = await searchRankedQueue(
    { ticket, name, player, team: checked.packed },
    rating,
    async (players, now) => {
      if (!PLAY_FORMAT_INFO[format].random && players.some((p) => !p.team)) return null;
      const opened = await createMatchedBattle(
        format,
        players.map((p) => ({ name: p.name, team: p.team, player: p.player, rating: { rating: p.rating, games: p.games } })) as [MatchedPlayer, MatchedPlayer],
        now,
        { ranked: true }
      );
      return opened && { ...opened, remove: () => deleteBattle(opened.code) };
    },
    rankedBattleQueueKey(format)
  );
  if (!out.ok || out.status === "waiting") return out;
  return { ok: true, status: "matched", code: out.code, token: battleToken(out.code, out.playerId, out.seat), href: battleHref("pvp", out.code) };
}
