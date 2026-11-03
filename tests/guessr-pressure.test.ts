import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A WebAudio stand-in that records what gets scheduled. */
interface Started {
  kind: "osc" | "buffer";
  at: number;
  buffer?: { name: string };
  stoppedAt?: number;
}
let started: Started[] = [];
let contexts = 0;
let masterRamps: { value: number; at: number }[] = [];

function param(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}
function node() {
  return { connect: vi.fn((n: unknown) => n), disconnect: vi.fn() };
}
class FakeContext {
  currentTime = 10;
  sampleRate = 44100;
  state = "running";
  destination = node();
  constructor() {
    contexts++;
  }
  resume() {
    return Promise.resolve();
  }
  createGain() {
    const gain = param(1);
    gain.linearRampToValueAtTime = vi.fn((value: number, at: number) => masterRamps.push({ value, at }));
    return { ...node(), gain };
  }
  createBiquadFilter() {
    return { ...node(), type: "lowpass", frequency: param(), Q: param() };
  }
  createBuffer(_c: number, frames: number) {
    return { getChannelData: () => new Float32Array(frames) };
  }
  private source(kind: Started["kind"]) {
    const rec: Started = { kind, at: -1 };
    const n = {
      ...node(),
      start: (at: number) => {
        rec.at = at;
        rec.buffer = (n as { buffer?: { name: string } }).buffer;
        started.push(rec);
      },
      stop: (at: number) => {
        rec.stoppedAt = at;
      },
    };
    return n;
  }
  createOscillator() {
    return Object.assign(this.source("osc"), { type: "sine", frequency: param() });
  }
  createBufferSource() {
    return Object.assign(this.source("buffer"), { buffer: undefined as unknown, playbackRate: param(1) });
  }
  decodeAudioData() {
    return Promise.reject(new Error("no audio in tests"));
  }
}

const store = new Map<string, string>();
function installBrowser() {
  const events = new EventTarget();
  vi.stubGlobal("window", {
    AudioContext: FakeContext,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
  vi.stubGlobal("document", { documentElement: { dataset: {} as Record<string, string> } });
  vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
}

async function load() {
  vi.resetModules();
  const pressure = await import("@/lib/guessr-pressure");
  const sound = await import("@/lib/sound");
  const duel = await import("@/lib/duel-sfx");
  return { ...pressure, ...sound, ...duel };
}

const COUNTDOWN = { leftS: 15, totalS: 15, flashS: 5, level: 1, cue: true };

beforeEach(() => {
  started = [];
  contexts = 0;
  masterRamps = [];
  store.clear();
  vi.useFakeTimers();
  installBrowser();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PokéGuessr countdown pressure", () => {
  it("duel sounds are on by default, and the trainer can still turn them off", async () => {
    const { duelSfxOn, setDuelSfx } = await load();
    expect(duelSfxOn()).toBe(true);
    setDuelSfx(false);
    expect(duelSfxOn()).toBe(false);
    expect(store.get("pokeiq-duel-sfx")).toBe("0");
    setDuelSfx(true);
    expect(duelSfxOn()).toBe(true);
  });

  it("sounds the alarm the moment the countdown starts", async () => {
    const { startPressure, pressurePlaying, stopPressure } = await load();
    expect(startPressure(COUNTDOWN)).toBe(true);
    expect(pressurePlaying()).toBe(true);
    expect(document.documentElement.dataset.guessrPressure).toBe("on");
    // The synthesised alarm (no files decode in tests): several voices within its first few hundred ms.
    const cue = started.filter((s) => s.at >= 10 && s.at < 10.35);
    expect(cue.length).toBeGreaterThanOrEqual(4);
    stopPressure();
  });

  it("plays the recorded alarm and ticks when they've loaded", async () => {
    const { PressureVoice } = await load();
    const audio = new FakeContext() as unknown as AudioContext;
    const buf = (name: string) => ({ name }) as unknown as AudioBuffer;
    const voice = new PressureVoice(audio, audio.destination, () => ({ start: buf("start"), tick: buf("tick"), tock: buf("tock"), heart: buf("heart") }), { leftS: 15, totalS: 15, flashS: 5, level: 1, cue: true }, 10);
    voice.scheduleUntil(Infinity);
    expect(started.find((s) => s.buffer?.name === "start")?.at).toBe(10);
    const ticks = started.filter((s) => s.buffer?.name === "tick" || s.buffer?.name === "tock").map((s) => s.at);
    const hearts = started.filter((s) => s.buffer?.name === "heart");
    expect(ticks.length).toBeGreaterThan(25);
    expect(hearts.length).toBeGreaterThan(12);
    // Every tick lands inside the countdown.
    expect(Math.max(...ticks)).toBeLessThan(25);
  });

  it("stops at once when the player guesses, with a short release", async () => {
    const { startPressure, stopPressure, pressurePlaying } = await load();
    startPressure(COUNTDOWN);
    vi.advanceTimersByTime(200);
    stopPressure();
    expect(pressurePlaying()).toBe(false);
    expect(document.documentElement.dataset.guessrPressure).toBe("off");
    // The master fades to silence within ~60 ms of now (10 s on the fake clock).
    const fade = masterRamps.find((r) => r.value === 0);
    expect(fade).toBeDefined();
    expect(fade!.at - 10).toBeGreaterThan(0.01);
    expect(fade!.at - 10).toBeLessThanOrEqual(0.1);
    // Everything already scheduled is stopped.
    expect(started.every((s) => s.stoppedAt !== undefined && s.stoppedAt <= 10.2)).toBe(true);
    // And nothing more gets scheduled.
    const count = started.length;
    vi.advanceTimersByTime(2_000);
    expect(started.length).toBe(count);
  });

  it("stops when the round ends", async () => {
    const { startPressure, pressurePlaying, liveAudio } = await load();
    startPressure({ ...COUNTDOWN, leftS: 1 });
    expect(pressurePlaying()).toBe(true);
    // The fake clock doesn't move by itself: jump the context past the end.
    (liveAudio() as unknown as FakeContext).currentTime = 11.2;
    vi.advanceTimersByTime(100);
    expect(pressurePlaying()).toBe(false);
  });

  it("stays silent while the site is muted", async () => {
    store.set("pokeiq-muted", "1");
    const { startPressure, pressurePlaying } = await load();
    expect(startPressure(COUNTDOWN)).toBe(false);
    expect(pressurePlaying()).toBe(false);
    expect(contexts).toBe(0);
    expect(started).toHaveLength(0);
  });

  it("stops the moment the site is muted mid-countdown", async () => {
    const { startPressure, pressurePlaying, setMuted } = await load();
    startPressure(COUNTDOWN);
    setMuted(true);
    expect(pressurePlaying()).toBe(false);
  });

  it("stays silent when the trainer turned PokéGuessr's sound effects off", async () => {
    store.set("pokeiq-duel-sfx", "0");
    const { startPressure } = await load();
    expect(startPressure(COUNTDOWN)).toBe(false);
    expect(startPressure({ ...COUNTDOWN, level: 0.55, leftS: 10, totalS: 10 })).toBe(false);
    expect(started).toHaveLength(0);
  });

  it("stays silent with the effects slider at zero", async () => {
    const { startPressure, setSfxScale } = await load();
    setSfxScale(0);
    expect(startPressure(COUNTDOWN)).toBe(false);
    expect(started).toHaveLength(0);
  });

  it("waits for a user gesture before starting audio", async () => {
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false } });
    const { startPressure } = await load();
    expect(startPressure(COUNTDOWN)).toBe(false);
    expect(contexts).toBe(0);
  });

  it("ticks speed up, with a strong tick on each of the flash's seconds", async () => {
    const { tickPlan } = await load();
    const ticks = tickPlan(15, 15, 5);
    const gaps = ticks.slice(1).map((t, i) => ticks[i].r - t.r);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + 1e-9);
    expect(gaps[0]).toBeGreaterThan(0.7);
    expect(gaps[gaps.length - 1]).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(ticks.filter((t) => t.strong).map((t) => t.r)).toEqual([5, 4, 3, 2, 1]);
    expect(ticks.every((t) => t.r <= 15 && t.r > 0)).toBe(true);
  });
});
