"use client";

import { useSyncExternalStore } from "react";
import type { ConnRecord } from "@/lib/progress";
import { dleStats, type DleStats } from "@/lib/dle-stats";
import { CONN_MAX_MISTAKES } from "./types";

/**
 * PokéConnections on this device: settings and archive games. The dailies
 * themselves live in the progress record (lib/progress: `conn`), which syncs
 * to a trainer account; archive games are kept apart so they never count.
 */

export interface ConnPrefs {
  /** The how-to sheet has been seen. */
  seenHowTo: boolean;
  /** Each group's symbol (● ▲ ■ ◆) beside its colour. */
  symbols: boolean;
  /** A running clock above the grid. */
  showTimer: boolean;
  /** Unlimited's difficulty: which bands the groups come from (see the generator's DIFFICULTY_BANDS). */
  level: "easy" | "normal" | "hard";
}

const PREFS_KEY = "pokeiq:connections-prefs:v1";
const ARCHIVE_KEY = "pokeiq:connections-archive:v1";
const DEFAULT_PREFS: ConnPrefs = { seenHowTo: false, symbols: true, showTimer: false, level: "normal" };

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full: it lasts this visit only.
  }
}

let prefs: ConnPrefs | null = null;
const listeners = new Set<() => void>();

export function getConnPrefs(): ConnPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  prefs ??= load(PREFS_KEY, DEFAULT_PREFS);
  return prefs;
}

export function setConnPrefs(patch: Partial<ConnPrefs>) {
  prefs = { ...getConnPrefs(), ...patch };
  store(PREFS_KEY, prefs);
  listeners.forEach((l) => l());
}

/** The settings, or null before mount (the page is prerendered). */
export function useConnPrefs(): ConnPrefs | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getConnPrefs,
    () => null
  );
}

export function connArchive(): Record<string, ConnRecord> {
  return load<Record<string, ConnRecord>>(ARCHIVE_KEY, {});
}

export function saveConnArchive(date: string, record: ConnRecord) {
  store(ARCHIVE_KEY, { ...connArchive(), [date]: record });
}

/**
 * The stats modal's numbers, from the daily results alone (Pokédle's rules:
 * a play streak of days finished, won or lost, with freezes; a win streak).
 * `distribution[n]` counts wins with n mistakes.
 */
export function connStats(results: Readonly<Record<string, ConnRecord>>, today: string): DleStats {
  const asDle = Object.fromEntries(
    Object.entries(results).map(([d, r]) => [d, { guesses: Array<number>(Math.min(r.mistakes, CONN_MAX_MISTAKES - 1) + 1).fill(0), solved: r.solved, over: r.over }])
  );
  return dleStats(asDle, today, CONN_MAX_MISTAKES);
}
