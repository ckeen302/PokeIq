import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A WebAudio stand-in that records the music's sources and their gains. */
interface Param {
  value: number;
  targets: { value: number; at: number }[];
  ramps: { value: number; at: number }[];
  setValueAtTime: (v: number) => void;
  linearRampToValueAtTime: (v: number, at: number) => void;
  setTargetAtTime: (v: number, at: number) => void;
  cancelScheduledValues: () => void;
  exponentialRampToValueAtTime: () => void;
}
function param(value = 1): Param {
  const p: Param = {
    value,
    targets: [],
    ramps: [],
    setValueAtTime: (v) => void (p.value = v),
    linearRampToValueAtTime: (v, at) => void p.ramps.push({ value: v, at }),
    setTargetAtTime: (v, at) => void p.targets.push({ value: v, at }),
    cancelScheduledValues: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  };
  return p;
}
interface Src {
  buffer: { file: string } | null;
  loop: boolean;
  playbackRate: Param;
  gain?: Param;
  startedAt?: number;
  stoppedAt?: number;
  onended: (() => void) | null;
}
let sources: Src[] = [];
let contexts = 0;

class FakeContext {
  currentTime = 5;
  sampleRate = 44100;
  state = "running";
  destination = { connect: vi.fn() };
  constructor() {
    contexts++;
  }
  resume() {
    return Promise.resolve();
  }
  createGain() {
    const gain = param(1);
    const node = { gain, connect: (n: unknown) => n, disconnect: vi.fn() };
    return node;
  }
  createBufferSource() {
    const src: Src & { connect: (n: { gain?: Param }) => unknown; start: (at: number) => void; stop: (at: number) => void } = {
      buffer: null,
      loop: false,
      playbackRate: param(1),
      onended: null,
      connect: (n) => {
        src.gain = n.gain;
        return n;
      },
      start: (at) => {
        src.startedAt = at;
        sources.push(src);
      },
      stop: (at) => {
        src.stoppedAt = at;
      },
    };
    return src;
  }
  decodeAudioData(bytes: ArrayBuffer) {
    return Promise.resolve({ file: new TextDecoder().decode(bytes) });
  }
}

const store = new Map<string, string>();
let fetched: string[] = [];
let activated = true;
function installBrowser() {
  const events = new EventTarget();
  vi.stubGlobal("window", {
    AudioContext: FakeContext,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
  vi.stubGlobal("navigator", {
    get userActivation() {
      return { hasBeenActive: activated };
    },
  });
  vi.stubGlobal("fetch", (url: string) => {
    fetched.push(url);
    const file = url.split("/").pop()!.split(".")[0];
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(file).buffer) });
  });
}

async function load() {
  vi.resetModules();
  const music = await import("@/lib/guessr-music");
  const sound = await import("@/lib/sound");
  return { ...music, ...sound, player: new music.GuessrMusic() };
}
const settle = () => vi.advanceTimersByTimeAsync(0);
const live = () => sources.filter((s) => s.stoppedAt === undefined);

beforeEach(() => {
  sources = [];
  fetched = [];
  contexts = 0;
  activated = true;
  store.clear();
  vi.useFakeTimers();
  installBrowser();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PokéGuessr music", () => {
  it("is on by default, and remembers the player's choice", async () => {
    const { player, loadGuessrAudio } = await load();
    player.init();
    expect(player.prefs.music.on).toBe(true);
    player.setPrefs({ music: { on: false, volume: 0.3 }, sfxVolume: 0.6 });
    expect(loadGuessrAudio()).toEqual({ music: { on: false, volume: 0.3 }, sfxVolume: 0.6 });
    const again = await load();
    again.player.init();
    expect(again.player.prefs.music.on).toBe(false);
  });

  it("falls back to the defaults when storage throws", async () => {
    const { loadGuessrAudio, DEFAULT_GUESSR_AUDIO } = await load();
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); } } });
    expect(loadGuessrAudio()).toEqual(DEFAULT_GUESSR_AUDIO);
  });

  it("waits for a user gesture before it starts", async () => {
    activated = false;
    const { player } = await load();
    player.want("lobby");
    await settle();
    expect(contexts).toBe(0);
    expect(player.playing).toBeNull();
    activated = true;
    window.dispatchEvent(new Event("pointerdown"));
    await settle();
    await settle();
    expect(player.playing).toBe("lobby");
    expect(live()[0].loop).toBe(true);
  });

  it("crossfades between states: lobby, then a round", async () => {
    const { player, CROSSFADE_S } = await load();
    player.want("lobby");
    await settle();
    const lobby = live()[0];
    expect(lobby.buffer?.file).toBe("lobby");
    player.want("round");
    await settle();
    expect(player.playing).toBe("round");
    // The lobby fades to silence over the crossfade, then stops; the round fades in over the same time.
    expect(lobby.gain!.ramps.at(-1)).toEqual({ value: 0, at: 5 + CROSSFADE_S });
    expect(lobby.stoppedAt).toBeCloseTo(5 + CROSSFADE_S + 0.05);
    const round = live()[0];
    expect(round.buffer?.file).toBe("round");
    expect(round.gain!.ramps.at(-1)!.at).toBeCloseTo(5 + CROSSFADE_S);
  });

  it("fetches only the states that can come next", async () => {
    const { player } = await load();
    player.want("lobby");
    await settle();
    const names = fetched.map((u) => u.split("/").pop()!.split(".")[0]).sort();
    expect(names).toEqual(["duel", "lobby", "round"]);
  });

  it("plays a result sting once, not looped", async () => {
    const { player } = await load();
    player.want("duel");
    await settle();
    player.want("win");
    await settle();
    const sting = sources.find((s) => s.buffer?.file === "win")!;
    expect(sting.loop).toBe(false);
    sting.onended?.();
    player.want("win");
    await settle();
    expect(sources.filter((s) => s.buffer?.file === "win")).toHaveLength(1);
  });

  it("ducks under the countdown, and the duel loop speeds up", async () => {
    const { player, PRESSURE_DUCK, PRESSURE_RATE, MUSIC_TRACKS } = await load();
    player.want("duel");
    await settle();
    const duel = live()[0];
    player.setPressure(true);
    expect(duel.gain!.targets.at(-1)!.value).toBeCloseTo(MUSIC_TRACKS.duel.gain * PRESSURE_DUCK);
    expect(duel.playbackRate.targets.at(-1)!.value).toBe(PRESSURE_RATE);
    player.setPressure(false);
    expect(duel.gain!.targets.at(-1)!.value).toBeCloseTo(MUSIC_TRACKS.duel.gain);
    expect(duel.playbackRate.targets.at(-1)!.value).toBe(1);
  });

  it("goes silent when the site is muted, and comes back when unmuted", async () => {
    const { player, setMuted } = await load();
    player.want("lobby");
    await settle();
    setMuted(true);
    expect(player.playing).toBeNull();
    expect(live()).toHaveLength(0);
    setMuted(false);
    await settle();
    expect(player.playing).toBe("lobby");
  });

  it("stays silent while muted from the start", async () => {
    store.set("pokeiq-muted", "1");
    const { player } = await load();
    player.want("lobby");
    await settle();
    expect(contexts).toBe(0);
    expect(player.playing).toBeNull();
  });

  it("the Music toggle stops it and starts it again", async () => {
    const { player } = await load();
    player.want("round");
    await settle();
    player.setPrefs({ music: { on: false } });
    expect(player.playing).toBeNull();
    player.setPrefs({ music: { on: true } });
    await settle();
    expect(player.playing).toBe("round");
  });

  it("keeps playing across PokéGuessr pages, and fades out on leaving them", async () => {
    const { player } = await load();
    player.want("lobby");
    await settle();
    const first = live()[0];
    // One screen unmounts, the next mounts and wants the same state.
    player.want(null);
    player.want("lobby");
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.stoppedAt).toBeUndefined();
    player.want(null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.playing).toBeNull();
    expect(first.stoppedAt).toBeDefined();
  });
});
