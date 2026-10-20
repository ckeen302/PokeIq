"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { DleHint } from "./dle-types";
import { DLE_DEFAULT_ASSIST, type DleAssist } from "./dle-assist";

/**
 * Pokédle's settings and archive games, on this device only. Archive games
 * live apart from the progress record, so they can never count toward the
 * daily's streaks or stats.
 */

export interface DlePrefs {
  /** Orange and blue in place of green and yellow. */
  colourBlind: boolean;
  /** Hard mode for the next daily started. */
  hard: boolean;
  /** The Pokédex assist level for the next game started (the last one picked). */
  assist: DleAssist;
  /** The how-to sheet has been seen. */
  seenHowTo: boolean;
}

export interface DleArchiveRecord {
  guesses: number[];
  solved: boolean;
  over: boolean;
  hard?: boolean;
  hints?: DleHint[];
  assist?: DleAssist;
}

const PREFS_KEY = "pokeiq:pokedle-prefs:v1";
const ARCHIVE_KEY = "pokeiq:pokedle-archive:v1";
const DEFAULT_PREFS: DlePrefs = { colourBlind: false, hard: false, assist: DLE_DEFAULT_ASSIST, seenHowTo: false };

function load<T>(key: string, fallback: T): T {
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
    // Private mode or full: the setting lasts this visit only.
  }
}

let prefs: DlePrefs | null = null;
const listeners = new Set<() => void>();

export function getDlePrefs(): DlePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  return (prefs ??= load(PREFS_KEY, DEFAULT_PREFS));
}

export function setDlePrefs(patch: Partial<DlePrefs>) {
  prefs = { ...getDlePrefs(), ...patch };
  store(PREFS_KEY, prefs);
  listeners.forEach((l) => l());
}

/** The settings, or null before mount (the page is prerendered). */
export function useDlePrefs(): DlePrefs | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getDlePrefs,
    () => null
  );
}

export function getArchiveRecord(date: string): DleArchiveRecord | undefined {
  return load<Record<string, DleArchiveRecord>>(ARCHIVE_KEY, {})[date];
}

export function saveArchiveRecord(date: string, record: DleArchiveRecord) {
  store(ARCHIVE_KEY, { ...load<Record<string, DleArchiveRecord>>(ARCHIVE_KEY, {}), [date]: record });
}

export function archiveRecords(): Record<string, DleArchiveRecord> {
  return load<Record<string, DleArchiveRecord>>(ARCHIVE_KEY, {});
}

/** Puts the colour-blind palette on the page (globals.css reads data-dle-cb on <html>) while a Pokédle screen is up. */
export function useApplyDlePrefs() {
  const p = useDlePrefs();
  const on = p?.colourBlind ?? false;
  useEffect(() => {
    const root = document.documentElement;
    if (on) root.dataset.dleCb = "";
    else delete root.dataset.dleCb;
    return () => {
      delete root.dataset.dleCb;
    };
  }, [on]);
}
