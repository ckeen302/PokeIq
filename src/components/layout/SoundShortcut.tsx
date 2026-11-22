"use client";

import { useEffect } from "react";
import { isMuted, play, setMuted, unlockAudio } from "@/lib/sound";

/**
 * The site's sound keys, with no button of its own (the switch is the Sound
 * row in the account menu, the trainer card's Settings and the phone's More
 * sheet): `M` toggles the sound from anywhere outside a text field, and the
 * first tap or key press warms the audio context (iOS starts audio only
 * inside a gesture).
 */
export function SoundShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "m" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const next = !isMuted();
      // Every sound switch on the page follows (onMuteChange).
      setMuted(next);
      if (!next) play("click");
    };
    const unlock = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);
  return null;
}
