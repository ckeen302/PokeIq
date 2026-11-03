"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_GUESSR_AUDIO, guessrMusic, type GuessrAudioPrefs, type MusicState } from "./guessr-music";
import { setSfxScale } from "./sound";

const subscribe = (cb: () => void) => guessrMusic.subscribe(cb);
const snapshot = () => {
  guessrMusic.init();
  return guessrMusic.prefs;
};

/**
 * The music a PokéGuessr screen wants (null: none), and the sound-effects
 * level while it's open. Moving between PokéGuessr pages keeps the music
 * going; leaving them fades it out.
 */
export function useGuessrMusic(state: MusicState | null): void {
  useEffect(() => {
    guessrMusic.want(state);
  }, [state]);
  useEffect(() => {
    guessrMusic.init();
    const level = () => setSfxScale(guessrMusic.prefs.sfxVolume);
    level();
    const off = guessrMusic.subscribe(level);
    return () => {
      off();
      setSfxScale(1);
      guessrMusic.want(null);
    };
  }, []);
}

/** PokéGuessr's music and sound-effect settings, live. */
export function useGuessrAudioPrefs(): GuessrAudioPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_GUESSR_AUDIO);
}
