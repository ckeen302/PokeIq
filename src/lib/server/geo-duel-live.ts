import "server-only";
import { after } from "next/server";
import { canonicalJson } from "./canonical-json";
import { broadcast } from "./realtime";
import { DUEL_LIVE_EVENT, duelTopic, type DuelLiveEvent } from "@/lib/geo-duel-live";
import type { Duel } from "./duel";

/**
 * Tells a duel's pages that it changed: after a write to the duel (a guess,
 * a Ready, a round that ended on its clock, a ranked result), its revision
 * goes out on the duel's channel (lib/geo-duel-live.ts) and the other
 * trainer's page fetches at once instead of at its next poll.
 *
 * Only changes a page can see are published. A heartbeat (every poll moves
 * the trainer's `seenAt` on) also writes the row, and publishing those
 * would have each page's poll wake the other's, back and forth: so the
 * duel is compared without its heartbeats first.
 */

/** The duel as its pages see it: everything but when each trainer was last heard from. */
export const duelFingerprint = (duel: Duel): string => canonicalJson({ ...duel, players: duel.players.map((p) => ({ ...p, seenAt: 0 })) });

/** Whether anything a page shows changed between `before` and `duel`. */
export const duelChanged = (before: Duel | undefined, duel: Duel): boolean => !before || duelFingerprint(before) !== duelFingerprint(duel);

/** Publishes the duel's new revision. Never throws. */
export const publishDuel = (code: string, rev: number): Promise<void> => broadcast(duelTopic(code), DUEL_LIVE_EVENT, { code, rev, at: Date.now() } satisfies DuelLiveEvent, "geo-duel");

/**
 * After a write: publishes the new revision if the duel moved on in any way
 * a page can see. The broadcast goes out once the response has been sent
 * (`after`), so the trainer who acted isn't kept waiting on it; outside a
 * request (tests) it goes out at once.
 */
export function publishIfChanged(code: string, before: Duel | undefined, duel: Duel, rev: number): void {
  if (!duelChanged(before, duel)) return;
  const send = () => publishDuel(code, rev);
  try {
    after(send);
  } catch {
    void send();
  }
}
