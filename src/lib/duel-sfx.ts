"use client";

import { useSyncExternalStore } from "react";
import { play, unlockAudio } from "./sound";

/**
 * Duel sound effects (a guess, a close guess, a solve, a win, the
 * countdown's pressure, the rival's moves): on by default, following the
 * site's sound toggle. A trainer can still turn them off for duels, and
 * that choice is remembered on this device. The site-wide mute always wins.
 */

const KEY = "pokeiq-duel-sfx";
const listeners = new Set<() => void>();
let fallback = true;

/** Whether duel sounds are on for this trainer (on unless they turned them off). */
export function duelSfxOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? fallback : stored !== "0";
  } catch {
    return fallback;
  }
}

export function setDuelSfx(on: boolean) {
  fallback = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // keep the in-memory value
  }
  if (on) unlockAudio();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDuelSfx(): boolean {
  return useSyncExternalStore(subscribe, duelSfxOn, () => true);
}

/** Plays a duel sound, unless the trainer turned them off (or the site is muted). */
export function sfx(kind: Parameters<typeof play>[0]) {
  if (typeof window !== "undefined" && duelSfxOn()) play(kind);
}
