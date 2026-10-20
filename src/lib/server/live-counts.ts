import "server-only";
import type { LiveCounts } from "@/lib/community";
import { battleKey } from "./battle-engine/identity";
import { activeBattleSeats } from "./battle-engine/store";
import { friendStore, FriendsUnavailable } from "./friends-store";

/**
 * "N trainers online" and "N active battles" for the battle home: signed-in
 * trainers with a fresh heartbeat, plus everyone seated in a live battle
 * who isn't one of them (guests, and accounts without a tab open), each
 * counted once. Read at most every 30 s per CDN region (the route caches).
 */
export function tallyCounts(presenceIds: string[], battles: (string | null)[][], keyOf: (userId: string) => string = (id) => battleKey(`u:${id}`)): LiveCounts {
  const accounts = new Set(presenceIds.map(keyOf));
  const others = new Set<string>();
  let anonymous = 0;
  for (const seats of battles) {
    for (const key of seats) {
      if (!key) anonymous++;
      else if (!accounts.has(key)) others.add(key);
    }
  }
  return { online: new Set(presenceIds).size + others.size + anonymous, battles: battles.length };
}

export async function liveCounts(now = Date.now()): Promise<LiveCounts> {
  const store = friendStore();
  const [ids, battles] = await Promise.all([
    store
      ? store.onlineIds(now).catch((err) => {
          if (!(err instanceof FriendsUnavailable)) console.error("[live-counts] presence:", err);
          return [] as string[];
        })
      : Promise.resolve([] as string[]),
    activeBattleSeats().catch((err) => {
      console.error("[live-counts] battles:", err);
      return [] as (string | null)[][];
    }),
  ]);
  return tallyCounts(ids, battles);
}
