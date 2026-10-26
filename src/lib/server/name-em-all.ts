import "server-only";
import { isValidDailyDate } from "@/lib/daily";
import { neaCategory, neaDailyCategory, standardMinutes } from "@/lib/name-em-all/categories";
import { neaTargets } from "@/lib/name-em-all/targets";

/**
 * A Name 'em All scope: a category's own boards ("gen-1"), or a day's
 * daily ("daily:2026-10-26", whose category is the day's).
 */
export interface NeaScope {
  scope: string;
  category: string;
  daily: string | null;
  total: number;
  limitMs: number;
}

export function parseScope(scope: unknown, now = Date.now()): NeaScope | null {
  if (typeof scope !== "string" || scope.length > 40) return null;
  let category = scope;
  let daily: string | null = null;
  if (scope.startsWith("daily:")) {
    daily = scope.slice(6);
    if (!isValidDailyDate(daily, now)) return null;
    category = neaDailyCategory(daily);
  }
  if (!neaCategory(category)) return null;
  const total = neaTargets(category)!.length;
  return { scope, category, daily, total, limitMs: standardMinutes(total) * 60_000 };
}
