import { CONN_LAUNCH_DATE } from "@/lib/connections/types";

/**
 * Pikadoku's weeks, as dates only (client-safe: no categories in here). A week
 * runs Monday to Sunday, UTC, and is named by its Monday.
 */
const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday of the week a date (YYYY-MM-DD) falls in. */
export function weekStart(date: string): string {
  const t = utc(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return iso(t - dow * DAY_MS);
}

/** The Sunday that ends the week. */
export const weekEnd = (monday: string) => iso(utc(monday) + 6 * DAY_MS);

/** Weeks since launch: the launch week (the Monday on or before the launch date) is week 1. */
export function weekNumber(monday: string): number {
  return Math.round((utc(monday) - utc(weekStart(CONN_LAUNCH_DATE))) / (7 * DAY_MS)) + 1;
}

/** Is this week (given by its Monday, from the player's own date) the live one? Within a day of UTC's, as the dailies are. */
export function isLiveWeek(monday: unknown, now = Date.now()): monday is string {
  if (typeof monday !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(monday) || Number.isNaN(utc(monday)) || weekStart(monday) !== monday) return false;
  if (monday < weekStart(CONN_LAUNCH_DATE)) return false;
  const today = iso(Math.floor(now / DAY_MS) * DAY_MS);
  return [iso(utc(today) - DAY_MS), today, iso(utc(today) + DAY_MS)].some((d) => weekStart(d) === monday);
}
