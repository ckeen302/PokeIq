import { isMuted } from "@/lib/sound";
import { CHAPTERS } from "@/lib/pokemon-story/data";
import { videoAt, type Film, type FilmState, type VideoPlan } from "@/lib/world-history/timing";

/**
 * The Story's sound, built like World History's: four CC0 tracks (credited
 * in public/audio/pokemon-story/CREDITS.md) play together as layers, and
 * each chapter sets their mix: a warm piano bed throughout, a chiptune
 * sparkle that is loudest in the Game Boy years, a light rhythmic layer for
 * Pokémania, GO and the modern chapters, and an orchestral swell at each
 * chapter's big moment. On top, synthesised hits: whooshes, chimes, booms,
 * a crowd's roar, a link-cable blip, a TV click, a spawn chime and a soft
 * wind. It follows the site's sound toggle (off means no AudioContext at
 * all) and starts only from a user gesture; videos get the same mix,
 * rendered offline.
 */

export const MUSIC = {
  bed: "/audio/pokemon-story/sunrise.mp3",
  bright: "/audio/pokemon-story/happy-adventure.mp3",
  drive: "/audio/pokemon-story/happy-clappy.mp3",
  swell: "/audio/pokemon-story/a-legend-will-rise.mp3",
} as const;
type Layer = keyof typeof MUSIC;
const LAYERS: Layer[] = ["bed", "bright", "drive", "swell"];

export type Hit = "chime" | "boom" | "roar" | "blip" | "whoosh" | "rumble" | "sparkle" | "wind" | "click" | "spawn" | "coin";
export const HITS: Hit[] = ["chime", "boom", "roar", "blip", "whoosh", "rumble", "sparkle", "wind", "click", "spawn", "coin"];

/** Each chapter's mix: base levels, the windows where the swell rises (beat + offset → beat + offset, anim seconds), and its hits. */
export interface Mood {
  bed: number;
  bright: number;
  drive: number;
  swells: [string, number, string, number][];
  hits: [Hit, string, number][];
}

export const MOODS: Record<string, Mood> = {
  collector: { bed: 0.8, bright: 0.18, drive: 0, swells: [["jar", 0, "jar", 5]], hits: [["chime", "jar", 1.2], ["wind", "paved", 0.3], ["sparkle", "kept", 2.4]] },
  "game-freak": { bed: 0.55, bright: 0.6, drive: 0, swells: [["studio", 0, "studio", 5]], hits: [["coin", "arcade", 0.8], ["whoosh", "pages", 0.7], ["chime", "studio", 1.8]] },
  cable: { bed: 0.6, bright: 0.45, drive: 0, swells: [["crawl", 0.5, "pitch", 3]], hits: [["blip", "crawl", 0.9], ["blip", "trade", 0.8], ["chime", "name", 1.6]] },
  "six-years": { bed: 0.75, bright: 0.15, drive: 0, swells: [["151", 0.4, "151", 6]], hits: [["rumble", "hard", 0.3], ["chime", "pikachu", 2], ["boom", "151", 1.2], ["sparkle", "mew", 1.2]] },
  "red-green": { bed: 0.55, bright: 0.65, drive: 0.1, swells: [["three", 0.4, "mew-rumour", 1.5]], hits: [["boom", "launch", 0.4], ["chime", "three", 1.2], ["chime", "three", 2.6], ["chime", "three", 4.0], ["sparkle", "mew-rumour", 0.6], ["whoosh", "blue", 1]] },
  pokemania: { bed: 0.3, bright: 0.55, drive: 0.75, swells: [["world", 0, "catch", 3]], hits: [["whoosh", "cards", 0.4], ["click", "anime", 0.2], ["sparkle", "face", 0.6], ["roar", "company", 2.4], ["boom", "movie", 1], ["roar", "world", 1.5], ["boom", "catch", 0.1]] },
  growing: { bed: 0.55, bright: 0.2, drive: 0.55, swells: [["online", 0.5, "online", 6], ["fresh", 1, "fresh", 7]], hits: [["whoosh", "colour", 0], ["whoosh", "online", 0], ["chime", "online", 1.6], ["roar", "worlds", 1], ["whoosh", "fresh", 0], ["sparkle", "fresh", 3]] },
  together: { bed: 0.35, bright: 0.25, drive: 0.7, swells: [["same-day", 1, "fold", 5], ["alola", 1.5, "alola", 7]], hits: [["chime", "same-day", 1.4], ["chime", "fold", 1.2], ["sparkle", "outbreak", 0.8], ["chime", "twenty", 0.5], ["whoosh", "alola", 0.6]] },
  outside: { bed: 0.7, bright: 0.5, drive: 0.75, swells: [["parks", 0, "outside", 8]], hits: [["blip", "april", 0.8], ["whoosh", "launch", 0.4], ["roar", "parks", 1.4], ["spawn", "wild", 0.6], ["spawn", "wild", 1.8], ["spawn", "wild", 3.0], ["roar", "together", 1.5], ["chime", "outside", 3.2]] },
  "open-worlds": { bed: 0.35, bright: 0.2, drive: 0.75, swells: [["open", 0, "open", 6], ["champion", 0, "farewell", 1]], hits: [["whoosh", "galar", 0], ["roar", "galar", 0.8], ["whoosh", "hisui", 0], ["whoosh", "open", 0], ["boom", "champion", 1.0], ["chime", "farewell", 2.2], ["whoosh", "lumiose", 0]] },
  thirty: { bed: 0.85, bright: 0.2, drive: 0.3, swells: [["now", 1, "yours", 12]], hits: [["chime", "thirty", 1.2], ["blip", "then", 1.2], ["whoosh", "now", 0.6], ["chime", "thousand", 1.4], ["boom", "yours", 4.2], ["sparkle", "yours", 4.4]] },
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
  if (!m) return { bed: 0.7, bright: 0, drive: 0, swell: 0 };
  let epic = 0;
  for (const [a, da, b, db] of m.swells) {
    const t0 = beatAnim(film, index, a) + da, t1 = beatAnim(film, index, b) + db;
    epic = Math.max(epic, smoothstep(t0 - 1.5, t0 + 0.5, anim) * (1 - smoothstep(t1 - 0.5, t1 + 2.5, anim)));
  }
  // The swell lives inside its chapter, so the hall only ever hands one track to the next: it rises after the
  // chapter opens and is gone before it ends (the last chapter keeps it into the epilogue, for the finale).
  const end = film.chapters[index].anim;
  epic *= smoothstep(0, 1.2, anim);
  if (index < film.chapters.length - 1) epic *= 1 - smoothstep(end - 4, end - 0.5, anim);
  // One track at a time: the four tracks are separate pieces in different keys and tempos, so layering them
  // clashes. Each chapter plays its leading track alone, and its big moment crossfades into the orchestral swell.
  const lead: Exclude<Layer, "swell"> = m.drive > m.bed && m.drive >= m.bright ? "drive" : m.bright > m.bed ? "bright" : "bed";
  const out: Record<Layer, number> = { bed: 0, bright: 0, drive: 0, swell: epic };
  out[lead] = Math.max(m[lead], 0.6) * (1 - epic);
  return out;
}

/** The Archive between chapters: the piano alone. */
const HALL_MIX: Record<Layer, number> = { bed: 0.8, bright: 0, drive: 0, swell: 0 };

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

/** A warm room reverb (shorter and brighter than World History's hall). */
function hallImpulse(ctx: BaseAudioContext, seconds = 2.4): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 991 + c * 131;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const t = i / ctx.sampleRate;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.exp(-t * 2.6) * (t < 0.015 ? t / 0.015 : 1) * 0.55;
    }
  }
  return buf;
}

function tone(ctx: BaseAudioContext, dest: AudioNode[], f: number, at: number, dur: number, gain: number, type: OscillatorType = "sine", f2?: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  o.connect(g);
  dest.forEach((d) => g.connect(d));
  o.start(at);
  o.stop(at + dur + 0.05);
}

function noiseHit(ctx: BaseAudioContext, dest: AudioNode[], noise: AudioBuffer, at: number, o: { type: BiquadFilterType; f0: number; f1: number; q?: number; dur: number; gain: number; attack?: number }) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.Q.value = o.q ?? 0.9;
  f.frequency.setValueAtTime(o.f0, at);
  f.frequency.exponentialRampToValueAtTime(o.f1, at + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(o.gain, at + (o.attack ?? 0.02));
  g.gain.exponentialRampToValueAtTime(0.0008, at + o.dur);
  s.connect(f).connect(g);
  dest.forEach((d) => g.connect(d));
  s.start(at, Math.random() * 0.5);
  s.stop(at + o.dur + 0.05);
}

function scheduleHit(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, noise: AudioBuffer, kind: Hit, at: number, gain = 1) {
  const both = [dry, wet];
  switch (kind) {
    case "boom":
      tone(ctx, both, 72, at, 1.5, 0.7 * gain, "sine", 30);
      noiseHit(ctx, both, noise, at, { type: "lowpass", f0: 1500, f1: 120, dur: 1.4, gain: 0.45 * gain, attack: 0.01 });
      return;
    case "rumble":
      tone(ctx, both, 46, at, 2.4, 0.5 * gain, "sine", 30);
      noiseHit(ctx, both, noise, at, { type: "lowpass", f0: 360, f1: 110, dur: 2.4, gain: 0.3 * gain, attack: 0.5 });
      return;
    case "roar":
      // A crowd: band-passed noise swelling and falling, with a little shimmer of voices.
      noiseHit(ctx, both, noise, at, { type: "bandpass", f0: 700, f1: 1300, q: 0.6, dur: 3.2, gain: 0.38 * gain, attack: 0.6 });
      noiseHit(ctx, [wet], noise, at + 0.1, { type: "bandpass", f0: 2200, f1: 2600, q: 1.4, dur: 2.6, gain: 0.12 * gain, attack: 0.5 });
      return;
    case "whoosh":
      noiseHit(ctx, [dry, wet], noise, at, { type: "bandpass", f0: 320, f1: 2600, q: 1.1, dur: 1.2, gain: 0.22 * gain, attack: 0.55 });
      return;
    case "wind":
      noiseHit(ctx, both, noise, at, { type: "bandpass", f0: 500, f1: 260, q: 0.7, dur: 3.4, gain: 0.16 * gain, attack: 1.2 });
      return;
    case "blip":
      // The link cable: two square-wave chirps, like a Game Boy talking to another.
      tone(ctx, both, 1046.5, at, 0.09, 0.09 * gain, "square");
      tone(ctx, both, 1568, at + 0.1, 0.12, 0.08 * gain, "square");
      return;
    case "coin":
      tone(ctx, both, 987.8, at, 0.08, 0.09 * gain, "square");
      tone(ctx, both, 1318.5, at + 0.08, 0.35, 0.08 * gain, "square");
      return;
    case "click":
      noiseHit(ctx, [dry], noise, at, { type: "highpass", f0: 2500, f1: 2000, dur: 0.06, gain: 0.35 * gain, attack: 0.002 });
      tone(ctx, [dry, wet], 15700 / 4, at + 0.02, 0.5, 0.02 * gain);
      return;
    case "spawn":
      [783.99, 1174.66].forEach((f, i) => tone(ctx, [wet, dry], f, at + i * 0.09, 0.9, 0.07 * gain, "triangle"));
      return;
    case "chime":
    case "sparkle": {
      const notes = kind === "chime" ? [523.25, 659.25, 783.99, 1046.5] : [1318.5, 1567.98, 2093, 2637, 3136];
      notes.forEach((f, i) => tone(ctx, i % 2 ? [wet] : [wet, dry], f, at + i * (kind === "chime" ? 0.08 : 0.045), kind === "chime" ? 2.0 : 1.1, (kind === "chime" ? 0.075 : 0.045) * gain));
      return;
    }
  }
}

function scheduleWhoosh(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, at: number, gain = 1) {
  noiseHit(ctx, [dest], noise, at, { type: "bandpass", f0: 300, f1: 2400, q: 1.1, dur: 1.4, gain: 0.2 * gain, attack: 0.7 });
}

/** The synthesised hits sit well under the music: accents, not a second soundtrack. */
const HIT_LEVEL = 0.45;
const LAYER_GAIN: Record<Layer, number> = { bed: 0.75, bright: 0.5, drive: 0.55, swell: 0.85 };

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

export interface StoryAudio {
  /** Call from inside a pointer or key handler: starts the context if sound is on. */
  gesture(): void;
  setMuted(m: boolean): void;
  update(s: { state: FilmState; playing: boolean; dt: number }): void;
  dispose(): void;
}

export function createStoryAudio(film: Film): StoryAudio {
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
      if (prev.kind === "hall" && state.kind === "chapter") scheduleWhoosh(c, dry, noise, now, HIT_LEVEL);
      if (state.kind === "chapter" && prev.kind === "chapter" && prev.index === state.index) {
        const a0 = prev.anim, a1 = state.anim;
        if (a1 > a0 && a1 - a0 < 0.6) for (const h of hitsOf(film, state.index)) if (h.at > a0 && h.at <= a1) scheduleHit(c, dry, wet, noise, h.kind, now, HIT_LEVEL);
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
      s.start(0, 0);
    });
    // Hits inside each segment, and a whoosh at each cut.
    for (let i = 0; i < plan.segments.length; i++) {
      const sg = plan.segments[i];
      for (const h of hitsOf(film, sg.chapter)) {
        if (h.at < sg.from || h.at > sg.to) continue;
        const at = sg.t0 + ((h.at - sg.from) / Math.max(1e-6, sg.to - sg.from)) * (sg.t1 - sg.t0);
        if (at > 0.1 && at < seconds - 0.3) scheduleHit(ctx, dry, wet, noise, h.kind, at, HIT_LEVEL);
      }
      if (i > 0 && plan.cut > 0) scheduleWhoosh(ctx, dry, noise, Math.max(0, sg.t0 - plan.cut * 0.8), HIT_LEVEL);
    }
    return await ctx.startRendering();
  } catch {
    return null;
  }
}
