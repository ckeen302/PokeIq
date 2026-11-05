import "server-only";
import type { PvpFailure } from "../duel-core";
import { cancelQueue, searchQueue } from "../match-queue";
import { cancelRankedQueue, searchRankedQueue, type Pairable } from "../ranked-queue";
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

/**
 * Showdown's search window (server/ladders.ts matchmakingOK), on Elo: it
 * starts at 50 in the current generation's OU and Random Battle (the busiest
 * ladders) and 100 elsewhere, grows by 1 every 0.3 s of the longer wait, then
 * by a tenth of that once past 300 (1 every 3 s), and never passes 600.
 */
export const SEARCH_RANGE_BUSY = 50;
export const SEARCH_RANGE_BASE = 100;
export const SEARCH_RANGE_MS_PER_POINT = 300;
export const SEARCH_RANGE_KNEE = 300;
export const SEARCH_RANGE_SLOWDOWN = 10;
export const SEARCH_RANGE_MAX = 600;
const BUSY_LADDERS: readonly StandardFormatId[] = ["gen9ou", "gen9randombattle"];

/** The Elo gap two trainers may be paired across after the longer of them has waited `elapsedMs`. */
export function battleSearchRange(format: StandardFormatId, elapsedMs: number): number {
  let range = (BUSY_LADDERS.includes(format) ? SEARCH_RANGE_BUSY : SEARCH_RANGE_BASE) + Math.max(0, elapsedMs) / SEARCH_RANGE_MS_PER_POINT;
  if (range > SEARCH_RANGE_KNEE) range = SEARCH_RANGE_KNEE + (range - SEARCH_RANGE_KNEE) / SEARCH_RANGE_SLOWDOWN;
  return Math.min(range, SEARCH_RANGE_MAX);
}

/** Showdown's rule: the Elo gap within the window of the longer wait of the two. */
export const battlePairable =
  (format: StandardFormatId): Pairable =>
  (gap, waits) =>
    gap <= battleSearchRange(format, Math.max(waits[0], waits[1]));

/** One ranked queue per ladder format; trainers in it are paired by rating (ranked-queue.ts). */
export const rankedBattleQueueKey = (format: StandardFormatId) => `battle-ranked:${format}`;

/**
 * A ranked search (or its next poll): paired with the closest Elo in the
 * format's queue, within Showdown's window (battleSearchRange), never with
 * a trainer on the same connection (`ipHash`, a salted HMAC of the IP) or
 * the one either of them last played. `player` is the trainer's ladder key;
 * `rating` reads their rating in this format (only when it's needed). In
 * bring-your-own formats the team is checked before anything else.
 */
export async function searchRankedBattle(
  format: StandardFormatId,
  name: string,
  ticket: string,
  player: string,
  rating: () => Promise<RatingState>,
  team?: string,
  ipHash?: string
): Promise<BattleSearchResult | PvpFailure> {
  const checked = checkTeam(format, team);
  if (!checked.ok) return checked;
  const out = await searchRankedQueue(
    { ticket, name, player, team: checked.packed, ...(ipHash ? { ipHash } : {}) },
    rating,
    async (players, now) => {
      if (!PLAY_FORMAT_INFO[format].random && players.some((p) => !p.team)) return null;
      const opened = await createMatchedBattle(
        format,
        players.map((p) => ({ name: p.name, team: p.team, player: p.player, rating: { rating: p.rating, games: p.games, ...(p.elo !== undefined ? { elo: p.elo } : {}) } })) as [MatchedPlayer, MatchedPlayer],
        now,
        { ranked: true }
      );
      return opened && { ...opened, remove: () => deleteBattle(opened.code) };
    },
    rankedBattleQueueKey(format),
    battlePairable(format),
    { gapOn: "elo", strict: true }
  );
  if (!out.ok || out.status === "waiting") return out;
  return { ok: true, status: "matched", code: out.code, token: battleToken(out.code, out.playerId, out.seat), href: battleHref("pvp", out.code) };
}
