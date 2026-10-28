/**
 * Tiny WebAudio synth — zero audio assets (nothing to license: every effect
 * is synthesised here). All effects are short envelopes on oscillators.
 * Muting is persisted; everything no-ops on the server or when AudioContext
 * is unavailable.
 *
 * PokéGuessr's set: pin (dropping a pin), guess (locking it in), tally (one
 * tick of a score counting up), countdown (the last seconds), hit (damage
 * landing), super (a super-effective hit), roundwin / roundlose and
 * matchwin / matchlose.
 */

export type SoundKind =
  | "correct"
  | "wrong"
  | "streak"
  | "fanfare"
  | "click"
  | "tick"
  | "close"
  | "ping"
  | "pin"
  | "guess"
  | "tally"
  | "countdown"
  | "hit"
  | "super"
  | "roundwin"
  | "roundlose"
  | "matchwin"
  | "matchlose";

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
  window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: muted }));
}

const MUTE_EVENT = "pokeiq:muted";

/** Calls `listener` whenever the site's sound is muted or unmuted (battle music follows it). */
export function onMuteChange(listener: (muted: boolean) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (e: Event) => listener(!!(e as CustomEvent<boolean>).detail);
  window.addEventListener(MUTE_EVENT, handler);
  return () => window.removeEventListener(MUTE_EVENT, handler);
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

/** A tone whose pitch slides from `from` to `to` over its length. */
function sweep(audio: AudioContext, from: number, to: number, startAt: number, duration: number, type: OscillatorType = "sine", peak = 0.08): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, startAt);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), startAt + duration);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** A burst of noise (a thud's body, a whoosh's air). */
function noise(audio: AudioContext, startAt: number, duration: number, peak = 0.06, lowpass = 800): void {
  const frames = Math.max(1, Math.floor(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(peak, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start(startAt);
  src.stop(startAt + duration + 0.02);
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
    case "pin":
      // A pin dropping: a quick downward plop.
      sweep(audio, 900, 420, now, 0.09, "sine", 0.06);
      break;
    case "guess":
      // Locking in: a rising whoosh with a soft confirm.
      noise(audio, now, 0.16, 0.035, 2400);
      sweep(audio, 320, 960, now, 0.16, "triangle", 0.035);
      tone(audio, 1046, now + 0.14, 0.1, "sine", 0.04);
      break;
    case "tally":
      tone(audio, 1760, now, 0.02, "square", 0.012);
      break;
    case "countdown":
      tone(audio, 880, now, 0.07, "square", 0.035);
      break;
    case "hit":
      // Damage landing: a low thud.
      noise(audio, now, 0.14, 0.09, 500);
      sweep(audio, 160, 50, now, 0.22, "sawtooth", 0.07);
      break;
    case "super":
      // "It's super effective!": a crunch, then a bright rising triad.
      noise(audio, now, 0.12, 0.08, 1200);
      sweep(audio, 220, 60, now, 0.2, "sawtooth", 0.07);
      tone(audio, 659, now + 0.12, 0.09, "triangle", 0.06);
      tone(audio, 830, now + 0.2, 0.09, "triangle", 0.06);
      tone(audio, 1046, now + 0.28, 0.2, "triangle", 0.07);
      break;
    case "roundwin":
      tone(audio, 784, now, 0.1, "triangle", 0.06);
      tone(audio, 1046, now + 0.09, 0.18, "triangle", 0.06);
      break;
    case "roundlose":
      tone(audio, 330, now, 0.14, "sawtooth", 0.04);
      tone(audio, 262, now + 0.12, 0.22, "sawtooth", 0.04);
      break;
    case "matchwin":
      tone(audio, 523, now, 0.12);
      tone(audio, 659, now + 0.1, 0.12);
      tone(audio, 784, now + 0.2, 0.12);
      tone(audio, 1046, now + 0.3, 0.16);
      tone(audio, 784, now + 0.46, 0.1);
      tone(audio, 1046, now + 0.56, 0.4);
      tone(audio, 1318, now + 0.56, 0.4, "triangle", 0.05);
      break;
    case "matchlose":
      tone(audio, 392, now, 0.16, "sawtooth", 0.04);
      tone(audio, 330, now + 0.15, 0.16, "sawtooth", 0.04);
      tone(audio, 262, now + 0.3, 0.16, "sawtooth", 0.04);
      tone(audio, 196, now + 0.45, 0.4, "sawtooth", 0.04);
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
