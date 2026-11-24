import { afterEach, describe, expect, it, vi } from "vitest";
import { ShufflePlaylist } from "@/lib/guessr-playlist";
import { DEFAULT_GUESSR_MUSIC, musicGain, parseGuessrMusicPrefs } from "@/lib/guessr-music-prefs";

/** A small seeded random source (mulberry32), so the shuffles are repeatable. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRACKS = ["a", "b", "c", "d"] as const;

describe("PokéGuessr music: the shuffle", () => {
  it("plays every track once before any repeats", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const list = new ShufflePlaylist(TRACKS, seeded(seed));
      for (let round = 0; round < 5; round++) {
        const dealt = TRACKS.map(() => list.next());
        expect([...dealt].sort()).toEqual([...TRACKS]);
      }
    }
  });

  it("never plays the same track twice in a row, across reshuffles", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const list = new ShufflePlaylist(TRACKS, seeded(seed));
      let last: string | null = null;
      for (let i = 0; i < 40; i++) {
        const next = list.next();
        expect(next).not.toBe(last);
        last = next;
      }
    }
  });

  it("also holds when the random source always says the same thing", () => {
    for (const r of [0, 0.5, 0.999999]) {
      const list = new ShufflePlaylist(TRACKS, () => r);
      let last: string | null = null;
      for (let i = 0; i < 20; i++) {
        const next = list.next();
        expect(next).not.toBe(last);
        last = next;
      }
    }
  });

  it("peek shows what next will play, without moving on", () => {
    const list = new ShufflePlaylist(TRACKS, seeded(7));
    for (let i = 0; i < 12; i++) {
      const peeked = list.peek();
      expect(list.peek()).toBe(peeked);
      expect(list.next()).toBe(peeked);
    }
  });

  it("varies the order between shuffles", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const list = new ShufflePlaylist(TRACKS, seeded(seed));
      orders.add(TRACKS.map(() => list.next()).join(""));
    }
    expect(orders.size).toBeGreaterThan(5);
  });

  it("a single track just repeats", () => {
    const list = new ShufflePlaylist(["only"]);
    expect([list.next(), list.next(), list.next()]).toEqual(["only", "only", "only"]);
  });

  it("an empty playlist throws", () => {
    expect(() => new ShufflePlaylist([]).next()).toThrow();
  });
});

describe("PokéGuessr music: the settings", () => {
  it("defaults to on, at a low volume", () => {
    expect(parseGuessrMusicPrefs(null)).toEqual(DEFAULT_GUESSR_MUSIC);
    expect(DEFAULT_GUESSR_MUSIC).toEqual({ on: true, volume: 0.35 });
  });

  it("keeps what was saved and ignores what's broken", () => {
    expect(parseGuessrMusicPrefs(JSON.stringify({ on: false, volume: 0.6 }))).toEqual({ on: false, volume: 0.6 });
    expect(parseGuessrMusicPrefs(JSON.stringify({ on: "yes", volume: 7 }))).toEqual(DEFAULT_GUESSR_MUSIC);
    expect(parseGuessrMusicPrefs("{not json")).toEqual(DEFAULT_GUESSR_MUSIC);
    expect(parseGuessrMusicPrefs(JSON.stringify({ volume: 0 }))).toEqual({ on: true, volume: 0 });
  });

  it("the volume curve is gentle, silent at 0 and full at 1", () => {
    expect(musicGain(0)).toBe(0);
    expect(musicGain(1)).toBe(1);
    expect(musicGain(0.35)).toBeGreaterThan(0.15);
    expect(musicGain(0.35)).toBeLessThan(0.35);
    expect(musicGain(2)).toBe(1);
    expect(musicGain(-1)).toBe(0);
    for (let v = 0.05; v <= 1; v += 0.05) expect(musicGain(v)).toBeGreaterThan(musicGain(v - 0.05));
  });
});

/**
 * A page without WebAudio: enough browser for the player to decide whether the
 * music should sound (where it should, it then waits for the audio, so the
 * state reads "waiting"). Returns the page's data-guessr-music.
 */
function fakePage({ muted = false, prefs }: { muted?: boolean; prefs?: { on: boolean; volume: number } } = {}) {
  const store = new Map<string, string>();
  if (muted) store.set("pokeiq-muted", "1");
  if (prefs) store.set("pokeiq-guessr-music", JSON.stringify(prefs));
  const win = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  const dataset: Record<string, string> = {};
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible", documentElement: { dataset } });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal(
    "Audio",
    class {
      canPlayType() {
        return "";
      }
    },
  );
  return { state: () => dataset.guessrMusic };
}

/** A new player, with the sound and settings modules it listens to. */
async function freshPlayer() {
  vi.resetModules();
  const { GuessrMusicPlayer } = await import("@/lib/guessr-music");
  const { setMuted } = await import("@/lib/sound");
  const { setGuessrMusicPrefs } = await import("@/lib/guessr-music-prefs");
  return { player: new GuessrMusicPlayer(), setMuted, setGuessrMusicPrefs };
}

describe("PokéGuessr music: only while a game is on", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("plays while a game holds it, and fades out at once when the game ends", async () => {
    const page = fakePage();
    const { player } = await freshPlayer();
    expect(page.state()).toBeUndefined();
    const release = player.acquire();
    expect(player.wanted).toBe(true);
    expect(page.state()).toBe("waiting");
    release(true);
    expect(player.wanted).toBe(false);
    expect(page.state()).toBe("off");
    // The next game brings it back.
    player.acquire();
    expect(page.state()).toBe("waiting");
  });

  it("a screen closing stops it a moment later, unless the next screen's game takes it up", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const { player } = await freshPlayer();
    const first = player.acquire();
    first();
    expect(page.state()).toBe("waiting");
    vi.advanceTimersByTime(1000);
    const second = player.acquire();
    vi.advanceTimersByTime(5000);
    expect(page.state()).toBe("waiting");
    second();
    vi.advanceTimersByTime(1400);
    expect(page.state()).toBe("waiting");
    vi.advanceTimersByTime(200);
    expect(page.state()).toBe("off");
  });

  it("stays on while another screen still holds it, and each release counts once", async () => {
    const page = fakePage();
    const { player } = await freshPlayer();
    const a = player.acquire();
    const b = player.acquire();
    a(true);
    a(true);
    expect(player.wanted).toBe(true);
    expect(page.state()).toBe("waiting");
    b(true);
    expect(page.state()).toBe("off");
  });

  it("stays silent while the site is muted, and follows the mute", async () => {
    const page = fakePage({ muted: true });
    const { player, setMuted } = await freshPlayer();
    player.acquire();
    expect(player.wanted).toBe(false);
    expect(page.state()).toBe("off");
    setMuted(false);
    expect(page.state()).toBe("waiting");
    setMuted(true);
    expect(page.state()).toBe("off");
  });

  it("follows the Music settings: off, or the volume at 0, is silent", async () => {
    const page = fakePage({ prefs: { on: false, volume: 0.35 } });
    const { player, setGuessrMusicPrefs } = await freshPlayer();
    player.acquire();
    expect(page.state()).toBe("off");
    setGuessrMusicPrefs({ on: true });
    expect(page.state()).toBe("waiting");
    setGuessrMusicPrefs({ volume: 0 });
    expect(page.state()).toBe("off");
  });
});
