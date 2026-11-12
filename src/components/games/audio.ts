import { isMuted, onMuteChange } from "@/lib/sound";
import { APPLAUSE_URL, CROWD_URL, noiseBuffer, scheduleBeep, scheduleGun, scheduleThud, stadiumImpulse } from "@/components/race/audio";
import type { SoundKind } from "./show/types";

/**
 * The sound of the Games: the Race's crowd and applause recordings (CC0,
 * credited in public/audio/race/CREDITS.md) under everything, rising with
 * the show's excitement; the Race's starter's gun, timing beep and heavy
 * thuds; and, synthesised here, the recall gun and its echo off the
 * stands, sand thuds, the bar's clank and its bouncing plates, splashes
 * and dives (the plunge and the droplets), a shot's thump into the turf
 * and a javelin sticking in it, the judges' buzzer, whooshes, and crowd
 * reactions (a crowd of voices: cheers and a roar, an "ooh", a groan). The fanfare and the anthem are
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

/**
 * A crowd's voices: many detuned voices (sawtooths with their own vibrato)
 * through two vowel formants, swelling and gliding together: "aah" rising
 * for a cheer, "ooh" up and down, "ohh" falling for a groan.
 */
function voices(ctx: BaseAudioContext, dest: AudioNode, at: number, o: { n: number; glide: number; formants: [number, number][]; attack: number; hold: number; release: number; gain: number; seed?: number }) {
  let r = (o.seed ?? Math.floor(at * 1000)) % 2147483647 || 7;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const sum = ctx.createGain();
  sum.gain.value = 1 / Math.sqrt(o.n);
  const out = ctx.createGain();
  const end = at + o.attack + o.hold + o.release;
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(o.gain, at + o.attack);
  out.gain.setValueAtTime(o.gain, at + o.attack + o.hold);
  out.gain.exponentialRampToValueAtTime(0.0008, end);
  for (const [f, q] of o.formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = q;
    sum.connect(bp).connect(out);
  }
  out.connect(dest);
  for (let i = 0; i < o.n; i++) {
    const v = ctx.createOscillator();
    v.type = "sawtooth";
    // Men's and women's voices, each a little early or late.
    const f0 = (rnd() < 0.5 ? 115 : 210) * (0.85 + rnd() * 0.3);
    const d = rnd() * 0.12;
    v.frequency.setValueAtTime(f0, at + d);
    v.frequency.exponentialRampToValueAtTime(f0 * o.glide, at + o.attack + o.hold * 0.8 + d);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.5 + rnd() * 2;
    const vg = ctx.createGain();
    vg.gain.value = f0 * 0.025;
    vib.connect(vg).connect(v.frequency);
    v.connect(sum);
    v.start(at + d); vib.start(at + d);
    v.stop(end + 0.05); vib.stop(end + 0.05);
  }
}

/** Water: the plunge (a low thump under a noise burst) and the droplets falling back (short rising chirps). */
function water(ctx: BaseAudioContext, dest: AudioNode, wet: AudioNode, at: number, nz: AudioBuffer, gain: number, big: boolean) {
  burst(ctx, dest, at, nz, { type: "bandpass", f0: 2200, f1: 800, q: 0.7, gain: 0.5 * gain, attack: 0.01, decay: big ? 0.75 : 0.45 });
  burst(ctx, dest, at, nz, { type: "lowpass", f0: 500, f1: 160, gain: 0.45 * gain, attack: 0.008, decay: big ? 0.5 : 0.3 });
  burst(ctx, wet, at, nz, { type: "highpass", f0: 3000, gain: 0.16 * gain, decay: 0.5 });
  for (let i = 0; i < (big ? 9 : 5); i++) {
    const t = at + 0.08 + i * 0.045 + ((i * 37) % 11) * 0.006;
    const o = ctx.createOscillator();
    o.type = "sine";
    const f = 600 + ((i * 53) % 9) * 140;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.06);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.08);
  }
}

/** Schedules one cue at context time `at`. */
export function scheduleCue(ctx: BaseAudioContext, bus: Bus, buf: Buffers, kind: SoundKind, at: number, gain = 1) {
  const { master, wet, crowd, music } = bus;
  const nz = buf.noise;
  switch (kind) {
    case "gun":
      scheduleGun(ctx, master, at, nz, 0.8 * gain);
      scheduleGun(ctx, wet, at, nz, 1.2 * gain);
      // The crack off the stands, a beat later.
      burst(ctx, wet, at + 0.11, nz, { type: "bandpass", f0: 1800, f1: 700, q: 0.9, gain: 0.35 * gain, decay: 0.5 });
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
      // A shot landing: the turf gives (a dull scuff of earth after the thump).
      if (kind === "thud") burst(ctx, master, at + 0.01, nz, { type: "lowpass", f0: 900, f1: 200, gain: 0.3 * gain, decay: 0.32 });
      break;
    case "stick":
      // A javelin into the turf: a sharp thwack, then the shaft quivering.
      burst(ctx, master, at, nz, { type: "bandpass", f0: 1400, q: 1.4, gain: 0.45 * gain, decay: 0.07 });
      scheduleThud(ctx, master, at, nz, 0.25 * gain, 1.6);
      {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = 95;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.09 * gain, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0006, at + 0.7);
        const wob = ctx.createGain();
        wob.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 17;
        const lg = ctx.createGain();
        lg.gain.value = 0.5;
        lfo.connect(lg).connect(wob.gain);
        o.connect(wob).connect(g).connect(master);
        o.start(at); lfo.start(at);
        o.stop(at + 0.75); lfo.stop(at + 0.75);
      }
      break;
    case "sand":
      scheduleThud(ctx, master, at, nz, 0.45 * gain, 0.75);
      burst(ctx, master, at, nz, { type: "lowpass", f0: 1400, f1: 300, gain: 0.5 * gain, decay: 0.45 });
      burst(ctx, wet, at + 0.02, nz, { type: "bandpass", f0: 2400, q: 0.5, gain: 0.12 * gain, decay: 0.3 });
      // The grains settling back.
      burst(ctx, master, at + 0.12, nz, { type: "highpass", f0: 4200, gain: 0.07 * gain, attack: 0.08, decay: 0.5 });
      break;
    case "clank": {
      // Steel on steel: inharmonic partials ringing down, and a rattle.
      for (const [f, gg, d] of [[420, 0.3, 0.9], [1130, 0.22, 0.7], [1870, 0.16, 0.5], [2650, 0.1, 0.35], [3720, 0.06, 0.25]] as const) {
        tone(ctx, master, at, f * (0.97 + Math.random() * 0.06), gg * gain, d, "sine");
        tone(ctx, wet, at, f, gg * 0.5 * gain, d * 1.2, "sine");
      }
      scheduleThud(ctx, master, at, nz, 0.5 * gain, 0.6);
      // The plates bouncing on the platform, each smaller.
      for (const [d, k] of [[0.17, 1], [0.29, 0.6], [0.37, 0.35], [0.43, 0.2]] as const) {
        tone(ctx, master, at + d, 1130 * (0.98 + Math.random() * 0.04), 0.08 * k * gain, 0.3);
        scheduleThud(ctx, master, at + d, nz, 0.18 * k * gain, 0.8);
      }
      break;
    }
    case "splash":
    case "dive":
      water(ctx, master, wet, at, nz, gain, kind === "dive");
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
      // The crowd swells: a voice-band roar up over a second, held, then down, and the voices' "aah" rising (a roar is longer and louder).
      burst(ctx, crowd, at, nz, { type: "bandpass", f0: 900, f1: 1100, q: 0.6, gain: (kind === "roar" ? 0.7 : 0.55) * gain, attack: 0.35, decay: kind === "roar" ? 3.4 : 2.6, dur: 1.5 });
      voices(ctx, crowd, at, { n: kind === "roar" ? 28 : 18, glide: 1.25, formants: [[780, 4], [1250, 5]], attack: 0.3, hold: kind === "roar" ? 1.8 : 1, release: 1.2, gain: (kind === "roar" ? 0.5 : 0.32) * gain });
      if (buf.applause) { const s = ctx.createBufferSource(); s.buffer = buf.applause; const g = ctx.createGain(); g.gain.value = 0.5 * gain; s.connect(g); g.connect(master); g.connect(wet); s.start(at); }
      break;
    case "applause":
      if (buf.applause) { const s = ctx.createBufferSource(); s.buffer = buf.applause; const g = ctx.createGain(); g.gain.value = 0.42 * gain; s.connect(g); g.connect(master); g.connect(wet); s.start(at); }
      break;
    case "ooh":
      burst(ctx, crowd, at, nz, { type: "bandpass", f0: 420, f1: 760, q: 3, gain: 0.35 * gain, attack: 0.18, decay: 1.1, dur: 0.6 });
      voices(ctx, crowd, at, { n: 18, glide: 1.3, formants: [[350, 5], [800, 6]], attack: 0.2, hold: 0.4, release: 0.8, gain: 0.32 * gain });
      break;
    case "groan":
      // "Ohh…": the voices falling away.
      burst(ctx, crowd, at, nz, { type: "bandpass", f0: 700, f1: 260, q: 3.5, gain: 0.35 * gain, attack: 0.12, decay: 1.4, dur: 1.2 });
      voices(ctx, crowd, at, { n: 20, glide: 0.62, formants: [[480, 5], [880, 6]], attack: 0.12, hold: 0.5, release: 1.1, gain: 0.36 * gain });
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
