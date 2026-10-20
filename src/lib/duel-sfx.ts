"use client";

import { useSyncExternalStore } from "react";
import { play, unlockAudio } from "./sound";

/**
 * Duel sound effects (a guess, a close guess, a solve, a win, the last ten
 * seconds, the rival's moves): off until the trainer turns them on, and
 * remembered on this device. The site-wide mute still wins.
 */

const KEY = "pokeiq-duel-sfx";
const listeners = new Set<() => void>();
let fallback = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
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
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Plays a duel sound, if the trainer turned them on. */
export function sfx(kind: Parameters<typeof play>[0]) {
  if (typeof window !== "undefined" && read()) play(kind);
}
