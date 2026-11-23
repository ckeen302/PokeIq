/**
 * PokéGuessr's music settings: on or off, and a volume. On by default at a
 * low volume, remembered on this device. The site's mute (the M key and the
 * account menu's sound switch) silences it too, without changing these.
 * Tiny on purpose: the settings popover imports it, the player loads lazily.
 */

export interface GuessrMusicPrefs {
  on: boolean;
  /** 0 to 1. */
  volume: number;
}

export const DEFAULT_GUESSR_MUSIC: GuessrMusicPrefs = { on: true, volume: 0.35 };

const KEY = "pokeiq-guessr-music";
const listeners = new Set<() => void>();
let current: GuessrMusicPrefs | null = null;

/** Parses stored settings, falling back to the defaults for anything missing or out of range. */
export function parseGuessrMusicPrefs(raw: string | null): GuessrMusicPrefs {
  try {
    const p = raw ? (JSON.parse(raw) as Partial<GuessrMusicPrefs>) : {};
    return {
      on: typeof p.on === "boolean" ? p.on : DEFAULT_GUESSR_MUSIC.on,
      volume: typeof p.volume === "number" && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULT_GUESSR_MUSIC.volume,
    };
  } catch {
    return DEFAULT_GUESSR_MUSIC;
  }
}

export function guessrMusicPrefs(): GuessrMusicPrefs {
  if (current) return current;
  if (typeof window === "undefined") return DEFAULT_GUESSR_MUSIC;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // storage blocked: the defaults, for this page
  }
  current = parseGuessrMusicPrefs(raw);
  return current;
}

export function setGuessrMusicPrefs(patch: Partial<GuessrMusicPrefs>): void {
  current = { ...guessrMusicPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // kept for this page only
  }
  listeners.forEach((l) => l());
}

export function subscribeGuessrMusicPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The player's gain for a slider position: a gentle curve, so the low end of the slider stays usable. */
export function musicGain(volume: number): number {
  const v = Math.max(0, Math.min(1, volume));
  return v ** 1.5;
}
