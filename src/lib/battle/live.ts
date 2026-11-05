import { fingerprint } from "@/lib/polling";
import type { BattleView } from "./play";

/**
 * A live battle's "something changed" signal, shared by the server (which
 * publishes it) and the page (which subscribes): one Supabase Realtime
 * broadcast topic per battle code, carrying one kind of event, "the battle
 * is at revision N now". The page then runs its normal authenticated GET
 * with its own seat token, so the channel never carries a line of the
 * battle (the teams, the requests and every channel stay behind the GET).
 * Polling stays as the fallback, and slows to 3 s while the channel is up.
 *
 * Without Realtime (NEXT_PUBLIC_SUPABASE_ANON_KEY unset, as today) nothing
 * is published and pages poll every 500 ms while waiting on the opponent,
 * or long-poll: the GET with `wait=1` holds the answer until the battle
 * moves on (see server/battle-engine/long-poll.ts).
 */

export const battleTopic = (code: string) => `battle:${code}`;
export const BATTLE_LIVE_EVENT = "battle";

/** What rides the channel (signed by the server, see server/realtime.ts). */
export interface BattleLiveEvent {
  code: string;
  /** The battle's revision after the write: a page already at it has nothing to fetch. */
  rev: number;
  /** Server time of the write. */
  at: number;
}

/** Where a page subscribes: the project URL, the public anon key and the key broadcasts are signed with. */
export interface BattleLiveConfig {
  url: string;
  anon: string;
  key: JsonWebKey;
}

/** The event in a payload's `data`, if it is one for this battle; null otherwise. */
export function parseBattleLiveEvent(data: string, code: string): BattleLiveEvent | null {
  try {
    const e = JSON.parse(data) as Partial<BattleLiveEvent> | null;
    return e && e.code === code && typeof e.rev === "number" && Number.isFinite(e.rev) ? { code, rev: e.rev, at: typeof e.at === "number" ? e.at : 0 } : null;
  } catch {
    return null;
  }
}

/**
 * A short digest of what a page shows of the battle, for the long poll's
 * `seen`: the server answers at once when its view's digest differs from
 * the page's. Leaves out what moves without anything happening (the clock,
 * the revision, which a heartbeat bumps), what the routes add (avatars, the
 * live channel), and the lines themselves (the page asks from line `since`,
 * so only how many there are counts).
 */
export function battleSeenDigest(view: BattleView): string {
  const text = fingerprint({
    ...view,
    live: null,
    log: view.log.total,
    players: view.players.map((p) => ({ ...p, avatar: undefined })),
  });
  // FNV-1a, 32 bits: a digest for spotting a change, not a secret.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
