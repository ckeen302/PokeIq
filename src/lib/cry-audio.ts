/**
 * The one <audio> element every Pokémon cry plays through.
 *
 * Browsers only let a page start sound after the player has tapped or typed,
 * and iOS goes further: each media element must be started (or loaded) inside
 * a tap before it may play on its own. A quiz question arrives after an
 * `await fetch`, long after the tap that asked for it, so a fresh `new Audio()`
 * per question is refused there. One shared element, unlocked by the tap on
 * Start (or any later tap), can then play each new cry as its question loads.
 * Sharing it also means a new cry always replaces the last, never overlaps it.
 *
 * Cries are the question itself, so they ignore the site's sound-effects mute
 * (lib/sound.ts): a muted cry quiz would be unplayable.
 */

let element: HTMLAudioElement | null = null;
/** True once a play() has gone through: the element is allowed to play from now on. */
let unlocked = false;

/** A 1-sample silent WAV: gives the element something to load when it is unlocked before any cry. */
const SILENCE = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA==";

export function cryElement(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof window.Audio !== "function") return null;
  if (!element) {
    element = new window.Audio();
    element.preload = "auto";
    element.volume = 0.6;
  }
  return element;
}

/** Record that a play() went through. */
export function markCryUnlocked(): void {
  unlocked = true;
}

/**
 * Call synchronously from a tap or key handler (Start, an answer, Next) so
 * the next cry can play by itself. Silent: it loads the element, it plays
 * nothing, so it never cuts off a cry or the player's own music.
 */
export function unlockCryAudio(): void {
  if (unlocked) return;
  const audio = cryElement();
  if (!audio || !audio.paused) return;
  try {
    if (!audio.getAttribute("src")) audio.src = SILENCE;
    audio.load();
  } catch {
    // audio unavailable: the player's Play button still works
  }
}

let vorbis: boolean | null = null;

/** Whether this browser plays Ogg Vorbis (Chrome, Firefox, Edge do; Safari and every iOS browser don't). */
export function canPlayVorbis(): boolean {
  if (vorbis === null) {
    const audio = cryElement();
    vorbis = !!audio && audio.canPlayType('audio/ogg; codecs="vorbis"') !== "";
  }
  return vorbis;
}

/** The URL of a cry in a format this browser can play: the server sends Safari a WAV. */
export function playableCryUrl(url: string): string {
  if (typeof window === "undefined" || canPlayVorbis()) return url;
  return wavCryUrl(url);
}

export function wavCryUrl(url: string): string {
  return /[?&]format=wav\b/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}format=wav`;
}
