import { isMuted, onMuteChange } from "@/lib/sound";
import { APPLAUSE_URL, CROWD_URL, noiseBuffer, scheduleBeep, scheduleGun, scheduleThud, stadiumImpulse } from "@/components/race/audio";
import type { SoundKind } from "./show/types";

/**
 * The sound of the Games: the Race's crowd and applause recordings (CC0,
 * credited in public/audio/race/CREDITS.md) under everything, rising with
 * the show's excitement; the Race's starter's gun, timing beep and heavy
 * thuds; and, synthesised here, the recall gun, sand thuds, the bar's
 * clank, splashes and dives, the judges' buzzer, whooshes, and crowd
 * reactions (cheers, an "ooh", a groan). The fanfare and the anthem are
 * original music rendered with the films' score pipeline
 * (scripts/film-score/games.py; public/audio/games/CREDITS.md). Every cue
 * is scheduled by one function, so the live page and the exported video
 * mix exactly the same sound. It follows the site's sound toggle and only
 * starts from a gesture.
 */

export const FANFARE_URL = "/audio/games/fanfare.mp3";
export const ANTHEM_URL = "/audio/games/anthem.mp3";

export interface Buffers {
  noise: AudioBuffer;
  applause: AudioBuffer | null;
  fanfare: AudioBuffer | null;
  anthem: AudioBuffer | null;
}

export interface Bus {
  master: AudioNode;
  wet: AudioNode;
  /** The crowd's reaction bus (a swell on top of the bed). */
  crowd: AudioNode;
  music: AudioNode;
}

function burst(ctx: BaseAudioContext, dest: AudioNode, at: number, noise: AudioBuffer, o: { type: BiquadFilterType; f0: number; f1?: number; q?: number; gain: number; attack?: number; decay: number; dur?: number }) {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.f0, at);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, at + (o.dur ?? o.decay));
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(o.gain, at + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0008, at + (o.attack ?? 0.005) + o.decay);
  n.connect(f).connect(g).connect(dest);
  n.start(at, Math.random() * 1.5);
  n.stop(at + (o.attack ?? 0.005) + o.decay + 0.05);
}

function tone(ctx: BaseAudioContext, dest: AudioNode, at: number, freq: number, gain: number, decay: number, type: OscillatorType = "sine") {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0006, at + decay);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + decay + 0.05);
}

/** Schedules one cue at context time `at`. */
export function scheduleCue(ctx: BaseAudioContext, bus: Bus, buf: Buffers, kind: SoundKind, at: number, gain = 1) {
  const { master, wet, crowd, music } = bus;
  const nz = buf.noise;
  switch (kind) {
    case "gun":
      scheduleGun(ctx, master, at, nz, 0.8 * gain);
      scheduleGun(ctx, wet, at, nz, 1.2 * gain);
      break;
    case "recall":
      for (const d of [0, 0.2]) { scheduleGun(ctx, master, at + d, nz, 0.6 * gain); scheduleGun(ctx, wet, at + d, nz, 0.9 * gain); }
      break;
    case "beep":
      scheduleBeep(ctx, master, at, 0.18 * gain);
      break;
    case "thud":
    case "impact":
    case "stomp":
      scheduleThud(ctx, master, at, nz, Math.min(0.9, 0.5 * gain), kind === "impact" ? 0.7 : 1);
      break;
    case "sand":
      scheduleThud(ctx, master, at, nz, 0.35 * gain, 0.8);
      burst(ctx, master, at, nz, { type: "lowpass", f0: 1400, f1: 300, gain: 0.5 * gain, decay: 0.45 });
      burst(ctx, wet, at + 0.02, nz, { type: "bandpass", f0: 2400, q: 0.5, gain: 0.12 * gain, decay: 0.3 });
      break;
    case "clank": {
      // Steel on steel: inharmonic partials ringing down, and a rattle.
      for (const [f, gg, d] of [[420, 0.3, 0.9], [1130, 0.22, 0.7], [1870, 0.16, 0.5], [2650, 0.1, 0.35], [3720, 0.06, 0.25]] as const) {
        tone(ctx, master, at, f * (0.97 + Math.random() * 0.06), gg * gain, d, "sine");
        tone(ctx, wet, at, f, gg * 0.5 * gain, d * 1.2, "sine");
      }
      scheduleThud(ctx, master, at, nz, 0.5 * gain, 0.6);
      for (const d of [0.17, 0.29]) tone(ctx, master, at + d, 1130 * (0.98 + Math.random() * 0.04), 0.08 * gain, 0.3);
      break;
    }
    case "splash":
    case "dive":
      burst(ctx, master, at, nz, { type: "bandpass", f0: 2200, f1: 900, q: 0.7, gain: 0.55 * gain, attack: 0.01, decay: kind === "dive" ? 0.7 : 0.45 });
      burst(ctx, wet, at, nz, { type: "highpass", f0: 3000, gain: 0.18 * gain, decay: 0.5 });
      if (kind === "dive") scheduleThud(ctx, master, at, nz, 0.25 * gain, 1.4);
      break;
    case "whoosh":
      burst(ctx, master, at, nz, { type: "bandpass", f0: 400, f1: 2200, q: 1.2, gain: 0.25 * gain, attack: 0.12, decay: 0.3, dur: 0.4 });
      break;
    case "buzzer":
      tone(ctx, master, at, 220, 0.12 * gain, 0.65, "square");
      tone(ctx, wet, at, 220, 0.06 * gain, 0.8, "square");
      break;
    case "whistle":
      for (const f of [2950, 3150]) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const tr = ctx.createOscillator();
        tr.frequency.value = 28;
        const tg = ctx.createGain();
        tg.gain.value = 140;
        tr.connect(tg).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.07 * gain, at + 0.02);
        g.gain.setValueAtTime(0.07 * gain, at + 0.45);
        g.gain.linearRampToValueAtTime(0, at + 0.5);
        o.connect(g).connect(master);
        o.start(at); tr.start(at);
        o.stop(at + 0.55); tr.stop(at + 0.55);
      }
      break;
    case "chalk":
      burst(ctx, master, at, nz, { type: "highpass", f0: 1800, gain: 0.12 * gain, decay: 0.12 });
      break;
    case "cheer":
    case "roar":
      // The crowd swells: a voice-band roar up over a second, held, then down.
      burst(ctx, crowd, at, nz, { type: "bandpass", f0: 900, f1: 1100, q: 0.6, gain: 0.55 * gain, attack: 0.35, decay: 2.6, dur: 1.5 });
      if (buf.applause) { const s = ctx.createBufferSource(); s.buffer = buf.applause; const g = ctx.createGain(); g.gain.value = 0.5 * gain; s.connect(g); g.connect(master); g.connect(wet); s.start(at); }
      break;
    case "applause":
      if (buf.applause) { const s = ctx.createBufferSource(); s.buffer = buf.applause; const g = ctx.createGain(); g.gain.value = 0.42 * gain; s.connect(g); g.connect(master); g.connect(wet); s.start(at); }
      break;
    case "ooh":
      burst(ctx, crowd, at, nz, { type: "bandpass", f0: 420, f1: 760, q: 3, gain: 0.5 * gain, attack: 0.18, decay: 1.1, dur: 0.6 });
      break;
    case "groan":
      burst(ctx, crowd, at, nz, { type: "bandpass", f0: 700, f1: 260, q: 3.5, gain: 0.55 * gain, attack: 0.12, decay: 1.4, dur: 1.2 });
      break;
    case "fanfare":
    case "anthem": {
      const b = kind === "fanfare" ? buf.fanfare : buf.anthem;
      if (!b) break;
      const s = ctx.createBufferSource();
      s.buffer = b;
      const g = ctx.createGain();
      g.gain.value = (kind === "fanfare" ? 0.75 : 0.6) * gain;
      s.connect(g).connect(music);
      s.start(at);
      break;
    }
  }
}

/** The crowd bed's levels for an excitement (0..1). */
export const crowdLevels = (e: number) => ({ bed: 0.18 + 0.5 * e, roar: 0.02 + 0.22 * e * e, cutoff: 1300 + 2600 * e });

/** Builds the mixer on a context: master, reverb, the crowd bed and roar, a music bus. */
export function buildMixer(ctx: BaseAudioContext, crowdBuf: AudioBuffer | null, noise: AudioBuffer) {
  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = stadiumImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  wet.connect(verb).connect(master);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  const bed = ctx.createGain();
  bed.gain.value = 0;
  filter.connect(bed);
  bed.connect(master);
  bed.connect(wet);
  const roar = ctx.createGain();
  roar.gain.value = 0;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 0.6;
  const rs = ctx.createBufferSource();
  rs.buffer = noise;
  rs.loop = true;
  rs.connect(bp).connect(roar);
  roar.connect(master);
  roar.connect(wet);
  rs.start(0);
  const crowd = ctx.createGain();
  crowd.gain.value = 1;
  crowd.connect(master);
  crowd.connect(wet);
  // Music sits on its own bus, ducked a little under the cheers.
  const music = ctx.createGain();
  music.gain.value = 0.9;
  music.connect(master);
  let src: AudioBufferSourceNode | null = null;
  if (crowdBuf) {
    src = ctx.createBufferSource();
    src.buffer = crowdBuf;
    src.loop = true;
    src.connect(filter);
    src.start(0, Math.random() * Math.max(0, crowdBuf.duration - 1));
  }
  return { bus: { master, wet, crowd, music } as Bus, bed, roar, filter, src };
}

export interface GamesAudio {
  gesture(): void;
  crowd(level: number): void;
  cue(kind: SoundKind, gain?: number): void;
  footfall(kg: number, dist: number): void;
  /** Stops every scheduled sound (a seek, a restart). */
  hush(): void;
  dispose(): void;
}

export function createGamesAudio(): GamesAudio {
  let ctx: AudioContext | null = null;
  let mix: ReturnType<typeof buildMixer> | null = null;
  let buf: Buffers | null = null;
  let level = 0.25;
  let dead = false;
  let lastThud = 0;
  const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  const load = (c: BaseAudioContext, url: string) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => c.decodeAudioData(b)).catch(() => null);

  function build(): AudioContext | null {
    if (dead || !Ctor || isMuted()) return null;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      return ctx;
    }
    try { ctx = new Ctor(); } catch { return null; }
    const c = ctx;
    const noise = noiseBuffer(c, 3);
    buf = { noise, applause: null, fanfare: null, anthem: null };
    mix = buildMixer(c, null, noise);
    void load(c, CROWD_URL).then((b) => {
      if (!b || dead || ctx !== c || !mix) return;
      const s = c.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.connect(mix.filter);
      s.start();
      mix.src = s;
      apply();
    });
    void load(c, APPLAUSE_URL).then((b) => { if (buf) buf.applause = b; });
    void load(c, FANFARE_URL).then((b) => { if (buf) buf.fanfare = b; });
    void load(c, ANTHEM_URL).then((b) => { if (buf) buf.anthem = b; });
    apply();
    return c;
  }

  function apply() {
    if (!ctx || !mix) return;
    const t = ctx.currentTime;
    const l = crowdLevels(level);
    mix.bed.gain.setTargetAtTime(l.bed, t, 0.4);
    mix.roar.gain.setTargetAtTime(l.roar, t, 0.3);
    mix.filter.frequency.setTargetAtTime(l.cutoff, t, 0.4);
  }

  function close() {
    void ctx?.close().catch(() => undefined);
    ctx = null;
    mix = null;
  }
  const stop = onMuteChange((m) => { if (m) close(); });

  return {
    gesture() { build(); },
    crowd(l) { level = Math.max(0, Math.min(1, l)); apply(); },
    cue(kind, gain = 1) {
      const c = ctx;
      if (!c || !mix || !buf || c.state !== "running") return;
      scheduleCue(c, mix.bus, buf, kind, c.currentTime + 0.01, gain);
    },
    footfall(kg, dist) {
      const c = ctx;
      if (!c || !mix || !buf || c.state !== "running") return;
      if (c.currentTime - lastThud < 0.05) return;
      lastThud = c.currentTime;
      const g = Math.min(0.9, (0.35 * Math.sqrt(kg / 400)) / (1 + dist / 30));
      if (g > 0.02) scheduleThud(c, mix.bus.master, c.currentTime + 0.005, buf.noise, g, Math.max(0.55, 1.4 - kg / 1500));
    },
    hush() {
      // Music and long cues already scheduled can't be cancelled one by one: rebuild the context's buses quietly.
      if (!ctx || !mix || !buf) return;
      const c = ctx;
      mix.bus.music.disconnect();
      const music = c.createGain();
      music.gain.value = 0.9;
      music.connect(mix.bus.master as GainNode);
      mix.bus.music = music;
    },
    dispose() { dead = true; stop(); close(); },
  };
}
