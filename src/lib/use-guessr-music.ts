"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_GUESSR_MUSIC, guessrMusicPrefs, subscribeGuessrMusicPrefs, type GuessrMusicPrefs } from "./guessr-music-prefs";

/**
 * PokéGuessr's background music, for a screen that should have it (the hub
 * and every game). The player loads once the page is idle, never on the
 * critical path, and plays after the first tap or key press. Moving between
 * PokéGuessr screens keeps the same track going; leaving them fades it out.
 */
export function useGuessrMusic(): void {
  useEffect(() => {
    let release: (() => void) | null = null;
    let cancelled = false;
    let idle: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void import("./guessr-music").then(
        ({ guessrMusic }) => {
          if (!cancelled) release = guessrMusic.acquire();
        },
        () => undefined, // music is decoration
      );
    };
    const whenIdle = () => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(load, { timeout: 3000 });
      else timer = setTimeout(load, 1500);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", whenIdle);
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer) clearTimeout(timer);
      release?.();
    };
  }, []);
}

/** The Music settings, live. */
export function useGuessrMusicPrefs(): GuessrMusicPrefs {
  return useSyncExternalStore(subscribeGuessrMusicPrefs, guessrMusicPrefs, () => DEFAULT_GUESSR_MUSIC);
}
