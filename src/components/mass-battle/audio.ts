import { isMuted, onMuteChange } from "@/lib/sound";
import type { ArenaId } from "@/lib/mass-battle/types";

/**
 * The sound of a mass battle, all of it made here except two recordings:
 * an ambience synthesised for each arena (wind over the plains and the
 * snowfield, a low rumble on the volcano), hits layered by type (a punch
 * for Normal moves, a crackle for Fire, a splash for Water, a zap for
 * Electric…), the recall beam's chirp, the colosseum's crowd (a CC0
 * recording, public/audio/mass-battle, credited there) and the CC0
 * orchestral track Pokémon Sizes uses (public/audio/sizes, credited
 * there). Music and crowd swell for the finale. Like the rest of the site
 * it follows the sound toggle (off: no AudioContext at all) and starts
 * from a user gesture.
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

export interface BattleAudio {
  gesture(): void;
  /** Ambience and music for a battle in an arena. */
  start(arena: ArenaId): void;
  stop(): void;
  hit(type: string, power: number, crit: boolean): void;
  recall(): void;
  boom(power: number): void;
  swell(): void;
  /** Slow motion lowers and muffles everything. */
  slow(on: boolean): void;
  dispose(): void;
}

export function createBattleAudio(): BattleAudio {
  const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
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
    master = ctx.createGain();
    master.gain.value = 0.8;
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 18000;
    master.connect(filter).connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
    ambGain = ctx.createGain();
    ambGain.gain.value = 0;
    ambGain.connect(master);
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    crowdGain.connect(master);
    const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = n;
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
    if (arena === "colosseum") {
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
      // Wind.
      bp.type = "bandpass";
      bp.frequency.value = arena === "snowfield" ? 520 : 420;
      bp.Q.value = 0.8;
      lfo.frequency.value = 0.11;
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
    ambGain.gain.linearRampToValueAtTime(arena === "colosseum" ? 0.1 : 0.16, t + 1.5);
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
    master = filter = musicGain = ambGain = crowdGain = null;
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

  function noiseHit(t: number, freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = "bandpass", sweepTo?: number) {
    if (!ctx || !master || !noise) return;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  function tone(t: number, type: OscillatorType, f0: number, f1: number, gain: number, dur: number) {
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    gesture() {
      if (build() && playing) {
        startAmbience();
        startMusic();
      }
    },
    start(a) {
      arena = a;
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
      if (!ctx || ctx.state !== "running" || !allow(crit ? 2 : 1)) return;
      const t = ctx.currentTime;
      const p = Math.min(1, 0.25 + power);
      // The body of the hit: a thump.
      tone(t, "sine", 140 + Math.random() * 30, 48, 0.3 * p, 0.18);
      switch (type) {
        case "Fire": noiseHit(t, 1800, 0.7, 0.22 * p, 0.35, "bandpass", 500); break;
        case "Water": noiseHit(t, 900, 1.4, 0.24 * p, 0.3, "bandpass", 250); break;
        case "Electric": tone(t, "sawtooth", 1400, 300, 0.06 * p, 0.16); noiseHit(t, 4000, 2, 0.12 * p, 0.12, "highpass"); break;
        case "Ice": tone(t, "triangle", 2600, 1800, 0.07 * p, 0.25); break;
        case "Grass": case "Bug": noiseHit(t, 2600, 1.2, 0.14 * p, 0.2, "bandpass"); break;
        case "Psychic": case "Fairy": tone(t, "sine", 880, 1320, 0.06 * p, 0.3); break;
        case "Ghost": case "Dark": tone(t, "sine", 300, 120, 0.1 * p, 0.35); break;
        case "Ground": case "Rock": noiseHit(t, 220, 0.8, 0.3 * p, 0.4, "lowpass"); break;
        case "Dragon": tone(t, "sawtooth", 220, 90, 0.07 * p, 0.3); break;
        default: noiseHit(t, 1200, 0.9, 0.16 * p, 0.14, "bandpass");
      }
      if (crit) tone(t + 0.02, "square", 1800, 2400, 0.04, 0.12);
    },
    recall() {
      if (!ctx || ctx.state !== "running" || !allow(0.6)) return;
      const t = ctx.currentTime;
      tone(t, "sine", 520, 1400, 0.05, 0.28);
    },
    boom(power) {
      if (!ctx || ctx.state !== "running") return;
      const t = ctx.currentTime;
      tone(t, "sine", 90, 32, 0.5 * Math.min(1, power), 0.9);
      noiseHit(t, 400, 0.6, 0.25 * Math.min(1, power), 0.7, "lowpass", 80);
    },
    swell() {
      if (!ctx || !musicGain) return;
      const t = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(musicGain.gain.value, t);
      musicGain.gain.linearRampToValueAtTime(0.62, t + 1.4);
      musicGain.gain.setValueAtTime(0.62, t + 5);
      musicGain.gain.linearRampToValueAtTime(0.3, t + 8);
      if (crowd && crowdGain) {
        // The crowd roars at the final blow.
        crowdGain.gain.cancelScheduledValues(t);
        crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
        crowdGain.gain.linearRampToValueAtTime(CROWD_LEVEL * 1.8, t + 0.8);
        crowdGain.gain.setValueAtTime(CROWD_LEVEL * 1.8, t + 3.5);
        crowdGain.gain.linearRampToValueAtTime(CROWD_LEVEL, t + 8);
      }
    },
    slow(on) {
      if (!ctx || !filter) return;
      const t = ctx.currentTime;
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(filter.frequency.value, t);
      filter.frequency.exponentialRampToValueAtTime(on ? 900 : 18000, t + 0.25);
    },
    dispose() {
      dead = true;
      unsub();
      close();
    },
  };
}
