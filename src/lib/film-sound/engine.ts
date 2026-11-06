import { isMuted } from "@/lib/sound";
import { animToFilm, videoAt, type Film, type FilmState, type VideoPlan } from "@/lib/world-history/timing";
import * as K from "./kit";
import type { AmbienceLevels, Bus } from "./kit";

/**
 * The films' sound engine, shared by The Story of Pokémon and The History of
 * the Pokémon World. Each film supplies a score (true stems of ONE piece:
 * same key, tempo and loop length, made to play together), its per-moment
 * mix, ambience and hits. The engine:
 *
 * - loops every stem from the same instant, so they stay in step, and sets
 *   their levels from the film's mix (crossfading between chapters through
 *   the hall);
 * - locks cues to the score's grid: a riser peaks on each reveal at the
 *   nearest eighth note, and musical hits wait for the next sixteenth;
 * - drops the band away under each slow-motion moment (a low-pass sweep)
 *   and raises a held chord (a one-shot) over it;
 * - ducks the music under impacts;
 * - keeps hits on a bus well under the music and the ambience lower still;
 * - follows the site's sound toggle: while muted, no AudioContext exists.
 */

export interface FilmSound<L extends string, H extends string> {
  music: Record<L, string>;
  layers: L[];
  hold: string;
  bpm: number;
  /** Loop length (seconds) of every stem. */
  loop: number;
  layerGain: Record<L, number>;
  sfxGain: number;
  ambGain: number;
  /** Reverb: length (s), decay, brightness. */
  room: [number, number, number];
  mixFor(film: Film, s: FilmState): Record<L, number>;
  mixAt(film: Film, index: number, anim: number): Record<L, number>;
  ambienceFor(film: Film, s: FilmState): AmbienceLevels;
  ambienceAt(film: Film, index: number, anim: number): AmbienceLevels;
  dropAt(film: Film, index: number, anim: number): number;
  revealsOf(film: Film, index: number): number[];
  hitsOf(film: Film, index: number): { kind: H; at: number }[];
  playHit(b: Bus, kind: H, at: number, gain: number, r: K.Rand): void;
  musical: Set<H>;
  duck: Partial<Record<H, number>>;
  /** The 60-second cut's own arc (u = 0..1); chapter videos follow the chapter mix. */
  videoArc(u: number): Record<L, number>;
  /** Bar (from the loop start) where the video arc's full theme lands. */
  videoPeakBar: number;
}

const blend = (a: number, b: number, k: number) => Math.sqrt(Math.max(0, a * a * (1 - k) + b * b * k));

/** The drop filter's cutoff for a drop amount (log-spaced, 20 kHz → 600 Hz). */
const dropHz = (d: number, rate: number) => Math.min(rate * 0.45, 20000 * Math.pow(600 / 20000, Math.max(0, Math.min(1, d))));

function graph(c: BaseAudioContext, cfg: FilmSound<string, string>) {
  const master = c.createGain();
  master.connect(c.destination);
  // Music: layers → duck → drop filter → master.
  const duck = c.createGain();
  const drop = c.createBiquadFilter();
  drop.type = "lowpass";
  drop.frequency.value = Math.min(20000, c.sampleRate * 0.45);
  drop.Q.value = 0.5;
  duck.connect(drop).connect(master);
  // Hits and foley: dry and a room, on their own bus under the music.
  const sfx = c.createGain();
  sfx.gain.value = cfg.sfxGain;
  sfx.connect(master);
  const dry = c.createGain();
  dry.connect(sfx);
  const verb = c.createConvolver();
  verb.buffer = K.impulse(c, cfg.room[0], cfg.room[1], 991, cfg.room[2]);
  const wet = c.createGain();
  wet.gain.value = 0.55;
  wet.connect(verb).connect(sfx);
  // Ambience, lower still (its own reverb sends go through the same room).
  const amb = c.createGain();
  amb.gain.value = cfg.ambGain;
  amb.connect(master);
  const ambWet = c.createGain();
  ambWet.gain.value = cfg.ambGain / Math.max(0.01, cfg.sfxGain);
  ambWet.connect(wet);
  const noise = K.makeNoises(c);
  const bus: Bus = { ctx: c, dry, wet, noise };
  return { master, duck, drop, bus, amb, bank: new K.AmbienceBank({ ctx: c, dry: amb, wet: ambWet, noise }, amb, 77) };
}

/** Where a decoded loop's music starts (skipping an MP3 decoder's leading silence, if the browser kept it). */
function loopStart(b: AudioBuffer, loop: number): number {
  if (b.duration < loop + 0.004) return 0;
  const d = b.getChannelData(0);
  const max = Math.min(d.length, Math.floor(b.sampleRate * 0.08));
  for (let i = 0; i < max; i++) if (Math.abs(d[i]) > 1e-3) return i / b.sampleRate;
  return 0;
}

function playLoop(c: BaseAudioContext, buf: AudioBuffer, loop: number, dest: AudioNode, at: number) {
  const s = c.createBufferSource();
  s.buffer = buf;
  const off = loopStart(buf, loop);
  s.loop = true;
  s.loopStart = off;
  s.loopEnd = Math.min(buf.duration, off + loop);
  s.connect(dest);
  s.start(at, off);
  return s;
}

function playHold(c: BaseAudioContext, buf: AudioBuffer, dest: AudioNode, at: number, hold: number, gain: number) {
  const s = c.createBufferSource();
  s.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.25);
  g.gain.setValueAtTime(gain, at + hold);
  g.gain.linearRampToValueAtTime(0, at + hold + 2.4);
  s.connect(g).connect(dest);
  s.start(at);
  s.stop(at + hold + 2.6);
}

function duckAt(p: AudioParam, at: number, depth: number) {
  p.setTargetAtTime(1 - depth, at, 0.015);
  p.setTargetAtTime(1, at + 0.18, 0.45);
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

export interface FilmAudio {
  /** Call from inside a pointer or key handler: starts the context if sound is on. */
  gesture(): void;
  setMuted(m: boolean): void;
  update(s: { state: FilmState; playing: boolean; dt: number }): void;
  dispose(): void;
}

export function createFilmAudio<L extends string, H extends string>(cfg: FilmSound<L, H>, film: Film): FilmAudio {
  let ctx: AudioContext | null = null;
  let g: ReturnType<typeof graph> | null = null;
  let hold: AudioBuffer | null = null;
  const layerGain = new Map<L, GainNode>();
  const sources: AudioBufferSourceNode[] = [];
  let musicT0 = -1;
  let dead = false;
  let last: FilmState | null = null;
  const r = K.rng(2026);
  const beat = 60 / cfg.bpm;
  /** Risers scheduled ahead (silenced if the film jumps or pauses). */
  let stingers: { key: string; peak: number; gate: GainNode }[] = [];
  const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;

  function build(): AudioContext | null {
    if (dead || !Ctor || isMuted()) return null;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      return ctx;
    }
    try { ctx = new Ctor(); } catch { return null; }
    const c = ctx;
    g = graph(c, cfg as FilmSound<string, string>);
    g.master.gain.value = 0;
    g.master.gain.setTargetAtTime(0.9, c.currentTime, 0.8);
    for (const l of cfg.layers) {
      const n = c.createGain();
      n.gain.value = 0;
      n.connect(g.duck);
      layerGain.set(l, n);
    }
    const load = (u: string) => fetch(u).then((x) => x.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => null);
    // Every stem loops from the same moment, so they stay in step.
    void Promise.all(cfg.layers.map((l) => load(cfg.music[l]))).then((bufs) => {
      if (dead || ctx !== c) return;
      const at = c.currentTime + 0.1;
      musicT0 = at;
      bufs.forEach((b, i) => { if (b) sources.push(playLoop(c, b, cfg.loop, layerGain.get(cfg.layers[i])!, at)); });
    });
    void load(cfg.hold).then((b) => { if (ctx === c) hold = b; });
    return c;
  }

  function teardown() {
    for (const s of sources) { try { s.stop(); } catch { /* stopped */ } }
    sources.length = 0;
    layerGain.clear();
    stingers = [];
    void ctx?.close().catch(() => undefined);
    ctx = null;
    g = null;
    musicT0 = -1;
  }

  return {
    gesture() { build(); },
    setMuted(m) { if (m) teardown(); },
    update({ state, playing, dt }) {
      const c = ctx;
      if (!c || !g) { last = state; return; }
      const now = c.currentTime;
      const mix = cfg.mixFor(film, state);
      // Paused, the music sits lower under the reading.
      const level = playing ? 1 : 0.6;
      for (const l of cfg.layers) layerGain.get(l)?.gain.setTargetAtTime(mix[l] * cfg.layerGain[l] * level, now, 0.6);
      const amb = cfg.ambienceFor(film, state);
      g.bank.set(amb, now, 0.7);
      g.bank.tick(amb, now, now + 1.2);
      const drop = state.kind === "chapter" ? cfg.dropAt(film, state.index, state.anim) : 0;
      g.drop.frequency.setTargetAtTime(dropHz(drop * 0.9, c.sampleRate), now, drop > 0.05 ? 0.12 : 0.35);
      const prev = last;
      last = state;
      if (!prev || !(dt > 0)) return;
      const jumped = Math.abs(state.film - prev.film) > 0.6;
      if (jumped || !playing) {
        stingers = stingers.filter((s) => { if (s.peak > now) s.gate.gain.setTargetAtTime(0, now, 0.04); return false; });
      }
      const b = g.bus;
      if (prev.kind === "hall" && state.kind === "chapter" && !jumped) K.whoosh(b, now, 0.6, 1.3);
      if (state.kind !== "chapter" || prev.kind !== "chapter" || prev.index !== state.index) return;
      const a0 = prev.anim, a1 = state.anim;
      if (!(a1 > a0 && a1 - a0 < 0.6)) return;
      const ct = film.chapters[state.index];
      for (const h of cfg.hitsOf(film, state.index)) {
        if (!(h.at > a0 && h.at <= a1)) continue;
        const at = cfg.musical.has(h.kind) && musicT0 > 0 ? K.nextOnGrid(now, musicT0, beat / 4) : now;
        cfg.playHit(b, h.kind, at, 1, r);
        const d = cfg.duck[h.kind];
        if (d) duckAt(g.duck.gain, at, d);
      }
      // A slow-motion moment: the held chord rises as the band drops away.
      for (const s of ct.slow) if (s.at > a0 && s.at <= a1 && hold) playHold(c, hold, g.master, now, s.dur / s.rate, 0.7);
      // Risers that peak on the next reveal, on the nearest eighth note.
      if (playing && musicT0 > 0) {
        for (const rv of cfg.revealsOf(film, state.index)) {
          const key = `${state.index}:${rv}`;
          if (rv <= a1 || rv - a1 > 3 || stingers.some((x) => x.key === key)) continue;
          const lead = animToFilm(ct, rv) - animToFilm(ct, a1);
          const peak = K.nearestOnGrid(now + lead, musicT0, beat / 2);
          const len = Math.min(2.4, peak - now - 0.05);
          if (len < 0.8) continue;
          const gate = c.createGain();
          gate.connect(b.dry);
          K.riser({ ...b, dry: gate, wet: gate }, peak, len, 0.8);
          stingers.push({ key, peak, gate });
        }
        stingers = stingers.filter((x) => x.peak > now - 4);
      }
    },
    dispose() {
      dead = true;
      teardown();
    },
  };
}

// ---------------------------------------------------------------------------
// Offline: a video's soundtrack, or (for checking the mix) the whole film
// ---------------------------------------------------------------------------

type Ctx = typeof OfflineAudioContext;
const offlineCtor = (): Ctx => (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: Ctx }).webkitOfflineAudioContext)!;

async function loadAll<L extends string>(ctx: BaseAudioContext, cfg: FilmSound<L, string>, signal?: AbortSignal) {
  const load = (u: string) => fetch(u, { signal }).then((x) => x.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null);
  return Promise.all([Promise.all(cfg.layers.map((l) => load(cfg.music[l]))), load(cfg.hold)]);
}

/** Which parts to render (all by default): for checking the balance of music, hits and ambience separately. */
export interface Parts { music?: boolean; sfx?: boolean; amb?: boolean }

/** The video's soundtrack: the same stems, hits and ambience, following the video's cuts, with fades at the ends. */
export async function renderFilmVideo<L extends string, H extends string>(cfg: FilmSound<L, H>, film: Film, plan: VideoPlan, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const seconds = plan.seconds;
    const ctx = new (offlineCtor())(2, Math.ceil(rate * seconds), rate);
    const [bufs, hold] = await loadAll(ctx, cfg, signal);
    const g = graph(ctx, cfg as FilmSound<string, string>);
    g.master.gain.setValueAtTime(0, 0);
    g.master.gain.linearRampToValueAtTime(0.95, 0.5);
    g.master.gain.setValueAtTime(0.95, Math.max(0.5, seconds - 1.6));
    g.master.gain.linearRampToValueAtTime(0, seconds);
    const r = K.rng(60);
    const step = 0.05;
    const beat = 60 / cfg.bpm;
    const story = plan.kind === "story";
    const mixVideo = (t: number) => {
      if (story) return cfg.videoArc(t / seconds);
      const f = videoAt(plan, t);
      const m = cfg.mixAt(film, f.chapter, Math.max(0, f.anim));
      if (!f.next) return m;
      const n = cfg.mixAt(film, f.next.chapter, f.next.anim);
      const o = {} as Record<L, number>;
      for (const l of cfg.layers) o[l] = blend(m[l], n[l], f.next.k);
      return o;
    };
    bufs.forEach((b, i) => {
      if (!b) return;
      const l = cfg.layers[i];
      const lg = ctx.createGain();
      for (let t = 0; t <= seconds; t += step) lg.gain.setValueAtTime(mixVideo(t)[l] * cfg.layerGain[l], t);
      lg.connect(g.duck);
      playLoop(ctx, b, cfg.loop, lg, 0);
    });
    // Ambience follows each segment's chapter, a little lower than in the film.
    const ambAt = (t: number): AmbienceLevels => {
      const f = videoAt(plan, t);
      const a = cfg.ambienceAt(film, f.chapter, Math.max(0, f.anim));
      const o: AmbienceLevels = {};
      for (const [k, v] of Object.entries(a)) o[k as keyof AmbienceLevels] = (v ?? 0) * 0.7;
      return o;
    };
    g.bank.automate(ambAt, seconds, step);
    for (let t = 0; t < seconds; t += 1) g.bank.tick(ambAt(t + 0.5), t, Math.min(seconds, t + 1));
    for (let t = 0; t <= seconds; t += step) {
      const f = videoAt(plan, t);
      g.drop.frequency.setValueAtTime(dropHz(f.anim >= 0 ? cfg.dropAt(film, f.chapter, f.anim) * 0.9 : 0, rate), t);
    }
    const toVideo = (sg: (typeof plan.segments)[number], a: number) => sg.t0 + ((a - sg.from) / Math.max(1e-6, sg.to - sg.from)) * (sg.t1 - sg.t0);
    for (let i = 0; i < plan.segments.length; i++) {
      const sg = plan.segments[i];
      for (const h of cfg.hitsOf(film, sg.chapter)) {
        if (h.at < sg.from || h.at > sg.to) continue;
        let at = toVideo(sg, h.at);
        if (cfg.musical.has(h.kind)) at = K.nextOnGrid(at, 0, beat / 4);
        if (at > 0.1 && at < seconds - 0.3) {
          cfg.playHit(g.bus, h.kind, at, 0.85, r);
          const d = cfg.duck[h.kind];
          if (d) duckAt(g.duck.gain, at, d);
        }
      }
      for (const s of film.chapters[sg.chapter].slow) {
        if (s.at < sg.from || s.at > sg.to || !hold) continue;
        const at = toVideo(sg, s.at);
        if (at > 0.1 && at < seconds - 1) playHold(ctx, hold, g.master, at, Math.max(0.5, sg.t1 - at - 0.6), 0.5);
      }
      if (i > 0 && plan.cut > 0) K.whoosh(g.bus, Math.max(0, sg.t0 - plan.cut * 0.8), 0.5, 0.9);
    }
    // The full theme's return lands with a riser (the 60-second cut), on the bar.
    if (story && cfg.videoPeakBar * 4 * beat < seconds - 2) K.riser(g.bus, cfg.videoPeakBar * 4 * beat, 2.4, 0.8);
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

/**
 * The whole film as one Play-through, offline (for checking the mix, never
 * shipped to a viewer as a file): the same graph and timing as the live mix,
 * from `from` to `to` film seconds.
 */
export async function renderFilmPass<L extends string, H extends string>(cfg: FilmSound<L, H>, film: Film, filmAtFn: (f: Film, t: number) => FilmState, from: number, to: number, rate = 32000, parts: Parts = {}): Promise<AudioBuffer> {
  const on = { music: parts.music ?? true, sfx: parts.sfx ?? true, amb: parts.amb ?? true };
  const seconds = to - from;
  const ctx = new (offlineCtor())(2, Math.ceil(rate * seconds), rate);
  const [bufs, hold] = await loadAll(ctx, cfg);
  const g = graph(ctx, cfg as FilmSound<string, string>);
  // Parts left out play into unconnected nodes.
  const hitBus: Bus = on.sfx ? g.bus : { ...g.bus, dry: ctx.createGain(), wet: ctx.createGain() };
  if (!on.amb) g.amb.disconnect();
  const step = 0.05;
  const beat = 60 / cfg.bpm;
  const r = K.rng(2026);
  const st = (t: number) => filmAtFn(film, from + t);
  if (on.music) {
    bufs.forEach((b, i) => {
      if (!b) return;
      const l = cfg.layers[i];
      const lg = ctx.createGain();
      for (let t = 0; t <= seconds; t += step) lg.gain.setValueAtTime(cfg.mixFor(film, st(t))[l] * cfg.layerGain[l], t);
      lg.connect(g.duck);
      playLoop(ctx, b, cfg.loop, lg, 0);
    });
  }
  const ambAt = (t: number) => cfg.ambienceFor(film, st(t));
  g.bank.automate(ambAt, seconds, step);
  for (let t = 0; t < seconds; t += 1) g.bank.tick(ambAt(t + 0.5), t, Math.min(seconds, t + 1));
  let prev = st(0);
  for (let t = step; t <= seconds; t += step) {
    const s = st(t);
    g.drop.frequency.setValueAtTime(dropHz(s.kind === "chapter" ? cfg.dropAt(film, s.index, s.anim) * 0.9 : 0, rate), t);
    if (prev.kind === "hall" && s.kind === "chapter") K.whoosh(hitBus, t, 0.6, 1.3);
    if (s.kind === "chapter" && prev.kind === "chapter" && prev.index === s.index) {
      for (const h of cfg.hitsOf(film, s.index)) {
        if (!(h.at > prev.anim && h.at <= s.anim)) continue;
        const at = cfg.musical.has(h.kind) ? K.nextOnGrid(t, 0, beat / 4) : t;
        cfg.playHit(hitBus, h.kind, at, 1, r);
        const d = cfg.duck[h.kind];
        if (d) duckAt(g.duck.gain, at, d);
      }
      const ct = film.chapters[s.index];
      for (const w of ct.slow) if (w.at > prev.anim && w.at <= s.anim && hold && on.music) playHold(ctx, hold, g.master, t, w.dur / w.rate, 0.7);
      for (const rv of cfg.revealsOf(film, s.index)) {
        // Scheduled 2.4 s ahead, exactly as live.
        const lead = animToFilm(ct, rv) - animToFilm(ct, s.anim);
        const leadPrev = animToFilm(ct, rv) - animToFilm(ct, prev.anim);
        if (leadPrev > 3 && lead <= 3 && lead > 0.8) {
          const peak = K.nearestOnGrid(t + lead, 0, beat / 2);
          K.riser(hitBus, peak, Math.min(2.4, peak - t - 0.05), 0.8);
        }
      }
    }
    prev = s;
  }
  return ctx.startRendering();
}
