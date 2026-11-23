import { describe, expect, it } from "vitest";
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
