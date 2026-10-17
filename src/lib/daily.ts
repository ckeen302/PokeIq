/**
 * Daily puzzle calendar. Days are keyed by the player's *local* date
 * (like Wordle), so the server accepts any date within ±1 day of UTC.
 */

export const LAUNCH_DATE = "2026-10-17";
const DAY_MS = 86_400_000;

export function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function isValidDailyDate(date: unknown, now = Date.now()): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = utcMidnight(date);
  // Date.parse rolls impossible dates over ("2026-09-31" -> Oct 1): require a round trip.
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) return false;
  if (t < utcMidnight(LAUNCH_DATE)) return false;
  const today = utcMidnight(new Date(now).toISOString().slice(0, 10));
  return Math.abs(t - today) <= DAY_MS;
}

/** #1 on launch day. */
export function dailyNumber(date: string): number {
  return Math.round((utcMidnight(date) - utcMidnight(LAUNCH_DATE)) / DAY_MS) + 1;
}

export function previousDate(date: string): string {
  return new Date(utcMidnight(date) - DAY_MS).toISOString().slice(0, 10);
}
