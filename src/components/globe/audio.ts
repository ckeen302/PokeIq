import { isMuted, onMuteChange } from "@/lib/sound";

/**
 * The globe's sound, synthesised with WebAudio (no audio files, no game
 * audio): a soft space ambience (a slow, breathing pad over filtered pink
 * noise) and small UI chimes. Like the timeline's, it follows the site's
 * sound toggle (off means no AudioContext at all), only starts from a user
 * gesture, and is loaded on the first gesture on the page.
 */

export interface GlobeAudio {
  /** Call from inside a pointer or key handler: starts the context (and the ambience) if sound is on. */
  gesture(): void;
  hover(): void;
  shot(): void;
  card(): void;
  fly(): void;
  era(gen: number): void;
  close(): void;
  dispose(): void;
}

// A pentatonic climb, one note per generation.
const ERA_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

export function createGlobeAudio(): GlobeAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let amb: GainNode | null = null;
  const sources: (AudioScheduledSourceNode | null)[] = [];
  let dead = false;
  let lastHover = 0;

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
    // The ambience fades in over a few seconds and stays very quiet.
    amb = ctx.createGain();
    amb.gain.value = 0;
    amb.gain.setTargetAtTime(1, ctx.currentTime + 0.2, 2.2);
    amb.connect(master);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    lp.Q.value = 0.4;
    lp.connect(amb);
    // A slow LFO opens and closes the filter: the pad breathes.
    const lfo = ctx.createOscillator();
    const lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoAmt.gain.value = 220;
    lfo.connect(lfoAmt).connect(lp.frequency);
    lfo.start();
    sources.push(lfo);
    // An open fifth plus a ninth, each voice slightly detuned against a twin.
    for (const [f, g] of [[55, 0.03], [82.41, 0.022], [123.47, 0.012], [164.81, 0.006]] as const) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        o.detune.value = det;
        const gain = ctx.createGain();
        gain.gain.value = g;
        o.connect(gain).connect(lp);
        o.start();
        sources.push(o);
      }
    }
    // Pink noise through a narrow band: distant solar wind.
    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
    }
    const fade = Math.floor(ctx.sampleRate * 0.08);
    for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.value = 0.035;
    noise.connect(band).connect(ng).connect(amb);
    noise.start();
    sources.push(noise);
    return ctx;
  }

  function live(): AudioContext | null {
    if (dead || !ctx || isMuted() || ctx.state !== "running") return null;
    return ctx;
  }

  function note(a: AudioContext, f: number, at: number, dur: number, peak: number, type: OscillatorType = "sine") {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master!);
    o.start(at);
    o.stop(at + dur + 0.03);
  }

  const stopMute = onMuteChange((muted) => {
    if (muted) void ctx?.suspend().catch(() => undefined);
    else build();
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
    hover() {
      const a = live();
      if (!a) return;
      const now = performance.now();
      if (now - lastHover < 140) return;
      lastHover = now;
      note(a, 1760, a.currentTime + 0.005, 0.09, 0.012);
    },
    shot() {
      const a = live();
      if (!a) return;
      const t = a.currentTime + 0.005;
      note(a, 1318.5, t, 0.32, 0.03);
      note(a, 1975.5, t + 0.05, 0.42, 0.02);
    },
    card() {
      const a = live();
      if (!a) return;
      const t = a.currentTime + 0.01;
      [659.25, 987.77, 1318.51].forEach((f, i) => note(a, f, t + i * 0.07, 0.5 - i * 0.08, 0.028, "triangle"));
    },
    fly() {
      const a = live();
      if (!a) return;
      // A soft whoosh: noise swept through a band-pass.
      const t = a.currentTime;
      const frames = Math.floor(a.sampleRate * 1.1);
      const b = a.createBuffer(1, frames, a.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
      const s = a.createBufferSource();
      s.buffer = b;
      const f = a.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(260, t);
      f.frequency.exponentialRampToValueAtTime(1400, t + 0.55);
      f.frequency.exponentialRampToValueAtTime(380, t + 1.1);
      const g = a.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      s.connect(f).connect(g).connect(master!);
      s.start(t);
      s.stop(t + 1.15);
    },
    era(gen) {
      const a = live();
      if (!a) return;
      const f = ERA_NOTES[Math.max(0, Math.min(ERA_NOTES.length - 1, gen - 1))];
      const t = a.currentTime + 0.005;
      note(a, f, t, 0.45, 0.03, "triangle");
      note(a, f * 1.5, t + 0.06, 0.35, 0.012);
    },
    close() {
      const a = live();
      if (!a) return;
      note(a, 880, a.currentTime + 0.005, 0.12, 0.018, "triangle");
    },
    dispose() {
      dead = true;
      stopMute();
      document.removeEventListener("visibilitychange", onVis);
      for (const s of sources) { try { s?.stop(); } catch { /* not started */ } }
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
