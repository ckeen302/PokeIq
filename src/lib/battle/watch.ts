import type { PlayFormatId } from "./play";
import type { AvatarMap } from "../avatar";

/**
 * The Watch lobby: live battles anyone may spectate (matchmade battles, and
 * friend battles whose host let anyone watch), as the lobby lists them.
 * Only public facts: never a team, a request or a seat secret.
 */

export interface WatchEntry {
  code: string;
  format: PlayFormatId;
  /** The format's name as the players see it. */
  formatName: string;
  players: { name: string; rating?: number }[];
  ranked: boolean;
  turn: number;
  spectators: number;
  /** When the battle began (server time). */
  startedAt: number;
}

export interface WatchResponse {
  now: number;
  battles: WatchEntry[];
  /** The players' avatars, by lower-cased name. */
  avatars?: AvatarMap;
}

/** "just now", "3 min ago", "1 h 5 min ago". */
export function startedAgo(startedAt: number, now: number): string {
  const min = Math.floor(Math.max(0, now - startedAt) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ${min % 60} min ago`;
}
