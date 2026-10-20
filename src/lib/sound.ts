/**
 * Tiny WebAudio synth — zero audio assets. All effects are short envelopes
 * on oscillators. Muting is persisted; everything no-ops on the server or
 * when AudioContext is unavailable.
 */

type SoundKind = "correct" | "wrong" | "streak" | "fanfare" | "click" | "tick" | "close" | "ping";

const MUTE_KEY = "pokeiq-muted";

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Storage can throw (Safari "Block all cookies", sandboxed iframes): fall back to memory.
let mutedFallback = false;

export function isMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return mutedFallback;
  }
}

export function setMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  mutedFallback = muted;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // keep the in-memory value
  }
}

/**
 * iOS only lets an AudioContext start inside a user gesture, and grading
 * plays its sound after an `await fetch`. Call this synchronously from a
 * tap or key handler so the context is already running by then.
 */
export function unlockAudio(): void {
  if (isMuted()) return;
  try {
    context();
  } catch {
    // audio unavailable — ignore
  }
}

function tone(
  audio: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  type: OscillatorType = "sine",
  peak = 0.08,
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export function play(kind: SoundKind): void {
  try {
    playUnsafe(kind);
  } catch {
    // Sound is decoration: never let it break the game.
  }
}

function playUnsafe(kind: SoundKind): void {
  if (isMuted()) return;
  const audio = context();
  if (!audio) return;
  const now = audio.currentTime;
  switch (kind) {
    case "correct":
      tone(audio, 660, now, 0.12);
      tone(audio, 880, now + 0.09, 0.16);
      break;
    case "wrong":
      tone(audio, 196, now, 0.22, "sawtooth", 0.05);
      tone(audio, 147, now + 0.1, 0.26, "sawtooth", 0.05);
      break;
    case "streak":
      tone(audio, 660, now, 0.1);
      tone(audio, 880, now + 0.08, 0.1);
      tone(audio, 1174, now + 0.16, 0.2);
      break;
    case "fanfare":
      tone(audio, 523, now, 0.15);
      tone(audio, 659, now + 0.12, 0.15);
      tone(audio, 784, now + 0.24, 0.15);
      tone(audio, 1046, now + 0.36, 0.35);
      break;
    case "click":
      tone(audio, 440, now, 0.05, "triangle", 0.04);
      break;
    case "tick":
      tone(audio, 1046, now, 0.04, "square", 0.025);
      break;
    case "close":
      tone(audio, 523, now, 0.08, "triangle", 0.05);
      tone(audio, 784, now + 0.07, 0.12, "triangle", 0.05);
      break;
    case "ping":
      tone(audio, 988, now, 0.06, "sine", 0.04);
      break;
  }
}

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // haptics unsupported — ignore
    }
  }
}
