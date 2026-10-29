import { previousDate } from "@/lib/daily";
import { CONN_LAUNCH_DATE } from "@/lib/connections/types";
import type { PdkRecord } from "./play";
import type { PdkDifficulty } from "./types";

/**
 * Pikadoku's archive: every past daily, all three difficulties, playable any
 * time. Archive games are kept apart from the daily results (and never reach
 * the board or the streak); this is just where they are listed and saved on
 * this device.
 */

const KEY = "pokeiq:pikadoku:archive:v1";

/** Past dailies, newest first: yesterday back to launch (today is the daily itself). */
export function archiveDates(today: string): string[] {
  const out: string[] = [];
  for (let d = previousDate(today); d >= CONN_LAUNCH_DATE; d = previousDate(d)) out.push(d);
  return out;
}

/** The months ("YYYY-MM") from launch to `today`'s, oldest first. */
export function archiveMonths(today: string): string[] {
  const out: string[] = [];
  let [y, m] = CONN_LAUNCH_DATE.slice(0, 7).split("-").map(Number);
  const end = today.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** A month's calendar, Monday first: whole weeks of dates, with null for the days outside the month. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const archiveKey =(date: string, difficulty: PdkDifficulty) => `${date}:${difficulty}`;

export function loadPdkArchive(): Record<string, PdkRecord> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, PdkRecord>) : {};
  } catch {
    return {};
  }
}

export function savePdkArchiveLocal(key: string, record: PdkRecord) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...loadPdkArchive(), [key]: record }));
  } catch {
    // Lasts this visit only.
  }
}
