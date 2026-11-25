"use client";

/**
 * A tap's feedback, both off unless the hunter turns them on: a short click (synthesised, no audio files) and a
 * tiny vibration where the phone supports it.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = "triangle") {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function clickSound(up: boolean) {
  try {
    tone(up ? 1320 : 660, 0, 0.05, 0.05);
  } catch {
    // decoration only
  }
}

export function fanfare() {
  try {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.32, 0.06, "sine"));
    tone(2093, 0.4, 0.6, 0.035, "sine");
  } catch {
    // decoration only
  }
}

export function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}
