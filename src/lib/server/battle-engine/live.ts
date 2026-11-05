import "server-only";
import { after } from "next/server";
import { broadcast } from "../realtime";
import { BATTLE_LIVE_EVENT, battleTopic, type BattleLiveEvent } from "@/lib/battle/live";

/**
 * Tells a live battle's pages that it changed: after a write that changes
 * what they show (a choice, a turn, a timeout or forfeit, the lobby, a chat
 * line), the battle's new revision goes out on its channel
 * (lib/battle/live.ts), and the other trainer's page fetches at once
 * instead of at its next poll. Only `{ code, rev, at }` rides the channel;
 * the battle itself still comes only through the authenticated GET.
 *
 * Off unless Realtime is configured (server/realtime.ts needs
 * NEXT_PUBLIC_SUPABASE_ANON_KEY too): then nothing is sent and pages poll.
 * A heartbeat (a poll moving `seenAt` on) is never published, or each
 * page's poll would wake the other's, back and forth.
 */

/** Publishes the battle's new revision. Never throws. */
export const publishBattle = (code: string, rev: number): Promise<void> =>
  broadcast(battleTopic(code), BATTLE_LIVE_EVENT, { code, rev, at: Date.now() } satisfies BattleLiveEvent, "battle-live");

/**
 * Publishes after the response has been sent (`after`), so the trainer who
 * acted isn't kept waiting on it; outside a request (tests, the tick's
 * loop) it goes out at once.
 */
export function publishBattleLater(code: string, rev: number): void {
  const send = () => publishBattle(code, rev);
  try {
    after(send);
  } catch {
    void send();
  }
}
