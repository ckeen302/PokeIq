import { isMuted, onMuteChange } from "@/lib/sound";

/**
 * The sound of /pokedex/race: a stadium at night. A CC0 crowd recording
 * loops under everything (louder and brighter as the race heats up, with a
 * synthesised roar on top), the starter's gun cracks round the bowl,
 * heavy runners thud, the finish brings a roar and applause (CC0), and the
 * timing system beeps for the photo finish. Recordings are credited in
 * public/audio/race/CREDITS.md; everything else is synthesised here. Like
 * the site's other audio it follows the sound toggle (off means no
 * AudioContext at all) and only starts from a user gesture.
 */

export const CROWD_URL = "/audio/race/crowd.mp3";
export const APPLAUSE_URL = "/audio/race/applause.mp3";

export interface RaceAudio {
  /** Call from inside a pointer or key handler: starts the context if sound is on. */
  gesture(): void;
  /** Crowd level, 0 (quiet before the start) to 1 (the finish). */
  crowd(level: number): void;
  gun(): void;
  footfall(kg: number, dist: number): void;
  roar(): void;
  beep(): void;
  dispose(): void;
}

/** A stadium's reverb: a stereo noise tail decaying over about 2.4 s, with a slap off the far stand. */
export function stadiumImpulse(ctx: BaseAudioContext, seconds = 2.6): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 1234 + c * 999;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      d[i] = rnd() * Math.exp(-t * 2.9) * (t < 0.01 ? t / 0.01 : 1);
    }
    // Slap-back echoes off the stands.
    for (const [at, g] of [[0.19, 0.5], [0.33, 0.35], [0.52, 0.22]] as const) {
      const i0 = Math.floor((at + c * 0.013) * ctx.sampleRate);
      for (let i = 0; i < 400 && i0 + i < n; i++) d[i0 + i] += rnd() * g * Math.exp(-i / 120);
    }
  }
  return buf;
}

/** The starter's gun into `dest` at time `at`: a sharp crack and a low thump (the reverb does the rest). */
export function scheduleGun(ctx: BaseAudioContext, dest: AudioNode, at: number, noise: AudioBuffer, gain = 1) {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(1.0 * gain, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
  n.connect(hp).connect(g).connect(dest);
  n.start(at);
  n.stop(at + 0.3);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(140, at);
  o.frequency.exponentialRampToValueAtTime(45, at + 0.18);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.9 * gain, at);
  og.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
  o.connect(og).connect(dest);
  o.start(at);
  o.stop(at + 0.3);
}

/** A heavy footfall: a low thud with a pitch drop and a scuff. */
export function scheduleThud(ctx: BaseAudioContext, dest: AudioNode, at: number, noise: AudioBuffer, gain: number, pitch = 1) {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(95 * pitch, at);
  o.frequency.exponentialRampToValueAtTime(38 * pitch, at + 0.12);
  const og = ctx.createGain();
  og.gain.setValueAtTime(gain, at);
  og.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
  o.connect(og).connect(dest);
  o.start(at);
  o.stop(at + 0.25);
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.25, at);
  ng.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
  n.connect(lp).connect(ng).connect(dest);
  n.start(at, Math.random() * 0.5);
  n.stop(at + 0.08);
}

/** The timing system's beep. */
export function scheduleBeep(ctx: BaseAudioContext, dest: AudioNode, at: number, gain = 0.18) {
  const o = ctx.createOscillator();
  o.type = "square";
  o.frequency.value = 1760;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.005);
  g.gain.setValueAtTime(gain, at + 0.12);
  g.gain.linearRampToValueAtTime(0, at + 0.13);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + 0.15);
}

export function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  // Pinkish noise (Paul Kellet's filter) for a fuller crowd roar.
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return b;
}

export function createRaceAudio(): RaceAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null, wet: GainNode | null = null, crowdGain: GainNode | null = null, roarGain: GainNode | null = null, crowdFilter: BiquadFilterNode | null = null;
  let noise: AudioBuffer | null = null;
  let crowdSrc: AudioBufferSourceNode | null = null, roarSrc: AudioBufferSourceNode | null = null;
  let applause: AudioBuffer | null = null;
  let level = 0.25;
  let dead = false;
  let lastThud = 0;
  const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;

  const load = (c: AudioContext, url: string) => fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => null);

  function build(): AudioContext | null {
    if (dead || !Ctor || isMuted()) return null;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      return ctx;
    }
    try { ctx = new Ctor(); } catch { return null; }
    const c = ctx;
    master = c.createGain();
    master.gain.value = 0.85;
    master.connect(c.destination);
    const verb = c.createConvolver();
    verb.buffer = stadiumImpulse(c);
    wet = c.createGain();
    wet.gain.value = 0.55;
    wet.connect(verb).connect(master);
    crowdFilter = c.createBiquadFilter();
    crowdFilter.type = "lowpass";
    crowdFilter.frequency.value = 1800;
    crowdGain = c.createGain();
    crowdGain.gain.value = 0;
    crowdFilter.connect(crowdGain);
    crowdGain.connect(master);
    crowdGain.connect(wet);
    noise = noiseBuffer(c, 3);
    // The roar: pink noise through a voice-band filter, following the excitement.
    roarGain = c.createGain();
    roarGain.gain.value = 0;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    roarSrc = c.createBufferSource();
    roarSrc.buffer = noise;
    roarSrc.loop = true;
    roarSrc.connect(bp).connect(roarGain);
    roarGain.connect(master);
    roarGain.connect(wet);
    roarSrc.start();
    void load(c, CROWD_URL).then((b) => {
      if (!b || dead || ctx !== c || !crowdFilter) return;
      crowdSrc = c.createBufferSource();
      crowdSrc.buffer = b;
      crowdSrc.loop = true;
      crowdSrc.connect(crowdFilter);
      crowdSrc.start();
      apply();
    });
    void load(c, APPLAUSE_URL).then((b) => { applause = b; });
    apply();
    return c;
  }

  function apply() {
    if (!ctx || !crowdGain || !roarGain || !crowdFilter) return;
    const t = ctx.currentTime;
    crowdGain.gain.setTargetAtTime(0.18 + 0.5 * level, t, 0.4);
    roarGain.gain.setTargetAtTime(0.02 + 0.22 * level * level, t, 0.3);
    crowdFilter.frequency.setTargetAtTime(1300 + 2600 * level, t, 0.4);
  }

  function close() {
    crowdSrc = roarSrc = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
    master = wet = crowdGain = roarGain = crowdFilter = null;
  }

  const stopSync = onMuteChange((muted) => { if (muted) close(); });

  return {
    gesture() { build(); },
    crowd(l) {
      level = Math.max(0, Math.min(1, l));
      apply();
    },
    gun() {
      const c = ctx;
      if (!c || !master || !wet || !noise || c.state !== "running") return;
      const t = c.currentTime + 0.01;
      scheduleGun(c, master, t, noise, 0.8);
      scheduleGun(c, wet, t, noise, 1.2);
    },
    footfall(kg, dist) {
      const c = ctx;
      if (!c || !master || !noise || c.state !== "running") return;
      if (c.currentTime - lastThud < 0.05) return;
      lastThud = c.currentTime;
      const gain = Math.min(0.9, 0.35 * Math.sqrt(kg / 400) / (1 + dist / 30));
      if (gain < 0.02) return;
      scheduleThud(c, master, c.currentTime + 0.005, noise, gain, Math.max(0.55, 1.4 - kg / 1500));
    },
    roar() {
      const c = ctx;
      if (!c || !master || !wet || c.state !== "running") return;
      if (applause) {
        const s = c.createBufferSource();
        s.buffer = applause;
        const g = c.createGain();
        g.gain.value = 0.55;
        s.connect(g);
        g.connect(master);
        g.connect(wet);
        s.start();
      }
    },
    beep() {
      const c = ctx;
      if (!c || !master || c.state !== "running") return;
      scheduleBeep(c, master, c.currentTime + 0.01);
    },
    dispose() {
      dead = true;
      stopSync();
      close();
    },
  };
}
