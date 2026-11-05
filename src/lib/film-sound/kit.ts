/**
 * Sound design shared by the two films (The Story of Pokémon and The History
 * of the Pokémon World): everything here is synthesised in the browser, so
 * it costs no download and carries no licence. It works in a live
 * AudioContext and in an OfflineAudioContext (the videos), from the same
 * calls.
 *
 * - Hits: a layered impact (transient, body, sub-drop and a shimmer tail),
 *   chimes and sparkles, whooshes, a crowd's roar, thunder.
 * - Foley: paper, a page turn, a pen, a cartridge click, a link-cable plug,
 *   footsteps, a card flick, a TV switching on.
 * - Risers: a reversed-cymbal swell that peaks on a given moment.
 * - Ambience: layered beds per place (a field with wind, grass and birds,
 *   crickets at dusk, a room, an arcade, a cinema, a crowd, a stadium, rain,
 *   the sea, a city, space, a cave, underwater, fire, a hall), each a
 *   continuous texture plus scheduled events, at a level set per moment.
 */

export type Rand = () => number;

/** A small seeded random generator (the same events live and in a video). */
export function rng(seed: number): Rand {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Bus {
  ctx: BaseAudioContext;
  /** Dry and reverb sends. */
  dry: AudioNode;
  wet: AudioNode;
  noise: Noises;
}

export interface Noises {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

export function makeNoises(ctx: BaseAudioContext, seconds = 4): Noises {
  const n = Math.ceil(ctx.sampleRate * seconds);
  const mk = () => ctx.createBuffer(1, n, ctx.sampleRate);
  const white = mk(), pink = mk(), brown = mk();
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  const r = rng(4321);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    w[i] = x;
    // Paul Kellet's pink filter.
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + x * 0.5362) * 0.11;
    br = (br + 0.02 * x) / 1.02;
    b[i] = br * 3.5;
  }
  // Crossfade the ends so the loops are seamless.
  const f = Math.floor(ctx.sampleRate * 0.05);
  for (const d of [w, p, b]) for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
  return { white, pink, brown };
}

/** A reverb impulse: decaying stereo noise (decay is per second; bigger = shorter). */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number, seed = 991, bright = 1): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rng(seed + c * 131);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      const x = (r() * 2 - 1) * Math.exp(-t * decay) * (t < 0.012 ? t / 0.012 : 1);
      // Darker as it decays, like air absorbing the highs.
      const a = Math.min(1, bright * Math.exp(-t * 1.2));
      lp = lp + a * (x - lp);
      d[i] = lp * 0.6;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function env(g: GainNode, at: number, peak: number, attack: number, dur: number) {
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0006, at + Math.max(attack + 0.01, dur));
}

function out(b: Bus, node: AudioNode, wet = 0.5, pan = 0) {
  let last: AudioNode = node;
  if (pan && "createStereoPanner" in b.ctx) {
    const p = b.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    last = p;
  }
  last.connect(b.dry);
  if (wet > 0) {
    const s = b.ctx.createGain();
    s.gain.value = wet;
    last.connect(s).connect(b.wet);
  }
}

export function tone(b: Bus, f: number, at: number, dur: number, gain: number, o: { type?: OscillatorType; f2?: number; attack?: number; wet?: number; pan?: number } = {}) {
  const c = b.ctx;
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(f, at);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, at + dur);
  const g = c.createGain();
  env(g, at, gain, o.attack ?? 0.008, dur);
  osc.connect(g);
  out(b, g, o.wet ?? 0.5, o.pan ?? 0);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

export interface NoiseShape { color?: keyof Noises; type: BiquadFilterType; f0: number; f1?: number; q?: number; dur: number; gain: number; attack?: number; wet?: number; pan?: number; offset?: number; curve?: "exp" | "lin" }

export function noise(b: Bus, at: number, o: NoiseShape) {
  const c = b.ctx;
  const s = c.createBufferSource();
  s.buffer = b.noise[o.color ?? "white"];
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = o.type;
  f.Q.value = o.q ?? 0.8;
  f.frequency.setValueAtTime(o.f0, at);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, at + o.dur);
  const g = c.createGain();
  env(g, at, o.gain, o.attack ?? 0.01, o.dur);
  s.connect(f).connect(g);
  out(b, g, o.wet ?? 0.5, o.pan ?? 0);
  s.start(at, o.offset ?? 0);
  s.stop(at + o.dur + 0.05);
}

// ---------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------

/**
 * A cinematic impact in layers: a sharp transient, a punchy body, a sub that
 * drops away, and a shimmer tail that rings in the reverb. `weight` 0..1
 * scales the low end (a soft landing to a world-ending boom).
 */
export function impact(b: Bus, at: number, gain = 1, weight = 1, shimmer = 1) {
  // Transient: a bright crack and a short knock.
  noise(b, at, { type: "highpass", f0: 2400, dur: 0.06, gain: 0.5 * gain, attack: 0.001, wet: 0.2 });
  tone(b, 160, at, 0.16, 0.5 * gain, { f2: 70, attack: 0.002, wet: 0.2 });
  // Body: a low noise burst that closes down.
  noise(b, at, { color: "pink", type: "lowpass", f0: 1800, f1: 140, dur: 1.3, gain: 0.55 * gain * (0.6 + 0.4 * weight), attack: 0.004, wet: 0.45 });
  // Sub-drop.
  tone(b, 62, at, 1.9 * (0.6 + 0.4 * weight), 0.85 * gain * weight, { f2: 24, attack: 0.006, wet: 0.15 });
  tone(b, 41, at + 0.02, 2.2 * weight + 0.3, 0.4 * gain * weight, { f2: 22, attack: 0.03, wet: 0.1 });
  // Shimmer: inharmonic bell partials and a sizzle, mostly in the reverb.
  if (shimmer > 0) {
    [1567.98, 2349.3, 3135.96, 4186].forEach((f, i) => tone(b, f * (1 + i * 0.003), at + 0.03 + i * 0.02, 2.4 - i * 0.3, 0.035 * gain * shimmer, { wet: 0.9, pan: (i % 2 ? 1 : -1) * 0.4 }));
    noise(b, at + 0.02, { type: "highpass", f0: 6000, dur: 1.8, gain: 0.06 * gain * shimmer, attack: 0.05, wet: 0.9 });
  }
}

export function rumble(b: Bus, at: number, gain = 1) {
  tone(b, 44, at, 2.8, 0.55 * gain, { f2: 26, attack: 0.5, wet: 0.2 });
  noise(b, at, { color: "brown", type: "lowpass", f0: 420, f1: 110, dur: 2.8, gain: 0.5 * gain, attack: 0.6, wet: 0.4 });
}

export function thunder(b: Bus, at: number, gain = 1, r: Rand = Math.random) {
  noise(b, at, { type: "highpass", f0: 1800, dur: 0.18, gain: 0.35 * gain, attack: 0.002, wet: 0.5, pan: r() - 0.5 });
  noise(b, at + 0.04, { color: "brown", type: "lowpass", f0: 900, f1: 90, dur: 4.2, gain: 0.85 * gain, attack: 0.05, wet: 0.7 });
  for (let i = 0; i < 4; i++) noise(b, at + 0.3 + i * (0.35 + r() * 0.4), { color: "brown", type: "lowpass", f0: 500, f1: 120, dur: 1.4, gain: 0.35 * gain * (1 - i * 0.2), attack: 0.08, wet: 0.8 });
  tone(b, 50, at + 0.05, 3, 0.4 * gain, { f2: 25, attack: 0.1, wet: 0.2 });
}

export function chime(b: Bus, at: number, gain = 1, root = 523.25) {
  [1, 1.25, 1.5, 2].forEach((m, i) => tone(b, root * m, at + i * 0.07, 2.2, 0.07 * gain, { type: i ? "sine" : "triangle", wet: i % 2 ? 0.95 : 0.6, pan: (i - 1.5) * 0.25 }));
  tone(b, root * 4, at + 0.28, 1.6, 0.025 * gain, { wet: 1 });
}

export function sparkle(b: Bus, at: number, gain = 1, r: Rand = Math.random) {
  const notes = [1318.5, 1567.98, 2093, 2637, 3136, 3520];
  notes.forEach((f, i) => tone(b, f, at + i * 0.045 + r() * 0.01, 1.2, 0.04 * gain, { wet: 0.9, pan: r() * 1.4 - 0.7 }));
  noise(b, at, { type: "highpass", f0: 7000, dur: 0.9, gain: 0.03 * gain, attack: 0.1, wet: 1 });
}

export function whoosh(b: Bus, at: number, gain = 1, dur = 1.2) {
  noise(b, at, { color: "pink", type: "bandpass", f0: 260, f1: 2600, q: 1.2, dur, gain: 0.35 * gain, attack: dur * 0.55, wet: 0.35, pan: -0.4 });
  noise(b, at + dur * 0.1, { type: "bandpass", f0: 900, f1: 5200, q: 2, dur: dur * 0.9, gain: 0.08 * gain, attack: dur * 0.5, wet: 0.5, pan: 0.4 });
}

export function roar(b: Bus, at: number, gain = 1, dur = 3.4) {
  noise(b, at, { color: "pink", type: "bandpass", f0: 650, f1: 1100, q: 0.6, dur, gain: 0.5 * gain, attack: dur * 0.2, wet: 0.6, pan: -0.3 });
  noise(b, at + 0.08, { color: "pink", type: "bandpass", f0: 900, f1: 1500, q: 0.7, dur: dur * 0.95, gain: 0.4 * gain, attack: dur * 0.22, wet: 0.6, pan: 0.3 });
  noise(b, at + 0.1, { type: "bandpass", f0: 2400, f1: 2800, q: 1.4, dur: dur * 0.8, gain: 0.12 * gain, attack: dur * 0.2, wet: 0.9 });
  // A few claps in the roar.
  for (let i = 0; i < 18; i++) noise(b, at + 0.3 + i * 0.13 + Math.sin(i * 7.1) * 0.05, { type: "bandpass", f0: 1400 + (i % 5) * 300, q: 1.5, dur: 0.06, gain: 0.08 * gain, attack: 0.001, wet: 0.6, pan: Math.sin(i * 3.3) * 0.7 });
}

/** Wind gust (a one-shot, over the ambience). */
export function gust(b: Bus, at: number, gain = 1) {
  noise(b, at, { color: "pink", type: "bandpass", f0: 380, f1: 240, q: 0.6, dur: 3.6, gain: 0.3 * gain, attack: 1.4, wet: 0.4 });
  noise(b, at + 0.3, { type: "bandpass", f0: 2600, f1: 1800, q: 0.9, dur: 3, gain: 0.05 * gain, attack: 1.2, wet: 0.4 });
}

/**
 * A riser that peaks at `peak`: a reversed cymbal (high noise swelling),
 * a filtered noise sweep and a soft rising tone, then a cymbal bloom.
 */
export function riser(b: Bus, peak: number, len: number, gain = 1) {
  const c = b.ctx;
  const at = peak - len;
  const mk = (color: keyof Noises, type: BiquadFilterType, f0: number, f1: number, q: number, g0: number) => {
    const s = c.createBufferSource();
    s.buffer = b.noise[color];
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, peak);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(g0 * gain, peak - 0.02);
    g.gain.linearRampToValueAtTime(0, peak + 0.03);
    s.connect(f).connect(g);
    out(b, g, 0.6);
    s.start(at);
    s.stop(peak + 0.1);
  };
  mk("white", "highpass", 3000, 9000, 0.7, 0.16);
  mk("pink", "bandpass", 400, 3800, 1.4, 0.12);
  // The bloom: a crash with a long decay, and a low swell under it.
  noise(b, peak, { type: "highpass", f0: 4200, f1: 2600, dur: 2.6, gain: 0.09 * gain, attack: 0.004, wet: 0.8 });
  tone(b, 73.42, peak, 1.6, 0.22 * gain, { f2: 70, attack: 0.01, wet: 0.4 });
}

// ---------------------------------------------------------------------------
// Foley
// ---------------------------------------------------------------------------

export function paper(b: Bus, at: number, gain = 1, r: Rand = Math.random, dur = 0.55) {
  const n = Math.round(dur * 26);
  for (let i = 0; i < n; i++) {
    const t = at + r() * dur;
    noise(b, t, { type: "bandpass", f0: 2200 + r() * 4500, q: 1.2 + r() * 2, dur: 0.012 + r() * 0.03, gain: (0.06 + r() * 0.08) * gain, attack: 0.002, wet: 0.25, pan: r() * 0.6 - 0.3, offset: r() * 3 });
  }
}

export function page(b: Bus, at: number, gain = 1) {
  noise(b, at, { color: "pink", type: "bandpass", f0: 900, f1: 3200, q: 0.9, dur: 0.28, gain: 0.22 * gain, attack: 0.12, wet: 0.25 });
  noise(b, at + 0.24, { type: "highpass", f0: 1800, dur: 0.05, gain: 0.12 * gain, attack: 0.002, wet: 0.2 });
}

export function pen(b: Bus, at: number, gain = 1, r: Rand = Math.random, dur = 0.9) {
  for (let i = 0; i < 9; i++) {
    const t = at + (i / 9) * dur + r() * 0.03;
    noise(b, t, { type: "bandpass", f0: 3200 + r() * 1800, q: 3, dur: 0.06 + r() * 0.08, gain: 0.045 * gain, attack: 0.01, wet: 0.15 });
  }
}

/** A cartridge seating in its slot: a plastic slide, a click and a thunk. */
export function cartridge(b: Bus, at: number, gain = 1) {
  noise(b, at, { type: "bandpass", f0: 1600, f1: 900, q: 1.5, dur: 0.12, gain: 0.08 * gain, attack: 0.05, wet: 0.15 });
  noise(b, at + 0.13, { type: "highpass", f0: 3000, dur: 0.025, gain: 0.3 * gain, attack: 0.001, wet: 0.2 });
  tone(b, 220, at + 0.13, 0.09, 0.25 * gain, { f2: 120, attack: 0.002, wet: 0.15 });
  noise(b, at + 0.17, { type: "bandpass", f0: 2600, q: 2, dur: 0.02, gain: 0.18 * gain, attack: 0.001, wet: 0.2 });
}

/** A link-cable plug going in, then the two consoles talking (blips). */
export function cable(b: Bus, at: number, gain = 1) {
  noise(b, at, { type: "highpass", f0: 2500, dur: 0.03, gain: 0.22 * gain, attack: 0.001, wet: 0.2 });
  tone(b, 300, at, 0.06, 0.15 * gain, { f2: 180, attack: 0.002, wet: 0.1 });
  noise(b, at + 0.05, { type: "bandpass", f0: 4000, q: 4, dur: 0.08, gain: 0.05 * gain, attack: 0.004, wet: 0.2 });
  blip(b, at + 0.22, gain);
}

export function blip(b: Bus, at: number, gain = 1) {
  tone(b, 1046.5, at, 0.08, 0.08 * gain, { type: "square", wet: 0.3 });
  tone(b, 1568, at + 0.09, 0.11, 0.07 * gain, { type: "square", wet: 0.35 });
  tone(b, 2093, at + 0.2, 0.08, 0.04 * gain, { type: "square", wet: 0.4 });
}

export function coin(b: Bus, at: number, gain = 1) {
  tone(b, 987.8, at, 0.08, 0.08 * gain, { type: "square", wet: 0.3 });
  tone(b, 1318.5, at + 0.08, 0.4, 0.07 * gain, { type: "square", wet: 0.4 });
}

export function footsteps(b: Bus, at: number, count: number, every: number, gain = 1, r: Rand = Math.random, pan = 0) {
  for (let i = 0; i < count; i++) {
    const t = at + i * every + r() * 0.03;
    const g = gain * (0.8 + r() * 0.3);
    tone(b, 90 + r() * 20, t, 0.09, 0.22 * g, { f2: 55, attack: 0.002, wet: 0.3, pan });
    noise(b, t, { color: "pink", type: "lowpass", f0: 900, dur: 0.08, gain: 0.16 * g, attack: 0.002, wet: 0.35, pan });
    noise(b, t + 0.03, { type: "bandpass", f0: 3500 + r() * 1500, q: 2, dur: 0.05, gain: 0.03 * g, attack: 0.004, wet: 0.3, pan });
  }
}

export function card(b: Bus, at: number, gain = 1) {
  noise(b, at, { type: "highpass", f0: 3500, dur: 0.04, gain: 0.16 * gain, attack: 0.001, wet: 0.3 });
  noise(b, at + 0.01, { type: "bandpass", f0: 1400, f1: 3800, q: 1, dur: 0.16, gain: 0.08 * gain, attack: 0.05, wet: 0.35 });
}

/** An old TV switching on: a relay click, a thump and the rising whine. */
export function tv(b: Bus, at: number, gain = 1) {
  noise(b, at, { type: "highpass", f0: 2500, dur: 0.05, gain: 0.3 * gain, attack: 0.002, wet: 0.2 });
  tone(b, 70, at + 0.02, 0.25, 0.25 * gain, { attack: 0.004, wet: 0.2 });
  tone(b, 3900, at + 0.05, 0.9, 0.012 * gain, { f2: 7800, attack: 0.3, wet: 0.3 });
  noise(b, at + 0.04, { type: "bandpass", f0: 5000, q: 1, dur: 0.6, gain: 0.05 * gain, attack: 0.05, wet: 0.4 });
}

export function spawn(b: Bus, at: number, gain = 1) {
  [783.99, 1174.66, 1567.98].forEach((f, i) => tone(b, f, at + i * 0.08, 0.9, 0.07 * gain, { type: "triangle", wet: 0.7, pan: (i - 1) * 0.3 }));
  noise(b, at, { type: "bandpass", f0: 1200, f1: 6000, q: 2, dur: 0.4, gain: 0.04 * gain, attack: 0.2, wet: 0.7 });
}

// ---------------------------------------------------------------------------
// Ambience
// ---------------------------------------------------------------------------

export type Ambience =
  | "field" | "crickets" | "room" | "arcade" | "cinema" | "crowd" | "stadium" | "rain" | "storm"
  | "sea" | "city" | "space" | "cave" | "underwater" | "fire" | "hall" | "wind" | "forest" | "snow";

export const AMBIENCES: Ambience[] = ["field", "crickets", "room", "arcade", "cinema", "crowd", "stadium", "rain", "storm", "sea", "city", "space", "cave", "underwater", "fire", "hall", "wind", "forest", "snow"];

export type AmbienceLevels = Partial<Record<Ambience, number>>;

interface Layer {
  gain: GainNode;
  /** Unconnected: event reverb sends land here (each bed has its own send after its level). */
  sink: GainNode;
  /** Scheduled events up to this context time. */
  until: number;
  r: Rand;
}

function loopNoise(c: BaseAudioContext, buf: AudioBuffer, offset: number): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(c.currentTime, offset % buf.duration);
  return s;
}

function filt(c: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const n = c.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  return n;
}

/** A slow LFO on an AudioParam (value ± depth at `hz`). */
function lfo(c: BaseAudioContext, param: AudioParam, base: number, depth: number, hz: number, phase = 0) {
  param.value = base;
  const o = c.createOscillator();
  o.frequency.value = hz;
  const g = c.createGain();
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start(c.currentTime + phase / Math.max(0.01, hz));
  return o;
}

/** A texture of short decaying grains (rain drops, fire crackles, a projector), baked once. */
function grains(c: BaseAudioContext, seconds: number, perSec: number, seed: number, o: { f0: number; f1: number; decay: number; amp: number; low?: number; tick?: number }): AudioBuffer {
  const n = Math.ceil(c.sampleRate * seconds);
  const buf = c.createBuffer(2, n, c.sampleRate);
  const r = rng(seed);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const count = Math.round(seconds * perSec);
    for (let k = 0; k < count; k++) {
      const start = o.tick ? Math.floor((k / count) * n + r() * 20) : Math.floor(r() * n);
      const f = o.f0 + (o.f1 - o.f0) * r();
      const len = Math.floor(c.sampleRate * o.decay * (0.5 + r()));
      const a = o.amp * (0.3 + r() * 0.7);
      const w = (2 * Math.PI * f) / c.sampleRate;
      for (let i = 0; i < len; i++) {
        const j = (start + i) % n;
        d[j] += Math.sin(w * i) * a * Math.exp((-6 * i) / len) * (r() * 0.6 + 0.4);
      }
    }
    if (o.low) {
      let lp = 0;
      const r2 = rng(seed + 9 + ch);
      for (let i = 0; i < n; i++) { lp += 0.02 * ((r2() * 2 - 1) - lp); d[i] += lp * o.low; }
    }
  }
  return buf;
}

/**
 * A bank of ambience beds, mixed by level. Each bed is built the first time
 * its level rises above zero; `set` moves the levels and `tick` schedules
 * each audible bed's events a little ahead (or across a whole video,
 * offline).
 */
export class AmbienceBank {
  private layers = new Map<Ambience, Layer>();
  private textures = new Map<string, AudioBuffer>();
  constructor(private b: Bus, private outNode: AudioNode, private seed = 77) {}

  private texture(key: string, make: () => AudioBuffer) {
    let t = this.textures.get(key);
    if (!t) { t = make(); this.textures.set(key, t); }
    return t;
  }

  private layer(kind: Ambience): Layer {
    let l = this.layers.get(kind);
    if (l) return l;
    const c = this.b.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(this.outNode);
    // Every bed sits in the room a little: a reverb send after its level.
    const send = c.createGain();
    send.gain.value = kind === "hall" || kind === "cave" || kind === "space" ? 0.6 : 0.3;
    g.connect(send).connect(this.b.wet);
    const N = this.b.noise;
    const r = rng(this.seed + AMBIENCES.indexOf(kind) * 1013);
    const bed = (buf: AudioBuffer, chain: AudioNode[], level: number, mod?: (gn: GainNode) => void) => {
      const s = loopNoise(c, buf, r() * 3);
      const lg = c.createGain();
      lg.gain.value = level;
      let last: AudioNode = s;
      for (const n of chain) { last.connect(n); last = n; }
      last.connect(lg).connect(g);
      mod?.(lg);
    };
    switch (kind) {
      case "field":
      case "wind":
      case "forest":
      case "snow": {
        const bp = filt(c, "bandpass", 420, 0.5);
        lfo(c, bp.frequency, kind === "snow" ? 700 : 420, kind === "snow" ? 300 : 200, 0.07, r());
        bed(N.pink, [bp], kind === "wind" || kind === "snow" ? 0.5 : 0.28, (lg) => lfo(c, lg.gain, kind === "wind" ? 0.45 : 0.25, 0.15, 0.11, r()));
        // Grass and leaves: a high rustle that breathes with the wind.
        const hp = filt(c, "bandpass", kind === "forest" ? 2400 : 3400, 0.6);
        bed(N.white, [hp], kind === "snow" ? 0.01 : 0.05, (lg) => lfo(c, lg.gain, kind === "snow" ? 0.01 : 0.045, 0.035, 0.23, r()));
        break;
      }
      case "crickets": {
        const bp = filt(c, "lowpass", 300, 0.5);
        bed(N.pink, [bp], 0.1);
        break;
      }
      case "room":
      case "hall":
      case "arcade":
      case "cinema": {
        // Room tone: low air and a faint hiss.
        bed(N.brown, [filt(c, "lowpass", kind === "hall" ? 240 : 170, 0.5)], kind === "hall" ? 0.5 : 0.35);
        bed(N.pink, [filt(c, "highpass", 2500, 0.5)], 0.012);
        if (kind === "arcade") {
          // Mains hum and the cabinets' fans.
          for (const [f, a] of [[120, 0.012], [180, 0.006], [240, 0.003]] as const) {
            const o = c.createOscillator();
            o.frequency.value = f;
            const og = c.createGain();
            og.gain.value = a;
            o.connect(og).connect(g);
            o.start();
          }
          bed(N.pink, [filt(c, "bandpass", 600, 0.8)], 0.08);
        }
        if (kind === "cinema") {
          const proj = this.texture("proj", () => grains(c, 2, 24, 31, { f0: 1800, f1: 2600, decay: 0.006, amp: 0.25, tick: 1 }));
          bed(proj, [filt(c, "bandpass", 2200, 0.7)], 0.25);
        }
        break;
      }
      case "crowd":
      case "stadium": {
        const a = filt(c, "bandpass", 550, 0.7), b2 = filt(c, "bandpass", 1600, 1.3);
        lfo(c, a.frequency, 550, 120, 0.9, r());
        lfo(c, b2.frequency, 1600, 350, 1.7, r());
        bed(N.pink, [a], kind === "stadium" ? 0.3 : 0.25, (lg) => lfo(c, lg.gain, kind === "stadium" ? 0.3 : 0.25, 0.07, 0.31, r()));
        bed(N.pink, [b2], kind === "stadium" ? 0.2 : 0.14, (lg) => lfo(c, lg.gain, kind === "stadium" ? 0.2 : 0.14, 0.06, 0.53, r()));
        if (kind === "stadium") bed(N.brown, [filt(c, "lowpass", 200, 0.5)], 0.25);
        break;
      }
      case "rain":
      case "storm": {
        const drops = this.texture("rain", () => grains(c, 3, 900, 41, { f0: 2200, f1: 7000, decay: 0.004, amp: 0.12, low: 0.4 }));
        bed(drops, [filt(c, "highpass", 600, 0.5)], kind === "storm" ? 0.55 : 0.35);
        bed(N.pink, [filt(c, "highpass", 1500, 0.4), filt(c, "lowpass", 9000, 0.4)], kind === "storm" ? 0.16 : 0.09);
        bed(N.brown, [filt(c, "lowpass", 350, 0.5)], kind === "storm" ? 0.5 : 0.2);
        break;
      }
      case "sea": {
        const lp = filt(c, "lowpass", 700, 0.4);
        lfo(c, lp.frequency, 800, 500, 0.085, r());
        bed(N.pink, [lp], 0.45, (lg) => lfo(c, lg.gain, 0.4, 0.25, 0.085, r()));
        bed(N.white, [filt(c, "highpass", 3500, 0.4)], 0.02, (lg) => lfo(c, lg.gain, 0.02, 0.018, 0.085, r()));
        break;
      }
      case "city": {
        bed(N.brown, [filt(c, "lowpass", 220, 0.5)], 0.32);
        const bp = filt(c, "bandpass", 700, 0.5);
        lfo(c, bp.frequency, 700, 200, 0.05, r());
        bed(N.pink, [bp], 0.1, (lg) => lfo(c, lg.gain, 0.1, 0.05, 0.13, r()));
        break;
      }
      case "space": {
        for (const [f, a] of [[55, 0.05], [55.35, 0.05], [82.4, 0.02], [110.2, 0.012]] as const) {
          const o = c.createOscillator();
          o.frequency.value = f;
          const og = c.createGain();
          og.gain.value = a;
          lfo(c, og.gain, a, a * 0.6, 0.05 + f * 0.0007, r());
          o.connect(og).connect(g);
          o.start();
        }
        bed(N.pink, [filt(c, "lowpass", 260, 0.6)], 0.12);
        break;
      }
      case "cave": {
        bed(N.brown, [filt(c, "lowpass", 260, 0.5)], 0.5);
        bed(N.pink, [filt(c, "bandpass", 300, 2)], 0.05, (lg) => lfo(c, lg.gain, 0.05, 0.04, 0.07, r()));
        break;
      }
      case "underwater": {
        const lp = filt(c, "lowpass", 380, 0.8);
        lfo(c, lp.frequency, 380, 140, 0.12, r());
        bed(N.brown, [lp], 0.7);
        break;
      }
      case "fire": {
        const crackle = this.texture("fire", () => grains(c, 3, 140, 53, { f0: 900, f1: 4200, decay: 0.008, amp: 0.3, low: 0.6 }));
        bed(crackle, [filt(c, "highpass", 200, 0.5)], 0.35);
        bed(N.brown, [filt(c, "lowpass", 300, 0.5)], 0.35, (lg) => lfo(c, lg.gain, 0.35, 0.15, 0.4, r()));
        break;
      }
    }
    l = { gain: g, sink: c.createGain(), until: 0, r };
    this.layers.set(kind, l);
    return l;
  }

  /** Move every bed toward its level (others to silence). */
  set(levels: AmbienceLevels, at: number, tc = 0.8) {
    for (const k of AMBIENCES) {
      const v = levels[k] ?? 0;
      if (v <= 0.001 && !this.layers.has(k)) continue;
      this.layer(k).gain.gain.setTargetAtTime(v, at, tc);
    }
  }

  /** Offline: one level curve per bed, sampled. */
  automate(at: (t: number) => AmbienceLevels, seconds: number, step = 0.05) {
    const used = new Set<Ambience>();
    for (let t = 0; t <= seconds; t += step * 4) for (const [k, v] of Object.entries(at(t))) if ((v ?? 0) > 0.001) used.add(k as Ambience);
    for (const k of used) {
      const g = this.layer(k).gain.gain;
      for (let t = 0; t <= seconds; t += step) g.setValueAtTime(at(t)[k] ?? 0, t);
    }
    return used;
  }

  /** Schedule events (birds, crickets, waves, horns, cheers, drips, bubbles) for audible beds from `from` to `to` (context time). */
  tick(levels: AmbienceLevels, from: number, to: number) {
    for (const [k, v] of Object.entries(levels) as [Ambience, number][]) {
      if (!(v > 0.02)) continue;
      const l = this.layer(k);
      const start = Math.max(from, l.until);
      if (to <= start) continue;
      this.events(k, l, start, to);
      l.until = to;
    }
  }

  private events(kind: Ambience, l: Layer, from: number, to: number) {
    const b: Bus = { ...this.b, dry: l.gain, wet: l.sink };
    const wetBus = b;
    const r = l.r;
    const every = (mean: number, fn: (t: number) => void) => {
      let t = from + r() * mean;
      while (t < to) { fn(t); t += mean * (0.5 + r()); }
    };
    switch (kind) {
      case "field":
      case "forest":
        every(kind === "forest" ? 1.6 : 2.6, (t) => bird(wetBus, t, r));
        break;
      case "crickets":
        for (let k = 0; k < 3; k++) {
          const pan = (k - 1) * 0.6, f = 4300 + k * 260;
          every(0.9 + k * 0.2, (t) => { for (let i = 0; i < 3; i++) tone(b, f, t + i * 0.05, 0.03, 0.04, { attack: 0.004, wet: 0, pan }); });
        }
        break;
      case "arcade":
        every(1.1, (t) => {
          const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
          const n = 2 + Math.floor(r() * 4);
          for (let i = 0; i < n; i++) tone(wetBus, notes[Math.floor(r() * notes.length)] * (r() < 0.3 ? 0.5 : 1), t + i * 0.09, 0.07, 0.012, { type: "square", wet: 0.6, pan: r() * 1.6 - 0.8 });
        });
        break;
      case "crowd":
        every(3.2, (t) => noise(wetBus, t, { color: "pink", type: "bandpass", f0: 900, f1: 1300, q: 0.8, dur: 1.4, gain: 0.08, attack: 0.5, wet: 0.5, pan: r() - 0.5 }));
        break;
      case "stadium":
        every(5.5, (t) => roar(wetBus, t, 0.2, 2.6));
        break;
      case "storm":
        every(7, (t) => thunder(wetBus, t, 0.5 + r() * 0.4, r));
        break;
      case "sea":
        every(7.5, (t) => {
          noise(wetBus, t, { color: "pink", type: "lowpass", f0: 2600, f1: 300, dur: 3.4, gain: 0.25, attack: 0.9, wet: 0.4, pan: r() * 0.8 - 0.4 });
          noise(wetBus, t + 0.8, { type: "highpass", f0: 3000, dur: 2.2, gain: 0.04, attack: 0.2, wet: 0.5 });
        });
        break;
      case "city":
        every(6, (t) => {
          if (r() < 0.4) {
            // A distant horn.
            const f = 330 + r() * 90;
            tone(wetBus, f, t, 0.5, 0.01, { type: "sawtooth", attack: 0.03, wet: 0.9, pan: r() - 0.5 });
            tone(wetBus, f * 1.26, t, 0.5, 0.008, { type: "sawtooth", attack: 0.03, wet: 0.9, pan: r() - 0.5 });
          } else {
            // A car passing.
            noise(wetBus, t, { color: "pink", type: "bandpass", f0: 500, f1: 260, q: 0.9, dur: 3, gain: 0.12, attack: 1.4, wet: 0.3, pan: r() * 1.4 - 0.7 });
          }
        });
        break;
      case "space":
        every(2.8, (t) => tone(wetBus, 2000 + r() * 3000, t, 2.4, 0.006, { attack: 0.6, wet: 1, pan: r() * 1.6 - 0.8 }));
        break;
      case "cave":
        every(2.2, (t) => { const f = 1100 + r() * 900; tone(wetBus, f, t, 0.12, 0.05, { f2: f * 0.6, attack: 0.002, wet: 1, pan: r() * 1.2 - 0.6 }); });
        break;
      case "underwater":
        every(0.9, (t) => { const f = 300 + r() * 500; for (let i = 0; i < 1 + Math.floor(r() * 3); i++) tone(wetBus, f * (1 + i * 0.3), t + i * 0.07, 0.07, 0.035, { f2: f * 2.2, attack: 0.003, wet: 0.7, pan: r() - 0.5 }); });
        break;
      case "hall":
      case "room":
        if (kind === "hall") every(9, (t) => footsteps(wetBus, t, 4, 0.55, 0.16, r, r() * 1.2 - 0.6));
        break;
      case "wind":
      case "snow":
        every(8, (t) => gust(wetBus, t, 0.5));
        break;
    }
  }
}

function bird(b: Bus, at: number, r: Rand) {
  // A short song: two to five FM chirps that sweep down.
  const n = 2 + Math.floor(r() * 4);
  const base = 2600 + r() * 2200;
  const pan = r() * 1.6 - 0.8;
  for (let i = 0; i < n; i++) {
    const t = at + i * (0.09 + r() * 0.05);
    const f = base * (1 + (r() - 0.5) * 0.25);
    tone(b, f, t, 0.07, 0.018, { f2: f * (0.6 + r() * 0.3), attack: 0.005, wet: 0.5, pan });
  }
}

// ---------------------------------------------------------------------------
// Music helpers
// ---------------------------------------------------------------------------

/** The next point on a musical grid (`step` seconds, counted from `origin`) at or after `t`. */
export function nextOnGrid(t: number, origin: number, step: number): number {
  const k = Math.ceil((t - origin) / step - 1e-6);
  return origin + k * step;
}

/** The nearest point on the grid. */
export function nearestOnGrid(t: number, origin: number, step: number): number {
  return origin + Math.round((t - origin) / step) * step;
}

export const smoothstep = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
