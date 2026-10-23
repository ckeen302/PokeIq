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

export const archiveKey = (date: string, difficulty: PdkDifficulty) => `${date}:${difficulty}`;

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
