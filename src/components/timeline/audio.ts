import { isMuted, onMuteChange } from "@/lib/sound";

/**
 * The timeline's sound, synthesised with WebAudio (no audio files): a soft
 * wind that rises with the speed of travel, a short chiptune sting as each
 * era begins, and a chime when an entry opens. It follows the site's sound
 * toggle (off means no AudioContext at all) and only starts its context
 * from a user gesture. Loaded on the first gesture on the page.
 */

export interface TimelineAudio {
  /** Call from inside a pointer or key handler: starts the context if sound is on. */
  gesture(): void;
  /** Speed of travel in years per second (sign ignored). */
  speed(v: number): void;
  era(index: number): void;
  open(): void;
  close(): void;
  share(): void;
  tour(on: boolean): void;
  dispose(): void;
}

// Equal temperament from A4.
const hz = (n: string) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n)!;
  const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as "C"]! + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
};

/** One original motif per era (index matches the timeline's eras), all short. */
const STINGS: string[][] = [
  ["C5", "G5", "C6"],
  ["G5", "C6", "E6", "G6", "E6"],
  ["A5", "C#6", "E6", "A6", "E6"],
  ["D6", "F#6", "A6", "D7"],
  ["E5", "E6", "B5", "E6", "G6"],
  ["F5", "A5", "C6", "F6", "A6"],
  ["Bb5", "D6", "F6", "Bb6", "F6"],
];

export function createTimelineAudio(): TimelineAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let windGain: GainNode | null = null;
  let windBand: BiquadFilterNode | null = null;
  let wind: AudioBufferSourceNode | null = null;
  let pulse: PeriodicWave | null = null;
  let lastSpeed = -1;
  let dead = false;

  const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;

  function build(): AudioContext | null {
    if (dead || !Ctor || isMuted()) return null;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      return ctx;
    }
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    // Wind: looped soft noise through a band-pass whose centre and level follow the speed.
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      // Pink-ish noise (Paul Kellet's economy filter), so the wind is soft rather than hissy.
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    // Cross-fade the loop's seam.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; }
    wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    windBand = ctx.createBiquadFilter();
    windBand.type = "bandpass";
    windBand.frequency.value = 320;
    windBand.Q.value = 0.7;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windBand).connect(windGain).connect(master);
    wind.start();
    // A 25% pulse wave: the chiptune voice.
    const n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
    pulse = ctx.createPeriodicWave(re, im);
    return ctx;
  }

  function live(): AudioContext | null {
    if (dead || !ctx || isMuted() || ctx.state !== "running") return null;
    return ctx;
  }

  function note(a: AudioContext, f: number, at: number, dur: number, peak: number, type: "pulse" | OscillatorType = "sine") {
    const o = a.createOscillator();
    const g = a.createGain();
    if (type === "pulse" && pulse) o.setPeriodicWave(pulse);
    else o.type = type === "pulse" ? "square" : type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master!);
    o.start(at);
    o.stop(at + dur + 0.03);
  }

  function tick(a: AudioContext, at: number, peak: number, freq: number) {
    const frames = Math.floor(a.sampleRate * 0.03);
    const b = a.createBuffer(1, frames, a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3);
    const s = a.createBufferSource();
    s.buffer = b;
    const f = a.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = freq;
    const g = a.createGain();
    g.gain.value = peak;
    s.connect(f).connect(g).connect(master!);
    s.start(at);
  }

  const stopMute = onMuteChange((muted) => {
    if (muted) {
      if (windGain && ctx) windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      void ctx?.suspend().catch(() => undefined);
    } else {
      // Unmuting is a click, so the context may start now.
      build();
    }
  });
  const onVis = () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else if (!isMuted()) void ctx.resume().catch(() => undefined);
  };
  document.addEventListener("visibilitychange", onVis);

  return {
    gesture() {
      try { build(); } catch { /* sound is decoration */ }
    },
    speed(v) {
      const a = live();
      if (!a || !windGain || !windBand) return;
      const s = Math.min(1, Math.abs(v) / 7);
      if (Math.abs(s - lastSpeed) < 0.01) return;
      lastSpeed = s;
      const t = a.currentTime;
      windGain.gain.setTargetAtTime(0.13 * Math.pow(s, 1.4), t, 0.09);
      windBand.frequency.setTargetAtTime(260 + 2100 * s, t, 0.12);
      windBand.Q.setTargetAtTime(0.7 + s * 0.8, t, 0.12);
    },
    era(index) {
      const a = live();
      if (!a) return;
      const seq = STINGS[index] ?? STINGS[0];
      const t = a.currentTime + 0.02;
      const step = 0.068;
      if (index === STINGS.length - 1) tick(a, t, 0.18, 2500);
      seq.forEach((n, i) => {
        const last = i === seq.length - 1;
        note(a, hz(n), t + i * step, last ? 0.42 : 0.12, last ? 0.045 : 0.035, "pulse");
      });
      // A soft triangle root under it.
      note(a, hz(seq[0]) / 4, t, step * seq.length + 0.3, 0.06, "triangle");
    },
    open() {
      const a = live();
      if (!a) return;
      const t = a.currentTime + 0.005;
      tick(a, t, 0.12, 3200);
      note(a, 1318.5, t, 0.5, 0.045);
      note(a, 1975.5, t + 0.045, 0.6, 0.03);
      note(a, 2637, t + 0.045, 0.25, 0.008);
    },
    close() {
      const a = live();
      if (!a) return;
      note(a, 987.8, a.currentTime + 0.005, 0.12, 0.025);
    },
    share() {
      const a = live();
      if (!a) return;
      const t = a.currentTime + 0.005;
      note(a, 1046.5, t, 0.14, 0.035, "triangle");
      note(a, 1568, t + 0.08, 0.3, 0.035, "triangle");
    },
    tour(on) {
      const a = live();
      if (!a) return;
      const t = a.currentTime + 0.005;
      const seq = on ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 523.25];
      seq.forEach((f, i) => note(a, f, t + i * 0.06, 0.18, 0.03, "pulse"));
    },
    dispose() {
      dead = true;
      stopMute();
      document.removeEventListener("visibilitychange", onVis);
      try { wind?.stop(); } catch { /* not started */ }
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
