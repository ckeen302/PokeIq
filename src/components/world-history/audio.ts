import { isMuted } from "@/lib/sound";
import { CHAPTERS } from "@/lib/world-history/data";
import { videoAt, type Film, type FilmState, type VideoPlan } from "@/lib/world-history/timing";

/**
 * The film's sound. Four CC0 tracks by cynicmusic (credited in
 * public/audio/world-history/CREDITS.md) play together as layers, and each
 * chapter sets their mix: an ambient bed throughout, a deep "cave" layer
 * for ruins and laboratories, an icy layer for the cosmos and the snow,
 * and a cinematic layer that swells at each chapter's big moment. On top,
 * synthesised sound: a whoosh through each doorway, booms and rumbles at
 * impacts, a shimmer when something forms out of light. Like the site's
 * other audio it follows the sound toggle (off means no AudioContext at
 * all) and starts only from a user gesture. Videos get the same mix,
 * rendered offline (renderVideoAudio).
 */

export const MUSIC = {
  bed: "/audio/world-history/sirens-in-darkness.mp3",
  cave: "/audio/world-history/crystal-cave.mp3",
  ice: "/audio/world-history/icy-realm.mp3",
  epic: "/audio/world-history/epic-endgame.mp3",
} as const;
type Layer = keyof typeof MUSIC;
const LAYERS: Layer[] = ["bed", "cave", "ice", "epic"];

type Hit = "boom" | "rumble" | "shimmer" | "thunder";

/** Each chapter's mix: base levels, and the windows where the cinematic layer swells (beat id + offset, anim seconds). */
interface Mood {
  bed: number;
  cave: number;
  ice: number;
  swells: [string, number, string, number][];
  hits: [Hit, string, number][];
}

export const MOODS: Record<string, Mood> = {
  creation: { bed: 0.55, cave: 0, ice: 0.55, swells: [["egg", 2.6, "time-space", 3], ["third", 0, "banished", 5]], hits: [["boom", "egg", 3.6], ["shimmer", "arceus", 0.2], ["shimmer", "three", 0.6], ["rumble", "third", 0.4]] },
  giants: { bed: 0.6, cave: 0.45, ice: 0, swells: [["towed", 0, "shaped", 0]], hits: [["rumble", "towed", 0.8], ["rumble", "hisui", 2], ["shimmer", "shaped", 0.5], ["boom", "sealed", -0.35]] },
  hoenn: { bed: 0.45, cave: 0, ice: 0, swells: [["clash", 0, "sootopolis", 1.5], ["sootopolis", 4.6, "peace", 3]], hits: [["thunder", "clash", 0.6], ["thunder", "clash", 4.2], ["boom", "rayquaza", 3], ["boom", "sootopolis", 2.4], ["shimmer", "sootopolis", 6.2]] },
  kalos: { bed: 0.6, cave: 0, ice: 0, swells: [["weapon", 1, "left", -1]], hits: [["rumble", "weapon", -0.6], ["shimmer", "weapon", 2.4], ["boom", "light", -0.2], ["boom", "light", 3.5], ["shimmer", "light", 4.4]] },
  galar: { bed: 0.5, cave: 0, ice: 0, swells: [["meteorite", 0.6, "hero", -0.5], ["two", 0, "calyrex", -0.5]], hits: [["boom", "meteorite", 1.75], ["thunder", "storm", 0.6], ["shimmer", "two", 0], ["shimmer", "calyrex", 0.5]] },
  unova: { bed: 0.55, cave: 0, ice: 0, swells: [["split", 0, "ceased", 1], ["sons", 0, "husk", -0.5]], hits: [["boom", "split", 1.5], ["thunder", "sons", 0.5], ["boom", "sons", 3.5], ["shimmer", "husk", 1]] },
  kitakami: { bed: 0.7, cave: 0, ice: 0, swells: [["donned", 0, "thought", 0]], hits: [["shimmer", "masks", 0.6], ["boom", "donned", 1.6]] },
  johto: { bed: 0.6, cave: 0.4, ice: 0, swells: [["fire", 0, "perished", 0], ["perished", 1, "flew", 5]], hits: [["thunder", "fire", 0.9], ["shimmer", "perished", 1.4], ["shimmer", "beasts", 0.6]] },
  hisui: { bed: 0.5, cave: 0, ice: 0.45, swells: [["rift", 0, "name", 1]], hits: [["boom", "rift", 1.4], ["shimmer", "creator", 0], ["boom", "creator", 2.4]] },
  alola: { bed: 0.55, cave: 0.3, ice: 0, swells: [["islands", -1, "greed", -0.5], ["stole", 0, "z", 1]], hits: [["rumble", "islands", -1.5], ["rumble", "islands", 1.5], ["boom", "stole", 1.6], ["shimmer", "tapu", 1.6]] },
  kanto: { bed: 0.5, cave: 0.5, ice: 0, swells: [["powerful", 0.5, "created", 2]], hits: [["shimmer", "mew", 0], ["boom", "powerful", 1.5]] },
  paldea: { bed: 0.5, cave: 0.4, ice: 0, swells: [["tera", 0, "machine", 0], ["paradox", 0, "paradox", 9.5]], hits: [["rumble", "tera", 0], ["shimmer", "machine", 0], ["boom", "paradox", 1.2]] },
};

const smoothstep = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Anim time of a beat in chapter `index` (the chapter's start when the beat isn't in the film). */
function beatAnim(film: Film, index: number, id: string): number {
  return film.chapters[index].beats.find((b) => b.id === id)?.anim ?? 0;
}

/** The mix (0..1 per layer) at a chapter moment. */
export function mixAt(film: Film, index: number, anim: number): Record<Layer, number> {
  const c = CHAPTERS[index];
  const m = MOODS[c.id];
  if (!m) return { bed: 0.7, cave: 0, ice: 0, epic: 0 };
  let epic = 0;
  for (const [a, da, b, db] of m.swells) {
    const t0 = beatAnim(film, index, a) + da, t1 = beatAnim(film, index, b) + db;
    epic = Math.max(epic, smoothstep(t0 - 1.5, t0 + 0.5, anim) * (1 - smoothstep(t1 - 0.5, t1 + 2.5, anim)));
  }
  return { bed: m.bed * (1 - epic * 0.45), cave: m.cave * (1 - epic * 0.6), ice: m.ice * (1 - epic * 0.5), epic };
}

const HALL_MIX: Record<Layer, number> = { bed: 0.75, cave: 0, ice: 0.12, epic: 0 };

/** The mix at any film state (the hall between chapters is the bed alone). */
export function mixFor(film: Film, s: FilmState): Record<Layer, number> {
  if (s.kind === "chapter") return mixAt(film, s.index, s.anim);
  const k = s.k;
  const a = s.hall.from >= 0 ? mixAt(film, s.hall.from, film.chapters[s.hall.from].anim) : HALL_MIX;
  const b = s.hall.to < film.chapters.length ? mixAt(film, s.hall.to, 0) : HALL_MIX;
  const out = {} as Record<Layer, number>;
  for (const l of LAYERS) {
    const mid = HALL_MIX[l];
    out[l] = k < 0.5 ? a[l] + (mid - a[l]) * smoothstep(0, 0.5, k) : mid + (b[l] - mid) * smoothstep(0.5, 1, k);
  }
  return out;
}

/** The hits of chapter `index` (anim seconds). */
export function hitsOf(film: Film, index: number): { kind: Hit; at: number }[] {
  const m = MOODS[CHAPTERS[index].id];
  return m ? m.hits.map(([kind, id, d]) => ({ kind, at: beatAnim(film, index, id) + d })) : [];
}

// ---------------------------------------------------------------------------
// Synthesis (shared by the live mix and the offline render)
// ---------------------------------------------------------------------------

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 4321;
  for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
  return buf;
}

/** A long, dark hall reverb. */
function hallImpulse(ctx: BaseAudioContext, seconds = 3.2): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 777 + c * 131;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const t = i / ctx.sampleRate;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.exp(-t * 2.1) * (t < 0.02 ? t / 0.02 : 1) * 0.6;
    }
  }
  return buf;
}

function scheduleHit(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, noise: AudioBuffer, kind: Hit, at: number, gain = 1) {
  const g = (v: number) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  if (kind === "boom" || kind === "rumble") {
    const long = kind === "rumble" ? 2.6 : 1.6;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(kind === "boom" ? 70 : 45, at);
    o.frequency.exponentialRampToValueAtTime(28, at + long);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, at);
    og.gain.linearRampToValueAtTime(0.75 * gain, at + (kind === "boom" ? 0.02 : 0.5));
    og.gain.exponentialRampToValueAtTime(0.001, at + long);
    o.connect(og);
    og.connect(dry);
    og.connect(wet);
    o.start(at);
    o.stop(at + long + 0.1);
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(kind === "boom" ? 1400 : 380, at);
    lp.frequency.exponentialRampToValueAtTime(120, at + long);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, at);
    sg.gain.linearRampToValueAtTime((kind === "boom" ? 0.5 : 0.35) * gain, at + (kind === "boom" ? 0.015 : 0.6));
    sg.gain.exponentialRampToValueAtTime(0.001, at + long);
    s.connect(lp).connect(sg);
    sg.connect(dry);
    sg.connect(wet);
    s.start(at, Math.random() * 0.5);
    s.stop(at + long + 0.1);
    return;
  }
  if (kind === "thunder") {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, at);
    lp.frequency.exponentialRampToValueAtTime(160, at + 2.4);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, at);
    sg.gain.linearRampToValueAtTime(0.55 * gain, at + 0.01);
    sg.gain.setValueAtTime(0.2 * gain, at + 0.08);
    sg.gain.linearRampToValueAtTime(0.42 * gain, at + 0.16);
    sg.gain.exponentialRampToValueAtTime(0.001, at + 2.6);
    s.connect(lp).connect(sg);
    sg.connect(dry);
    sg.connect(wet);
    s.start(at, Math.random() * 0.5);
    s.stop(at + 2.8);
    return;
  }
  // Shimmer: a soft rising chord of bells into the reverb.
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  notes.forEach((f, i) => {
    const t = at + i * 0.07;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.08 * gain, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    o.connect(og);
    og.connect(wet);
    og.connect(g(0.4)).connect(dry);
    o.start(t);
    o.stop(t + 2.3);
  });
}

function scheduleWhoosh(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, at: number, gain = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(300, at);
  bp.frequency.exponentialRampToValueAtTime(2400, at + 0.9);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.2 * gain, at + 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, at + 1.4);
  s.connect(bp).connect(g).connect(dest);
  s.start(at, Math.random() * 0.5);
  s.stop(at + 1.5);
}

const LAYER_GAIN: Record<Layer, number> = { bed: 0.75, cave: 0.6, ice: 0.55, epic: 0.8 };

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

export interface HistoryAudio {
  /** Call from inside a pointer or key handler: starts the context if sound is on. */
  gesture(): void;
  setMuted(m: boolean): void;
  update(s: { state: FilmState; playing: boolean; dt: number }): void;
  dispose(): void;
}

export function createHistoryAudio(film: Film): HistoryAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null, dry: GainNode | null = null, wet: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  const layerGain = new Map<Layer, GainNode>();
  const sources: AudioBufferSourceNode[] = [];
  let dead = false;
  let last: FilmState | null = null;
  const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;

  function build(): AudioContext | null {
    if (dead || !Ctor || isMuted()) return null;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      return ctx;
    }
    try { ctx = new Ctor(); } catch { return null; }
    const c = ctx;
    master = c.createGain();
    master.gain.value = 0;
    master.gain.setTargetAtTime(0.9, c.currentTime, 0.8);
    master.connect(c.destination);
    dry = c.createGain();
    dry.connect(master);
    const verb = c.createConvolver();
    verb.buffer = hallImpulse(c);
    wet = c.createGain();
    wet.gain.value = 0.5;
    wet.connect(verb).connect(master);
    noise = noiseBuffer(c, 3);
    for (const l of LAYERS) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(master);
      layerGain.set(l, g);
    }
    // Every layer loops from the same moment, so they stay in step.
    void Promise.all(LAYERS.map((l) => fetch(MUSIC[l]).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => null))).then((bufs) => {
      if (dead || ctx !== c) return;
      const at = c.currentTime + 0.1;
      bufs.forEach((b, i) => {
        if (!b) return;
        const s = c.createBufferSource();
        s.buffer = b;
        s.loop = true;
        s.connect(layerGain.get(LAYERS[i])!);
        s.start(at);
        sources.push(s);
      });
    });
    return c;
  }

  function teardown() {
    for (const s of sources) { try { s.stop(); } catch { /* stopped */ } }
    sources.length = 0;
    layerGain.clear();
    void ctx?.close().catch(() => undefined);
    ctx = null;
    master = dry = wet = null;
  }

  return {
    gesture() { build(); },
    setMuted(m) {
      if (m) teardown();
    },
    update({ state, playing, dt }) {
      const c = ctx;
      if (!c || !dry || !wet || !noise) { last = state; return; }
      const now = c.currentTime;
      const mix = mixFor(film, state);
      // Paused, the music sits lower under the reading.
      const level = playing ? 1 : 0.6;
      for (const l of LAYERS) layerGain.get(l)?.gain.setTargetAtTime(mix[l] * LAYER_GAIN[l] * level, now, 0.6);
      // Hits as the film plays through them (not when it jumps).
      const prev = last;
      last = state;
      if (!prev || !(dt > 0)) return;
      if (prev.kind === "hall" && state.kind === "chapter") scheduleWhoosh(c, dry, noise, now, 1);
      if (state.kind === "chapter" && prev.kind === "chapter" && prev.index === state.index) {
        const a0 = prev.anim, a1 = state.anim;
        if (a1 > a0 && a1 - a0 < 0.6) for (const h of hitsOf(film, state.index)) if (h.at > a0 && h.at <= a1) scheduleHit(c, dry, wet, noise, h.kind, now);
      }
    },
    dispose() {
      dead = true;
      teardown();
    },
  };
}

// ---------------------------------------------------------------------------
// Offline, for videos
// ---------------------------------------------------------------------------

/** The video's soundtrack: the same layers and hits, following the video's cuts, with fades at the ends. */
export async function renderVideoAudio(film: Film, plan: VideoPlan, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const Ctx = (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)!;
    const seconds = plan.seconds;
    const ctx = new Ctx(2, Math.ceil(rate * seconds), rate);
    const bufs = await Promise.all(LAYERS.map((l) => fetch(MUSIC[l], { signal }).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null)));
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(0.95, 0.5);
    master.gain.setValueAtTime(0.95, Math.max(0.5, seconds - 1.6));
    master.gain.linearRampToValueAtTime(0, seconds);
    master.connect(ctx.destination);
    const dry = ctx.createGain();
    dry.connect(master);
    const verb = ctx.createConvolver();
    verb.buffer = hallImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    wet.connect(verb).connect(master);
    const noise = noiseBuffer(ctx, 3);
    // Layer gains follow the video, sampled every 50 ms.
    bufs.forEach((b, i) => {
      if (!b) return;
      const l = LAYERS[i];
      const g = ctx.createGain();
      const step = 0.05;
      for (let t = 0; t <= seconds; t += step) {
        const f = videoAt(plan, t);
        const m = mixAt(film, f.chapter, f.anim);
        let v = m[l];
        if (f.next) v = v * (1 - f.next.k) + mixAt(film, f.next.chapter, f.next.anim)[l] * f.next.k;
        g.gain.setValueAtTime(v * LAYER_GAIN[l], t);
      }
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.connect(g).connect(master);
      // The cinematic layer starts at its build; the rest from the top.
      s.start(0, l === "epic" ? 0 : Math.min(20, b.duration * 0.1));
    });
    // Hits inside each segment, and a whoosh at each cut.
    for (let i = 0; i < plan.segments.length; i++) {
      const sg = plan.segments[i];
      for (const h of hitsOf(film, sg.chapter)) {
        if (h.at < sg.from || h.at > sg.to) continue;
        const at = sg.t0 + ((h.at - sg.from) / Math.max(1e-6, sg.to - sg.from)) * (sg.t1 - sg.t0);
        if (at > 0.1 && at < seconds - 0.3) scheduleHit(ctx, dry, wet, noise, h.kind, at, 0.9);
      }
      if (i > 0 && plan.cut > 0) scheduleWhoosh(ctx, dry, noise, Math.max(0, sg.t0 - plan.cut * 0.8), 0.9);
    }
    return await ctx.startRendering();
  } catch {
    return null;
  }
}
