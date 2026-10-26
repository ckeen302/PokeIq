"use client";

import type { NeaMode } from "./types";

/**
 * Name 'em All on this device: the player's settings, a game in progress
 * (to resume later) and personal bests. All in localStorage, every access
 * guarded: private windows and blocked storage just don't remember.
 */

export interface NeaSettings {
  mode: NeaMode;
  /** Minutes on the clock, or null for no limit. */
  minutes: number | null;
  silhouette: boolean;
  /** Show the next silhouette every 20 seconds on its own. */
  autoCycle: boolean;
  spelling: boolean;
  shiny: boolean;
  /** Alternate between pixel sprites and artwork. */
  cycleSprites: boolean;
  sound: boolean;
  /** Keep the game in progress on this device. */
  save: boolean;
}

export const DEFAULT_SETTINGS: Omit<NeaSettings, "minutes"> = {
  mode: "regular",
  silhouette: false,
  autoCycle: false,
  spelling: false,
  shiny: false,
  cycleSprites: false,
  sound: true,
  save: true,
};

/** A game in progress. */
export interface NeaSave {
  v: 1;
  settings: NeaSettings;
  /** Slots named, in the order named. */
  named: number[];
  /** Time on the clock when each was named. */
  times: number[];
  /** Time played so far. */
  elapsed: number;
  /** Chaos and Dex order: the slots still to name, the current one first. */
  queue?: number[];
  savedAt: number;
}

export interface NeaBest {
  named: number;
  total: number;
  ms: number;
}

const SETTINGS_KEY = "pokeiq:nea:settings";
const saveKey = (scope: string) => `pokeiq:nea:save:${scope}`;
const BEST_KEY = "pokeiq:nea:best";

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: this device just won't remember.
  }
}

export function loadSettings(): Partial<NeaSettings> {
  const s = readJson<Partial<NeaSettings>>(SETTINGS_KEY);
  return s && typeof s === "object" ? s : {};
}
export function storeSettings(s: NeaSettings) {
  writeJson(SETTINGS_KEY, s);
}

export function loadSave(scope: string, total: number): NeaSave | null {
  const s = readJson<NeaSave>(saveKey(scope));
  if (!s || s.v !== 1 || !Array.isArray(s.named) || !Array.isArray(s.times) || typeof s.elapsed !== "number") return null;
  if (s.named.some((i) => !Number.isInteger(i) || i < 0 || i >= total) || new Set(s.named).size !== s.named.length) return null;
  return s;
}
export function storeSave(scope: string, save: NeaSave | null) {
  writeJson(saveKey(scope), save);
}

export function loadBests(): Record<string, NeaBest> {
  return readJson<Record<string, NeaBest>>(BEST_KEY) ?? {};
}
/** Keeps the better of the stored best and this run (more named, then quicker). True if this run is the new best. */
export function recordBest(scope: string, run: NeaBest): boolean {
  const all = loadBests();
  const old = all[scope];
  if (old && (old.named > run.named || (old.named === run.named && old.ms <= run.ms))) return false;
  all[scope] = run;
  writeJson(BEST_KEY, all);
  return true;
}
