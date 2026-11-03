import { isMuted, onMuteChange } from "@/lib/sound";
import type { ArenaId } from "@/lib/mass-battle/types";

/**
 * The sound of a mass battle, all of it made here except two recordings:
 * an ambience synthesised for each arena (wind over the plains and the
 * snowfield, a low rumble on the volcano, rain when it rains), hits
 * layered by type (a punch's thump and crack under a crackle for Fire, a
 * splash for Water, a zap for Electric, a shatter for Ice, a rumble for
 * Ground…), the recall's rising chirp, a boss's footfalls, thunder, the
 * colosseum's crowd (a CC0 recording, public/audio/mass-battle, credited
 * there) and the CC0 orchestral track Pokémon Sizes uses
 * (public/audio/sizes, credited there). Music and crowd swell for big
 * moments and the finale. Like the rest of the site it follows the sound
 * toggle (off: no AudioContext at all) and starts from a user gesture.
 *
 * The recipes are shared with the video's offline mix, so a video sounds
 * like the battle you watched.
 */

export const BATTLE_MUSIC_URL = "/audio/sizes/epic-endgame.mp3";
/** The colosseum's crowd: a seamless loop. */
export const BATTLE_CROWD_URL = "/audio/mass-battle/crowd.mp3";
/** The crowd's level under the music (the recording is about 5 LU louder than the music at its level). */
const CROWD_LEVEL = 0.3;

/** Loops a decoded MP3, skipping the encoder's padding at either end so the loop has no gap. */
export function loopPoints(duration: number): { start: number; end: number } {
  const start = Math.min(0.05, duration / 4);
  return { start, end: Math.max(start + 0.1, duration - 0.05) };
}

// ---------------------------------------------------------------------------
// Recipes (any audio context, live or offline)
// ---------------------------------------------------------------------------

export function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return n;
}

function env(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, attack: number, dur: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  g.connect(out);
  return g;
}

export function tone(ctx: BaseAudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, gain: number, dur: number, attack = 0.008) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  o.connect(env(ctx, out, t, gain, attack, dur));
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function hiss(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = "bandpass", sweepTo?: number, attack = 0.006) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  s.connect(f).connect(env(ctx, out, t, gain, attack, dur));
  s.start(t, Math.random() * Math.max(0, noise.duration - dur - 0.1));
  s.stop(t + dur + 0.05);
}

/** A hit: the body (a thump and a crack), then its type's layer. `power` 0..1 is how hard it hit. */
export function synthHit(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, type: string, power: number, crit: boolean) {
  const p = Math.min(1, 0.25 + power);
  tone(ctx, out, t, "sine", 130 + Math.random() * 40, 45, 0.32 * p, 0.2);
  hiss(ctx, out, noise, t, 2400, 0.7, 0.07 * p, 0.05, "highpass");
  switch (type) {
    case "Fire":
      hiss(ctx, out, noise, t, 1600, 0.6, 0.22 * p, 0.42, "bandpass", 400);
      for (let k = 0; k < 3; k++) hiss(ctx, out, noise, t + 0.05 + k * 0.06 + Math.random() * 0.03, 3200, 3, 0.05 * p, 0.04, "bandpass");
      break;
    case "Water":
      hiss(ctx, out, noise, t, 1000, 1.2, 0.24 * p, 0.32, "bandpass", 260);
      tone(ctx, out, t + 0.02, "sine", 520, 140, 0.08 * p, 0.16);
      break;
    case "Electric":
      tone(ctx, out, t, "sawtooth", 1500, 260, 0.07 * p, 0.18);
      tone(ctx, out, t + 0.05, "square", 90, 70, 0.04 * p, 0.12);
      hiss(ctx, out, noise, t, 4200, 2, 0.12 * p, 0.14, "highpass");
      break;
    case "Ice":
      tone(ctx, out, t, "triangle", 2600, 1900, 0.06 * p, 0.3);
      tone(ctx, out, t + 0.03, "triangle", 3500, 3100, 0.04 * p, 0.22);
      hiss(ctx, out, noise, t, 5200, 1, 0.08 * p, 0.12, "highpass");
      break;
    case "Grass":
    case "Bug":
      hiss(ctx, out, noise, t, 2800, 1.4, 0.14 * p, 0.22, "bandpass", 1800);
      break;
    case "Psychic":
    case "Fairy":
      tone(ctx, out, t, "sine", 880, 1320, 0.06 * p, 0.32);
      tone(ctx, out, t + 0.04, "sine", 1320, 1980, 0.04 * p, 0.28);
      break;
    case "Ghost":
    case "Dark":
      tone(ctx, out, t, "sine", 320, 110, 0.1 * p, 0.38);
      hiss(ctx, out, noise, t, 500, 0.8, 0.1 * p, 0.35, "lowpass", 160);
      break;
    case "Ground":
    case "Rock":
      hiss(ctx, out, noise, t, 260, 0.8, 0.32 * p, 0.5, "lowpass", 90);
      tone(ctx, out, t, "sine", 70, 34, 0.25 * p, 0.45);
      break;
    case "Dragon":
      tone(ctx, out, t, "sawtooth", 230, 85, 0.07 * p, 0.34);
      hiss(ctx, out, noise, t, 700, 0.7, 0.12 * p, 0.32, "lowpass", 220);
      break;
    case "Steel":
      tone(ctx, out, t, "square", 1850, 1700, 0.035 * p, 0.25);
      tone(ctx, out, t, "triangle", 2700, 2600, 0.05 * p, 0.4);
      break;
    case "Poison":
      for (let k = 0; k < 3; k++) tone(ctx, out, t + k * 0.06, "sine", 260 + k * 80, 560 + k * 80, 0.05 * p, 0.1);
      break;
    case "Flying":
      hiss(ctx, out, noise, t, 600, 0.9, 0.16 * p, 0.32, "bandpass", 1800);
      break;
    default:
      hiss(ctx, out, noise, t, 1200, 0.9, 0.16 * p, 0.15, "bandpass");
  }
  if (crit) tone(ctx, out, t + 0.02, "square", 1800, 2400, 0.04, 0.12);
}

/** A huge moment: a sub drop under a burst. */
export function synthBoom(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, power: number) {
  const p = Math.min(1, power);
  tone(ctx, out, t, "sine", 95, 30, 0.55 * p, 1.1);
  hiss(ctx, out, noise, t, 500, 0.6, 0.28 * p, 0.8, "lowpass", 70);
  hiss(ctx, out, noise, t, 3000, 0.5, 0.06 * p, 0.25, "highpass");
}

/** The recall: the Poké Ball's rising chirp. */
export function synthRecall(ctx: BaseAudioContext, out: AudioNode, t: number, gain = 0.05) {
  tone(ctx, out, t, "sine", 520, 1500, gain, 0.26);
  tone(ctx, out, t + 0.22, "triangle", 1500, 1480, gain * 0.5, 0.12);
}

/** A boss's footfall. */
export function synthStep(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, size: number) {
  const k = Math.min(1, size / 6);
  tone(ctx, out, t, "sine", 60 + (1 - k) * 30, 28, 0.22 + k * 0.25, 0.4);
  hiss(ctx, out, noise, t, 180, 0.7, 0.1 + k * 0.12, 0.35, "lowpass", 60);
}

export function synthThunder(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, strength: number) {
  hiss(ctx, out, noise, t, 2200, 0.4, 0.12 * strength, 0.25, "highpass");
  hiss(ctx, out, noise, t + 0.15, 320, 0.5, 0.35 * strength, 2.4, "lowpass", 60, 0.2);
}

/** A whoosh (slow-motion cuts, the hook card). */
export function synthWhoosh(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, power: number) {
  hiss(ctx, out, noise, t, 400, 1.2, 0.14 * power, 0.5, "bandpass", 2400, 0.25);
}

/** A rising swell into a reveal. */
export function synthRiser(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, dur: number, gain = 0.12) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(5000, t + dur);
  f.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0008, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  s.connect(f).connect(g).connect(out);
  s.start(t, 0);
  s.stop(t + dur + 0.1);
  tone(ctx, out, t, "sawtooth", 110, 440, gain * 0.25, dur, dur * 0.9);
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

export interface BattleAudio {
  gesture(): void;
  /** Ambience and music for a battle in an arena (and its weather). */
  start(arena: ArenaId, weather?: string): void;
  stop(): void;
  hit(type: string, power: number, crit: boolean): void;
  recall(): void;
  boom(power: number): void;
  step(size: number): void;
  thunder(strength: number): void;
  swell(): void;
  /** Slow motion lowers and muffles everything. */
  slow(on: boolean): void;
  dispose(): void;
}

export function createBattleAudio(): BattleAudio {
  const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let musicGain: GainNode | null = null;
  let ambGain: GainNode | null = null;
  let crowdGain: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let music: AudioBufferSourceNode | null = null;
  let crowd: AudioBufferSourceNode | null = null;
  let amb: AudioScheduledSourceNode[] = [];
  let loading: Promise<AudioBuffer | null> | null = null;
  let crowdLoading: Promise<AudioBuffer | null> | null = null;
  let arena: ArenaId | null = null;
  let weather = "";
  let playing = false;
  let dead = false;
  let budget = 0, budgetAt = 0;

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
    // Everything through a gentle limiter, so a pile of hits never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 0.8;
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 18000;
    master.connect(filter).connect(limiter).connect(ctx.destination);
    sfx = ctx.createGain();
    sfx.gain.value = 1;
    sfx.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
    ambGain = ctx.createGain();
    ambGain.gain.value = 0;
    ambGain.connect(master);
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    crowdGain.connect(master);
    noise = noiseBuffer(ctx);
    return ctx;
  }

  function loadMusic(): Promise<AudioBuffer | null> {
    const c = ctx;
    if (!c) return Promise.resolve(null);
    loading ??= fetch(BATTLE_MUSIC_URL).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => null);
    return loading;
  }

  function loadCrowd(): Promise<AudioBuffer | null> {
    const c = ctx;
    if (!c) return Promise.resolve(null);
    crowdLoading ??= fetch(BATTLE_CROWD_URL).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => c.decodeAudioData(b)).catch(() => null);
    return crowdLoading;
  }

  /** The colosseum's crowd fades in once the recording has loaded (the synthesised swell under it covers the wait). */
  function startCrowd() {
    if (!ctx || !crowdGain || crowd || arena !== "colosseum") return;
    void loadCrowd().then((b) => {
      if (!b || !ctx || !crowdGain || crowd || !playing || dead || arena !== "colosseum") return;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      const { start, end } = loopPoints(b.duration);
      s.loopStart = start;
      s.loopEnd = end;
      s.connect(crowdGain);
      s.start(0, start + Math.random() * (end - start));
      crowd = s;
      const t = ctx.currentTime;
      crowdGain.gain.cancelScheduledValues(t);
      crowdGain.gain.setValueAtTime(0, t);
      crowdGain.gain.linearRampToValueAtTime(CROWD_LEVEL, t + 2);
    });
  }

  function startAmbience() {
    if (!ctx || !ambGain || !noise || amb.length || !arena) return;
    const c = ctx;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = c.createBiquadFilter();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    const rain = /rain/i.test(weather);
    if (rain) {
      // Rain: a steady hiss with a soft patter.
      bp.type = "highpass";
      bp.frequency.value = 1400;
      bp.Q.value = 0.4;
      lfo.frequency.value = 0.3;
      lfoGain.gain.value = 200;
    } else if (arena === "colosseum") {
      // Under the recorded crowd: band-passed noise that swells and ebbs.
      bp.type = "bandpass";
      bp.frequency.value = 900;
      bp.Q.value = 0.6;
      lfo.frequency.value = 0.18;
      lfoGain.gain.value = 300;
    } else if (arena === "volcano") {
      bp.type = "lowpass";
      bp.frequency.value = 160;
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 60;
    } else {
      // Wind (stronger in a sandstorm).
      bp.type = "bandpass";
      bp.frequency.value = arena === "snowfield" ? 520 : 420;
      bp.Q.value = 0.8;
      lfo.frequency.value = /sand/i.test(weather) ? 0.25 : 0.11;
      lfoGain.gain.value = 180;
    }
    lfo.connect(lfoGain).connect(bp.frequency);
    src.connect(bp).connect(ambGain);
    src.start();
    lfo.start();
    amb = [src, lfo];
    const t = c.currentTime;
    ambGain.gain.cancelScheduledValues(t);
    ambGain.gain.setValueAtTime(ambGain.gain.value, t);
    ambGain.gain.linearRampToValueAtTime(rain ? 0.22 : /sand/i.test(weather) ? 0.24 : arena === "colosseum" ? 0.1 : 0.16, t + 1.5);
    startCrowd();
  }

  function startMusic() {
    if (!ctx || !musicGain || music) return;
    void loadMusic().then((b) => {
      if (!b || !ctx || !musicGain || music || !playing || dead) return;
      music = ctx.createBufferSource();
      music.buffer = b;
      music.loop = true;
      music.connect(musicGain);
      music.start();
      const t = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(0, t);
      musicGain.gain.linearRampToValueAtTime(0.3, t + 1.5);
    });
  }

  function stopAll() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const g of [musicGain, ambGain, crowdGain]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.8);
    }
    const m = music, cr = crowd, a = amb;
    music = null;
    crowd = null;
    amb = [];
    setTimeout(() => {
      try { m?.stop(); } catch { /* stopped */ }
      try { cr?.stop(); } catch { /* stopped */ }
      for (const s of a) { try { s.stop(); } catch { /* stopped */ } }
    }, 900);
  }

  function close() {
    music = null;
    crowd = null;
    amb = [];
    void ctx?.close().catch(() => undefined);
    ctx = null;
    master = sfx = filter = musicGain = ambGain = crowdGain = null;
    loading = null;
    crowdLoading = null;
  }

  const unsub = onMuteChange((muted) => {
    if (muted) close();
    else if (playing && build()) {
      startAmbience();
      startMusic();
    }
  });

  /** A few sounds a moment at most: a crowd of hits becomes a roar, not a buzz. */
  function allow(cost: number): boolean {
    if (!ctx) return false;
    const now = ctx.currentTime;
    budget = Math.max(0, budget - (now - budgetAt) * 14);
    budgetAt = now;
    if (budget + cost > 10) return false;
    budget += cost;
    return true;
  }

  const ready = () => !!ctx && ctx.state === "running" && !!sfx && !!noise;

  /** The crowd roars for a moment. */
  function roar(level: number, hold = 2) {
    if (!ctx || !crowd || !crowdGain) return;
    const t = ctx.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.linearRampToValueAtTime(CROWD_LEVEL * (1 + level), t + 0.4);
    crowdGain.gain.setValueAtTime(CROWD_LEVEL * (1 + level), t + hold);
    crowdGain.gain.linearRampToValueAtTime(CROWD_LEVEL, t + hold + 3);
  }

  return {
    gesture() {
      if (build() && playing) {
        startAmbience();
        startMusic();
      }
    },
    start(a, w) {
      arena = a;
      weather = w ?? "";
      playing = true;
      if (build()) {
        startAmbience();
        startMusic();
      }
    },
    stop() {
      playing = false;
      stopAll();
    },
    hit(type, power, crit) {
      if (!ready() || !allow(crit ? 2 : 1)) return;
      synthHit(ctx!, sfx!, noise!, ctx!.currentTime, type, power, crit);
    },
    recall() {
      if (!ready() || !allow(0.6)) return;
      synthRecall(ctx!, sfx!, ctx!.currentTime);
    },
    boom(power) {
      if (!ready()) return;
      synthBoom(ctx!, sfx!, noise!, ctx!.currentTime, power);
      if (power > 0.6) roar(power * 0.6, 1.5);
    },
    step(size) {
      if (!ready() || !allow(0.5)) return;
      synthStep(ctx!, sfx!, noise!, ctx!.currentTime, size);
    },
    thunder(strength) {
      if (!ready()) return;
      synthThunder(ctx!, sfx!, noise!, ctx!.currentTime + 0.2 + Math.random() * 0.6, strength);
    },
    swell() {
      if (!ctx || !musicGain) return;
      const t = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(musicGain.gain.value, t);
      musicGain.gain.linearRampToValueAtTime(0.62, t + 1.4);
      musicGain.gain.setValueAtTime(0.62, t + 5);
      musicGain.gain.linearRampToValueAtTime(0.3, t + 8);
      // The crowd roars at the final blow.
      roar(0.8, 3.5);
    },
    slow(on) {
      if (!ctx || !filter) return;
      const t = ctx.currentTime;
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(filter.frequency.value, t);
      filter.frequency.exponentialRampToValueAtTime(on ? 900 : 18000, t + 0.25);
      if (on && noise && sfx) synthWhoosh(ctx, sfx, noise, t, 0.6);
    },
    dispose() {
      dead = true;
      unsub();
      close();
    },
  };
}
