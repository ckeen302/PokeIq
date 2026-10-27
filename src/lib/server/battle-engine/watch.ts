import "server-only";
import { PLAY_FORMAT_INFO, type PlayFormatId } from "@/lib/battle/play";
import { customName } from "@/lib/battle/custom-rules";
import type { WatchEntry } from "@/lib/battle/watch";
import { spectatorCount } from "./service";
import { listLiveBattles, type BattleMeta } from "./store";

/**
 * The Watch lobby's list. Privacy is decided here, from the battle itself:
 * only live battles under way that are public (matchmade, or a friend battle
 * whose host let anyone watch) are listed; battles against the computer and
 * private friend battles never are. Each entry carries public facts only.
 */
export function watchEntry(meta: BattleMeta, now: number): WatchEntry | null {
  if (meta.kind !== "pvp" || meta.status !== "playing" || meta.public !== true || meta.seats.length !== 2) return null;
  const info = PLAY_FORMAT_INFO[meta.format];
  return {
    code: meta.code,
    format: meta.format,
    formatName: meta.rules ? customName(meta.rules) : meta.factoryTier ? `${info.name} · ${meta.factoryTier}` : info.name,
    players: meta.seats.map((s) => (meta.ranked && s.rating ? { name: s.name, rating: s.rating.rating, ...(s.rating.elo !== undefined ? { elo: s.rating.elo } : {}) } : { name: s.name })),
    ranked: !!meta.ranked,
    turn: meta.turn,
    spectators: spectatorCount(meta, now),
    startedAt: meta.startedAt ?? meta.createdAt,
  };
}

/** Live battles to watch, newest first, optionally in one format. */
export async function listWatchable(format: PlayFormatId | null, now = Date.now()): Promise<WatchEntry[]> {
  const rows = await listLiveBattles(80);
  return rows
    .map((r) => watchEntry(r.meta, now))
    .filter((e): e is WatchEntry => e !== null && (!format || e.format === format))
    .sort((a, b) => b.startedAt - a.startedAt);
}
