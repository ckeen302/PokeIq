/**
 * PokéGuessr's countdown pressure: the alarm when a countdown starts, then a
 * tension bed until the round closes (a ticking clock, a low heartbeat and a
 * quiet drone, all under a low-pass that slowly opens). Ticks speed up and
 * grow louder as time runs out; the last few seconds (the red flash) get
 * sharper, accented ticks on every second.
 *
 * The recorded one-shots in public/audio/guessr (CC0, see CREDITS.md there)
 * are used when they've loaded; every voice has a synthesised fallback, so a
 * missing or slow file never leaves the countdown silent.
 *
 * `PressureVoice` only schedules nodes on a context it's given, so the same
 * code renders offline (scripts/render-guessr-pressure.mjs) and live.
 */

import { duelSfxOn } from "./duel-sfx";
import { isMuted, liveAudio, onMuteChange } from "./sound";

export interface PressureSamples {
  start?: AudioBuffer;
  tick?: AudioBuffer;
  tock?: AudioBuffer;
  heart?: AudioBuffer;
}

export interface PressureOptions {
  /** Seconds left on the clock when the pressure starts. */
  leftS: number;
  /** The whole window the pressure covers, in seconds (for how far along it is). */
  totalS: number;
  /** The last stretch that flashes red, in seconds: stronger, sharper ticks. */
  flashS: number;
  /** 1 for duels, ranked and party; lower for timed solo rounds. */
  level: number;
  /** Play the alarm as it starts. */
  cue: boolean;
}

/** The mix: one place to tune every level (checked offline for peaks and RMS). */
export const PRESSURE_MIX = {
  master: 0.42,
  cue: 0.65,
  cueSynth: 1,
  tick: 0.36,
  tickStrong: 0.6,
  heart: 0.5,
  drone: 0.022,
  /** Release on stop, in seconds: short enough to feel instant, long enough not to click. */
  release: 0.06,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

interface Tick {
  /** Seconds left on the clock when it lands. */
  r: number;
  strong: boolean;
}

/** Every tick of a countdown, as seconds left when it lands (latest first). */
export function tickPlan(leftS: number, totalS: number, flashS: number): Tick[] {
  const ticks: Tick[] = [];
  const flash = Math.min(flashS, totalS);
  // Before the flash: one tick every 0.8 s, tightening to every 0.5 s as the flash nears.
  const before: number[] = [];
  for (let r = flash; ; ) {
    const step = lerp(0.5, 0.8, totalS > flash ? (r - flash) / (totalS - flash) : 0);
    r += step;
    if (r > leftS - 0.02) break;
    before.push(r);
  }
  for (const r of before.reverse()) ticks.push({ r, strong: false });
  // The flash: a strong tick on every second left, with quicker ticks between them (2, then 3, then 4 a second).
  for (let s = Math.floor(flash); s >= 1; s--) {
    const sub = s >= 4 ? 2 : s >= 2 ? 3 : 4;
    for (let j = 0; j < sub; j++) {
      const r = s - j / sub;
      if (r <= leftS - 0.02) ticks.push({ r, strong: j === 0 });
    }
  }
  return ticks;
}

/** Heartbeats (lub-dub), as seconds left: about 66 a minute at the start, 130 at the end. */
export function heartPlan(leftS: number, totalS: number): number[] {
  const beats: number[] = [];
  for (let r = leftS; r > 0.25; ) {
    beats.push(r);
    r -= lerp(0.46, 0.9, r / Math.max(totalS, 0.001));
  }
  return beats;
}

type Ctx = BaseAudioContext;

/** One countdown's pressure, scheduled on `audio` from `startAt`. */
export class PressureVoice {
  readonly startAt: number;
  readonly endAt: number;
  private readonly master: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly ticks: Tick[];
  private readonly beats: number[];
  private nextTick = 0;
  private nextBeat = 0;
  private released = false;

  constructor(
    private readonly audio: Ctx,
    destination: AudioNode,
    private readonly samples: () => PressureSamples,
    private readonly opts: PressureOptions,
    startAt = audio.currentTime + 0.01,
  ) {
    this.startAt = startAt;
    this.endAt = startAt + opts.leftS;
    this.ticks = tickPlan(opts.leftS, opts.totalS, opts.flashS);
    this.beats = heartPlan(opts.leftS, opts.totalS);

    this.master = audio.createGain();
    this.master.gain.value = PRESSURE_MIX.master * opts.level;
    this.master.connect(destination);
    // The bed's low-pass opens from muffled to bright as time runs out.
    this.filter = audio.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.7;
    const p0 = 1 - opts.leftS / Math.max(opts.totalS, 0.001);
    this.filter.frequency.setValueAtTime(lerp(1800, 9000, p0), startAt);
    this.filter.frequency.exponentialRampToValueAtTime(9000, this.endAt);
    this.filter.connect(this.master);

    if (opts.cue) this.cue(startAt);
    this.drone(startAt, p0);
  }

  private progress(r: number) {
    return 1 - r / Math.max(this.opts.totalS, 0.001);
  }

  private track<T extends AudioScheduledSourceNode>(node: T): T {
    this.sources.push(node);
    return node;
  }

  private sample(buffer: AudioBuffer, at: number, gain: number, rate = 1, out: AudioNode = this.filter) {
    const src = this.track(this.audio.createBufferSource());
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.audio.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(at);
  }

  private osc(type: OscillatorType, from: number, to: number, at: number, dur: number, peak: number, out: AudioNode = this.filter) {
    const o = this.track(this.audio.createOscillator());
    const g = this.audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private noise(at: number, dur: number, peak: number, type: BiquadFilterType, from: number, to = from, out: AudioNode = this.filter) {
    const frames = Math.max(1, Math.floor(this.audio.sampleRate * dur));
    const buffer = this.audio.createBuffer(1, frames, this.audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.track(this.audio.createBufferSource());
    src.buffer = buffer;
    const f = this.audio.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, at);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = this.audio.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + Math.min(0.004, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(out);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  /** The alarm: a rising whoosh into a two-note stab, over a low pulse. Skips the bed's filter (it should cut through). */
  private cue(at: number) {
    const buf = this.samples().start;
    if (buf) {
      this.sample(buf, at, PRESSURE_MIX.cue, 1, this.master);
      return;
    }
    const k = PRESSURE_MIX.cueSynth;
    this.noise(at, 0.28, 0.22 * k, "bandpass", 500, 4200, this.master);
    this.osc("sawtooth", 220, 880, at, 0.2, 0.16 * k, this.master);
    this.osc("square", 880, 880, at + 0.16, 0.11, 0.1 * k, this.master);
    this.osc("square", 1175, 1175, at + 0.28, 0.16, 0.1 * k, this.master);
    this.osc("sine", 110, 45, at + 0.02, 0.32, 0.5 * k, this.master);
  }

  /** A quiet low drone whose pitch creeps up a few semitones over the countdown. */
  private drone(at: number, p0: number) {
    const o = this.track(this.audio.createOscillator());
    const lp = this.audio.createBiquadFilter();
    const g = this.audio.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(lerp(55, 69, p0), at);
    o.frequency.linearRampToValueAtTime(69, this.endAt);
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(lerp(220, 900, p0), at);
    lp.frequency.exponentialRampToValueAtTime(900, this.endAt);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(PRESSURE_MIX.drone * lerp(0.6, 1, p0), at + 0.4);
    g.gain.linearRampToValueAtTime(PRESSURE_MIX.drone, this.endAt);
    o.connect(lp).connect(g).connect(this.master);
    o.start(at);
    o.stop(this.endAt + 0.05);
  }

  private tick(at: number, t: Tick, index: number) {
    const p = this.progress(t.r);
    const { tick, tock } = this.samples();
    const buf = index % 2 === 0 ? tick : tock;
    if (t.strong) {
      const gain = PRESSURE_MIX.tickStrong * lerp(0.85, 1, 1 - t.r / Math.max(this.opts.flashS, 1));
      if (tick) this.sample(tick, at, gain, 1.18);
      else this.noise(at, 0.03, gain * 0.9, "highpass", 2500);
      // A bright edge so the flash's ticks cut through.
      this.osc("square", 1760, 1760, at, 0.035, gain * 0.12);
      return;
    }
    const gain = PRESSURE_MIX.tick * lerp(0.4, 1, p);
    if (buf) this.sample(buf, at, gain, 1 + 0.05 * p);
    else {
      this.noise(at, 0.022, gain, "highpass", 3000);
      this.osc("sine", index % 2 === 0 ? 2000 : 1500, index % 2 === 0 ? 2000 : 1500, at, 0.02, gain * 0.4);
    }
  }

  private heart(at: number, r: number) {
    const gain = PRESSURE_MIX.heart * lerp(0.45, 1, this.progress(r));
    const buf = this.samples().heart;
    if (buf) {
      this.sample(buf, at, gain);
      return;
    }
    this.osc("sine", 62, 40, at, 0.14, gain);
    this.osc("sine", 58, 38, at + 0.22, 0.12, gain * 0.7);
  }

  /** Schedules everything that lands before audio time `until`. */
  scheduleUntil(until: number): void {
    if (this.released) return;
    const at = (r: number) => this.endAt - r;
    // With the alarm playing, the bed comes in just after it.
    const quietUntil = this.opts.cue ? this.startAt + 0.35 : this.startAt;
    while (this.nextTick < this.ticks.length && at(this.ticks[this.nextTick].r) < until) {
      const t = this.ticks[this.nextTick];
      if (at(t.r) >= quietUntil) this.tick(at(t.r), t, this.nextTick);
      this.nextTick++;
    }
    while (this.nextBeat < this.beats.length && at(this.beats[this.nextBeat]) < until) {
      const r = this.beats[this.nextBeat];
      if (at(r) >= quietUntil) this.heart(at(r), r);
      this.nextBeat++;
    }
  }

  /** Fades out over a few ms (no click) and stops everything scheduled. */
  release(at = this.audio.currentTime): void {
    if (this.released) return;
    this.released = true;
    const g = this.master.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(0, at + PRESSURE_MIX.release);
    for (const s of this.sources) {
      try {
        s.stop(at + PRESSURE_MIX.release + 0.01);
      } catch {
        // already stopped
      }
    }
  }

  get done(): boolean {
    return this.released;
  }

  disconnect(): void {
    try {
      this.master.disconnect();
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// The recorded one-shots
// ---------------------------------------------------------------------------

const FILES: Record<keyof PressureSamples, string> = { start: "countdown-start", tick: "tick", tock: "tock", heart: "heartbeat" };
let raw: Promise<Partial<Record<keyof PressureSamples, ArrayBuffer>>> | null = null;
let decoded: PressureSamples = {};
let decodedFor: BaseAudioContext | null = null;

function extension(): string {
  try {
    return typeof Audio !== "undefined" && new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  } catch {
    return "mp3";
  }
}

/** Fetches the one-shots (no AudioContext needed, so it's safe before any gesture). */
export function preloadPressure(): void {
  if (raw || typeof window === "undefined" || typeof fetch !== "function") return;
  const ext = extension();
  raw = Promise.all(
    (Object.keys(FILES) as (keyof PressureSamples)[]).map(async (k) => {
      try {
        const res = await fetch(`/audio/guessr/${FILES[k]}.${ext}`);
        return res.ok ? ([k, await res.arrayBuffer()] as const) : null;
      } catch {
        return null;
      }
    }),
  ).then((pairs) => Object.fromEntries(pairs.filter((p) => p !== null)));
}

function decodeFor(audio: BaseAudioContext): void {
  if (decodedFor === audio || !raw) return;
  decodedFor = audio;
  decoded = {};
  void raw.then((buffers) => {
    for (const [k, buf] of Object.entries(buffers) as [keyof PressureSamples, ArrayBuffer][]) {
      // decodeAudioData detaches its input: decode a copy so a later context can decode again.
      audio.decodeAudioData(buf.slice(0)).then(
        (b) => {
          if (decodedFor === audio) decoded[k] = b;
        },
        () => undefined, // the synthesised fallback plays instead
      );
    }
  });
}

// ---------------------------------------------------------------------------
// The live countdown (one at a time)
// ---------------------------------------------------------------------------

export interface LivePressure extends PressureOptions {
  /** Duels, ranked and party also follow the trainer's duel-sound toggle. */
  duel?: boolean;
}

let current: { voice: PressureVoice; timer: ReturnType<typeof setInterval>; unsub: () => void } | null = null;

function mark(state: "on" | "off") {
  if (typeof document !== "undefined") document.documentElement.dataset.guessrPressure = state;
}

/** Starts a countdown's pressure (stopping any other). False when it stays silent: muted, sounds off, or no gesture yet. */
export function startPressure(opts: LivePressure): boolean {
  stopPressure();
  if (opts.leftS <= 0 || isMuted() || (opts.duel && !duelSfxOn())) return false;
  const audio = liveAudio();
  if (!audio) return false;
  try {
    preloadPressure();
    decodeFor(audio);
    const voice = new PressureVoice(audio, audio.destination, () => decoded, opts);
    const run = () => {
      if (audio.currentTime >= voice.endAt + 0.05) {
        stopPressure();
        return;
      }
      voice.scheduleUntil(audio.currentTime + 0.2);
    };
    run();
    current = { voice, timer: setInterval(run, 50), unsub: onMuteChange((muted) => muted && stopPressure()) };
    mark("on");
    return true;
  } catch {
    // Sound is decoration: never let it break the game.
    return false;
  }
}

/** Stops the pressure at once, with a few ms of release so it doesn't click. */
export function stopPressure(): void {
  if (!current) return;
  const { voice, timer, unsub } = current;
  current = null;
  clearInterval(timer);
  unsub();
  try {
    voice.release();
    setTimeout(() => voice.disconnect(), (PRESSURE_MIX.release + 0.1) * 1000);
  } catch {
    // ignore
  }
  mark("off");
}

export function pressurePlaying(): boolean {
  return current !== null;
}
