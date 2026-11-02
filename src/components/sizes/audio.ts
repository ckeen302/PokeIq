import { isMuted, onMuteChange } from "@/lib/sound";

/**
 * The sound of /pokedex/sizes: the CC0 cinematic track (public/audio/sizes,
 * credited there) under the Play glide, swelling into the finale, and soft
 * synthesised whooshes when the camera flies or pauses. Like the timeline's
 * and the globe's, it follows the site's sound toggle (off means no
 * AudioContext at all) and only starts its context from a user gesture.
 */

export interface SizesAudio {
  /** Call from inside a pointer or key handler: starts the context if sound is on. */
  gesture(): void;
  /** The music under the glide (fades in and out). */
  music(on: boolean): void;
  /** The big reveal: the music rises for a few seconds. */
  swell(): void;
  whoosh(strength?: number): void;
  dispose(): void;
}

export const MUSIC_URL = "/audio/sizes/epic-endgame.mp3";
const MUSIC_LEVEL = 0.32;

export function createSizesAudio(): SizesAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let musicGain: GainNode | null = null;
  let src: AudioBufferSourceNode | null = null;
  let loading: Promise<AudioBuffer | null> | null = null;
  let noise: AudioBuffer | null = null;
  let wantMusic = false;
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
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
    const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = n;
    return ctx;
  }

  function load(): Promise<AudioBuffer | null> {
    const c = ctx;
    if (!c) return Promise.resolve(null);
    loading ??= fetch(MUSIC_URL)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .catch(() => null);
    return loading;
  }

  function startMusic() {
    if (!ctx || !musicGain || src) return;
    void load().then((b) => {
      if (!b || !ctx || !musicGain || src || !wantMusic || dead) return;
      src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(musicGain);
      src.start();
      const t = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(musicGain.gain.value, t);
      musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + 1.2);
    });
  }

  function stopMusic() {
    if (!ctx || !musicGain || !src) return;
    const s = src;
    src = null;
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(musicGain.gain.value, t);
    musicGain.gain.linearRampToValueAtTime(0, t + 0.9);
    try { s.stop(t + 1); } catch { /* already stopped */ }
  }

  function close() {
    src = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
    master = musicGain = null;
    loading = null;
  }

  const stopSync = onMuteChange((muted) => {
    if (muted) close();
    else if (wantMusic && build()) startMusic();
  });

  return {
    gesture() {
      if (build() && wantMusic) startMusic();
    },
    music(on) {
      wantMusic = on;
      if (on) { if (build()) startMusic(); } else stopMusic();
    },
    swell() {
      if (!ctx || !musicGain || !src) return;
      const t = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(musicGain.gain.value, t);
      musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL * 2.1, t + 1.6);
      musicGain.gain.setValueAtTime(MUSIC_LEVEL * 2.1, t + 4.5);
      musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + 7);
    },
    whoosh(strength = 1) {
      const c = ctx;
      if (!c || !master || !noise || c.state !== "running") return;
      const t = c.currentTime;
      const s = c.createBufferSource();
      s.buffer = noise;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(380, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 * strength, t + 0.32);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
      s.connect(bp).connect(g).connect(master);
      s.start(t);
      s.stop(t + 1);
    },
    dispose() {
      dead = true;
      stopSync();
      close();
    },
  };
}
