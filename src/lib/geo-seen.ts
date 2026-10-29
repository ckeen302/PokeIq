import { GEO_SHOT_ID_RE } from "./geo-reports";

/**
 * No-repeat: the PokéGuessr screenshots this player has been dealt, most
 * recent first, kept on this device. A new game sends the list and the
 * server deals screenshots not on it first, then the ones seen longest ago
 * (src/lib/server/geo.ts, planRounds). The Daily (the same for everyone)
 * and a friend's challenge are left as they are.
 */

export const GEO_SEEN_KEY = "pokeiq:geo-seen";
/** Ids kept (and sent with a game): roughly a hundred games' worth. */
export const GEO_SEEN_MAX = 600;

/** The screenshot id in a round's picture URL (/api/geo/shot/<id>), or null for any other URL. */
export function shotIdOf(url: string): string | null {
  const m = /^\/api\/geo\/shot\/([A-Za-z0-9_-]+)$/.exec(url);
  return m && GEO_SHOT_ID_RE.test(m[1]) ? m[1] : null;
}

export function readSeenShots(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(GEO_SEEN_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && GEO_SHOT_ID_RE.test(id)).slice(0, GEO_SEEN_MAX) : [];
  } catch {
    return [];
  }
}

/** Notes a dealt round's screenshot (by its picture URL) as seen, most recent first. */
export function rememberSeenShot(url: string): void {
  const id = shotIdOf(url);
  if (!id) return;
  try {
    localStorage.setItem(GEO_SEEN_KEY, JSON.stringify([id, ...readSeenShots().filter((k) => k !== id)].slice(0, GEO_SEEN_MAX)));
  } catch {
    // Private mode: this visit's games just aren't steered away from what it saw.
  }
}
