import "server-only";
import { deriveSeed } from "./crypto";
import { claimOnce } from "./replay-guard";

/**
 * Leaderboard guards a scripted client can't get around by dropping cookies
 * or minting new player ids and names.
 *
 * - `claimBoardSlot`: a network address gets a few new entries on a board per
 *   period (a household or a classroom shares one address; a script farming
 *   names doesn't get a page of them). The slots are single-use claims
 *   (replay-guard: Postgres when Supabase is configured, so they hold across
 *   instances; memory otherwise). Addresses are kept only as an HMAC.
 * - `plausibleMs`: a time no person could play in isn't ranked.
 */

/** New entries per address, per board, per day (or week). */
// Generous: phone carriers put many players behind one shared address (CGNAT), and a launch brings exactly that crowd.
export const BOARD_SLOTS_PER_ADDRESS = 25;

export async function claimBoardSlot(ip: string | null | undefined, board: string, period: string, slots = BOARD_SLOTS_PER_ADDRESS): Promise<boolean> {
  if (!ip) return true;
  const who = deriveSeed("board-ip", ip);
  for (let i = 0; i < slots; i++) {
    if (await claimOnce(`board:${board}:${period}:${who}:${i}`)) return true;
  }
  return false;
}

export const BOARD_FULL = "Your network already has a few entries on this board today.";

/** Fastest believable PokéConnections daily: four groups, sixteen tiles to pick. */
export const CONN_MIN_MS = 4_000;
/** Fastest believable Pikadoku: per filled cell (open it, search, pick). */
export const PDK_MIN_MS_PER_CELL = 500;

export const plausibleMs = (ms: number | null | undefined, min: number): ms is number => typeof ms === "number" && ms >= min;

/** The UTC day a result lands on, for boards that aren't tied to a date. */
export const utcDayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
