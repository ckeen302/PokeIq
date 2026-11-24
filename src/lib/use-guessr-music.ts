"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { DEFAULT_GUESSR_MUSIC, guessrMusicPrefs, subscribeGuessrMusicPrefs, type GuessrMusicPrefs } from "./guessr-music-prefs";
import type { GuessrMusicPlayer } from "./guessr-music";

/** The player, fetched once per page view (and again if a fetch failed). */
let player: Promise<GuessrMusicPlayer> | null = null;
function loadPlayer(): Promise<GuessrMusicPlayer> {
  player ??= import("./guessr-music").then(
    (m) => m.guessrMusic,
    (err: unknown) => {
      player = null;
      throw err;
    },
  );
  return player;
}

/**
 * PokéGuessr's background music, for a screen that can hold a game. `active`:
 * a game is in progress (its rounds and the results between them), so the
 * music plays; false (the hub, a lobby, the final results, a game over) fades
 * it out at once. The player loads once the page is idle, never on the
 * critical path, and plays after the first tap or key press. Moving between
 * rounds keeps the same track going; leaving the screen fades it out a moment
 * later.
 */
export function useGuessrMusic(active: boolean): void {
  const music = useRef<{ active: boolean; player: GuessrMusicPlayer | null; release: ((now?: boolean) => void) | null }>({ active, player: null, release: null });

  // The player: fetched once the page is idle, then held while a game is on.
  useEffect(() => {
    const m = music.current;
    let cancelled = false;
    let idle: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      loadPlayer().then(
        (p) => {
          if (cancelled) return;
          m.player = p;
          if (m.active && !m.release) m.release = p.acquire();
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
      // The screen closing: the music stops a moment later.
      m.release?.();
      m.release = null;
      m.player = null;
    };
  }, []);

  // A game starting plays it (a Start or Play again is a tap, so it may); a game over fades it out now.
  useEffect(() => {
    const m = music.current;
    m.active = active;
    if (active && m.player && !m.release) m.release = m.player.acquire();
    else if (!active && m.release) {
      m.release(true);
      m.release = null;
    }
  }, [active]);
}

/** The Music settings, live. */
export function useGuessrMusicPrefs(): GuessrMusicPrefs {
  return useSyncExternalStore(subscribeGuessrMusicPrefs, guessrMusicPrefs, () => DEFAULT_GUESSR_MUSIC);
}
