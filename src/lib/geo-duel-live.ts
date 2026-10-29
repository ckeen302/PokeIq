/**
 * A PokéGuessr duel's live channel, shared by the server (which publishes)
 * and the page (which subscribes): one Supabase Realtime topic per duel
 * code, carrying one kind of event, "the duel is at revision N now". The
 * page then fetches the state it may see with its own seat token, so the
 * channel never carries anything hidden (the opponent's pin before the
 * reveal, say); the 1 s polling stays as the fallback and slows to 3 s
 * while the channel is up.
 */

export const duelTopic = (code: string) => `geo-duel:${code}`;
export const DUEL_LIVE_EVENT = "duel";

/** What rides the channel (signed by the server, see server/realtime.ts). */
export interface DuelLiveEvent {
  code: string;
  /** The duel's revision after the write: a page already at it has nothing to fetch. */
  rev: number;
  /** Server time of the write. */
  at: number;
}

/** Where a page subscribes: the project URL, the public anon key and the key broadcasts are signed with. */
export interface DuelLiveConfig {
  url: string;
  anon: string;
  key: JsonWebKey;
}

/** The event in a payload's `data`, if it is one for this duel; null otherwise. */
export function parseDuelLiveEvent(data: string, code: string): DuelLiveEvent | null {
  try {
    const e = JSON.parse(data) as Partial<DuelLiveEvent> | null;
    return e && e.code === code && typeof e.rev === "number" && Number.isFinite(e.rev) ? { code, rev: e.rev, at: typeof e.at === "number" ? e.at : 0 } : null;
  } catch {
    return null;
  }
}
