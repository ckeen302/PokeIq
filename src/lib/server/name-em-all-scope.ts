import { isValidDailyDate } from "@/lib/daily";
import { neaCategory, neaDailyCategory } from "@/lib/name-em-all/categories";

/**
 * A scope's category and daily date, or null when it isn't one. The checks
 * of parseScope (./name-em-all) without the target list, which needs the
 * whole Pokédex: the leaderboard only names a board.
 */
export function scopeCategory(scope: unknown, now = Date.now()): { scope: string; category: string; daily: string | null } | null {
  if (typeof scope !== "string" || scope.length > 40) return null;
  let category = scope;
  let daily: string | null = null;
  if (scope.startsWith("daily:")) {
    daily = scope.slice(6);
    if (!isValidDailyDate(daily, now)) return null;
    category = neaDailyCategory(daily);
  }
  if (!neaCategory(category)) return null;
  return { scope, category, daily };
}
