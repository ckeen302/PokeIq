"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useDuelSfx } from "./duel-sfx";
import { isMuted, onMuteChange } from "./sound";
import { preloadPressure, startPressure, stopPressure } from "./guessr-pressure";

export interface PressureState {
  /** The countdown window is open (and the trainer still has to guess). */
  active: boolean;
  /** Milliseconds left on the clock now. */
  leftMs: number;
  /** The whole window, in ms. */
  totalMs: number;
  /** The red flash's last stretch, in ms. */
  flashMs: number;
  /** 1 for duels, ranked and party; lower for timed solo rounds. */
  level: number;
  /** Sound the alarm as the window opens. */
  cue: boolean;
  /** Changes for each round, so a new round's window starts afresh. */
  round?: number;
}

const subscribeMute = (cb: () => void) => onMuteChange(cb);

/**
 * Plays the countdown's pressure while `active`; stops it the moment it isn't
 * (or on unmount). Silent while the site is muted or PokéGuessr's sound
 * effects are off.
 */
export function useGuessrPressure({ active, leftMs, totalMs, flashMs, level, cue, round }: PressureState): void {
  const muted = useSyncExternalStore(subscribeMute, isMuted, () => true);
  const sfxOn = useDuelSfx();
  const left = useRef(leftMs);
  left.current = leftMs;
  const on = active && !muted && sfxOn;

  useEffect(() => {
    preloadPressure();
  }, []);

  useEffect(() => {
    if (!on || left.current <= 0) return;
    // The alarm only while the window is fresh: unmuting mid-countdown picks the bed up quietly.
    const fresh = left.current >= totalMs - 1500;
    startPressure({ leftS: left.current / 1000, totalS: totalMs / 1000, flashS: flashMs / 1000, level, cue: cue && fresh });
    return () => stopPressure();
  }, [on, totalMs, flashMs, level, cue, round]);
}
