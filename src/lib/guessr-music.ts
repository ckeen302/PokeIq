/**
 * PokéGuessr's background music: calm, original ambient pieces
 * (public/audio/guessr/CREDITS.md) shuffled with long crossfades, carrying on
 * from round to round and page to page while any PokéGuessr screen is open.
 *
 * - Streams from two <audio> elements (no multi-megabyte decoded buffers on
 *   phones), routed through the site's AudioContext so fades, the volume and
 *   the ducking under sound effects are smooth gain ramps (iOS ignores an
 *   element's own volume).
 * - Silent, and fetching nothing, until the page has had a real tap or key
 *   press, while the site is muted, while the tab is hidden, or when Music is
 *   off in the settings.
 * - Loaded lazily (use-guessr-music.ts imports this once the page is idle).
 *
 * Browser-only.
 */

import { isMuted, liveAudio, onEffect, onMuteChange, type SoundKind } from "./sound";
import { ShufflePlaylist } from "./guessr-playlist";
import { guessrMusicPrefs, musicGain, subscribeGuessrMusicPrefs } from "./guessr-music-prefs";

export const GUESSR_TRACKS = ["first-light", "tide-pools", "long-grass", "harbour-lights"] as const;
export type GuessrTrack = (typeof GUESSR_TRACKS)[number];

/** Seconds two tracks overlap. */
export const CROSSFADE_S = 2.6;
/** The first track's (and a resumed track's) fade in. */
const FADE_IN_S = 2.0;
/** Fading out to stop (leaving PokéGuessr, muting, Music off). */
const FADE_OUT_S = 0.8;
/** The music's share under a sound effect, and how long it waits after the last one before coming back. */
export const DUCK = 0.5;
const DUCK_HOLD_MS = 650;
/** Effects too small to duck for. */
const NO_DUCK = new Set<SoundKind>(["pin", "click", "ping"]);
/** Start fetching the next track this many seconds before the crossfade. */
const PRELOAD_S = 30;
/** A screen closing waits this long before the music stops, so moving between PokéGuessr pages doesn't. */
const RELEASE_MS = 1500;

/** A silent, 0.05 s WAV: played inside the first gesture to unlock the second element on iOS, with no request. */
function silentWav(): string {
  const rate = 8000;
  const frames = 400;
  const bytes = new Uint8Array(44 + frames);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + frames, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, frames, true);
  bytes.fill(128, 44); // 8-bit silence
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** Freezes a param where it is now (mid-ramp included), so a new ramp starts there without a jump (a click). */
function hold(param: AudioParam, at: number) {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(at);
    return;
  }
  const value = param.value;
  param.cancelScheduledValues(at);
  param.setValueAtTime(value, at);
}

function rampTo(audio: AudioContext, param: AudioParam, value: number, seconds: number) {
  const now = audio.currentTime;
  hold(param, now);
  param.linearRampToValueAtTime(value, now + Math.max(0.02, seconds));
}

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  track: GuessrTrack | null;
  /** Bumped on every start or stop, so a stale timer or promise leaves the deck alone. */
  generation: number;
  unlocked: boolean;
}

export type GuessrMusicState = "off" | "waiting" | "loading" | "playing";

const GESTURES = ["pointerup", "touchend", "click", "keydown"] as const;

export class GuessrMusicPlayer {
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private decks: Deck[] = [];
  private current: Deck | null = null;
  private playlist = new ShufflePlaylist<GuessrTrack>(GUESSR_TRACKS);
  private users = 0;
  private hidden = false;
  private started = false;
  private armed = false;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private ext: "ogg" | "mp3" = "mp3";
  state: GuessrMusicState = "off";

  /** A PokéGuessr screen opened: the music may play. Returns its release. */
  acquire(): () => void {
    this.init();
    this.users++;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    this.sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users = Math.max(0, this.users - 1);
      if (this.users === 0) {
        this.releaseTimer = setTimeout(() => {
          this.releaseTimer = null;
          this.sync();
        }, RELEASE_MS);
      }
    };
  }

  private init() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    try {
      this.ext = new Audio().canPlayType('audio/ogg; codecs="opus"') === "probably" ? "ogg" : "mp3";
    } catch {
      this.ext = "mp3";
    }
    this.hidden = document.visibilityState === "hidden";
    onMuteChange(() => this.sync());
    subscribeGuessrMusicPrefs(() => this.sync());
    onEffect((kind) => this.duckFor(kind));
    document.addEventListener("visibilitychange", () => {
      this.hidden = document.visibilityState === "hidden";
      this.sync();
    });
    window.addEventListener("pagehide", () => {
      this.hidden = true;
      this.sync();
    });
    window.addEventListener("pageshow", () => {
      this.hidden = document.visibilityState === "hidden";
      this.sync();
    });
  }

  /** Whether the music should be sounding now (a gesture aside). */
  get wanted(): boolean {
    const prefs = guessrMusicPrefs();
    return this.users > 0 && prefs.on && prefs.volume > 0 && !this.hidden && !isMuted();
  }

  private setState(state: GuessrMusicState) {
    this.state = state;
    const root = document.documentElement;
    root.dataset.guessrMusic = state;
    if (this.current?.track && state === "playing") root.dataset.guessrTrack = this.current.track;
    else delete root.dataset.guessrTrack;
  }

  /** Listens for the gesture that lets audio start (kept until the music really plays). */
  private arm() {
    if (this.armed) return;
    this.armed = true;
    for (const e of GESTURES) window.addEventListener(e, this.onGesture, true);
  }

  private disarm() {
    if (!this.armed) return;
    this.armed = false;
    for (const e of GESTURES) window.removeEventListener(e, this.onGesture, true);
  }

  private onGesture = () => {
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    // A touch's pointerdown isn't an activation; the browser counts its pointerup / touchend / click.
    if (activation && !activation.hasBeenActive) return;
    this.sync(true);
  };

  /** Builds the graph and the two decks, once, on the first gesture with sound on. */
  private graph(): AudioContext | null {
    const audio = liveAudio();
    if (!audio) return null;
    if (this.audio === audio && this.master) return audio;
    this.audio = audio;
    this.duck = audio.createGain();
    this.duck.connect(audio.destination);
    this.master = audio.createGain();
    this.master.gain.value = musicGain(guessrMusicPrefs().volume);
    this.master.connect(this.duck);
    this.decks = [0, 1].map(() => {
      const el = new Audio();
      el.preload = "none";
      el.loop = false;
      const gain = audio.createGain();
      gain.gain.value = 0;
      audio.createMediaElementSource(el).connect(gain).connect(this.master!);
      const deck: Deck = { el, gain, track: null, generation: 0, unlocked: false };
      el.addEventListener("timeupdate", () => this.onTime(deck));
      el.addEventListener("ended", () => {
        if (this.current === deck) this.advance(FADE_IN_S);
      });
      el.addEventListener("error", () => this.onError(deck));
      return deck;
    });
    return audio;
  }

  /** Makes the sound match what's wanted. `gesture`: called from inside a tap or key press. */
  private sync(gesture = false) {
    if (!this.started) return;
    if (!this.wanted) {
      this.stop(this.hidden ? 0 : FADE_OUT_S);
      return;
    }
    const audio = this.graph();
    if (!audio) {
      // No gesture yet (or no WebAudio): the next tap tries again.
      this.setState("waiting");
      this.arm();
      return;
    }
    rampTo(audio, this.master!.gain, musicGain(guessrMusicPrefs().volume), 0.12);
    if (gesture) this.unlockSpare();
    const deck = this.current;
    if (!deck) {
      this.advance(FADE_IN_S);
      return;
    }
    if (deck.el.paused) this.play(deck, FADE_IN_S);
  }

  /** iOS lets an element play outside a gesture only once it has played inside one: unlocks the deck the next crossfade uses. */
  private unlockSpare() {
    for (const deck of this.decks) {
      if (deck.unlocked || deck === this.current || deck.track) continue;
      deck.unlocked = true;
      deck.el.src = silentWav();
      void deck.el.play().then(
        () => {
          if (!deck.track) deck.el.pause();
        },
        () => {
          deck.unlocked = false;
        },
      );
    }
  }

  private url(track: GuessrTrack) {
    return `/audio/guessr/${track}.${this.ext}`;
  }

  /** Points a deck at a track (fetching starts when it plays or preloads). */
  private load(deck: Deck, track: GuessrTrack, preload: "none" | "auto") {
    if (deck.track !== track) {
      deck.track = track;
      deck.el.preload = preload;
      deck.el.src = this.url(track);
    } else if (preload === "auto" && deck.el.preload !== "auto") {
      deck.el.preload = "auto";
      deck.el.load();
    }
  }

  /** Crossfades (or fades in, at the start) to the playlist's next track. */
  private advance(fade: number) {
    const audio = this.audio;
    if (!audio || !this.wanted) return;
    const old = this.current;
    const deck = this.decks.find((d) => d !== old)!;
    const track = this.playlist.next();
    this.load(deck, track, "auto");
    if (deck.el.currentTime > 0) deck.el.currentTime = 0;
    this.current = deck;
    if (old) this.fadeAndPause(old, CROSSFADE_S);
    this.play(deck, old ? CROSSFADE_S : fade);
  }

  private play(deck: Deck, fade: number) {
    const audio = this.audio!;
    const generation = ++deck.generation;
    hold(deck.gain.gain, audio.currentTime);
    deck.gain.gain.setValueAtTime(deck.el.paused ? 0 : deck.gain.gain.value, audio.currentTime);
    if (deck.el.paused) this.setState("loading");
    const started = deck.el.play();
    const onPlaying = () => {
      if (deck.generation !== generation || this.current !== deck) return;
      rampTo(audio, deck.gain.gain, 1, fade);
      this.setState("playing");
      this.disarm();
    };
    if (!deck.el.paused && deck.el.readyState >= 3) onPlaying();
    else deck.el.addEventListener("playing", onPlaying, { once: true });
    void started?.catch(() => {
      // Not allowed yet (no gesture this element counts): wait for the next tap.
      if (deck.generation !== generation) return;
      deck.el.removeEventListener("playing", onPlaying);
      if (this.current === deck) {
        this.setState("waiting");
        this.arm();
      }
    });
  }

  private fadeAndPause(deck: Deck, seconds: number) {
    const audio = this.audio;
    const generation = ++deck.generation;
    if (!audio || seconds <= 0) {
      deck.gain.gain.value = 0;
      deck.el.pause();
      return;
    }
    rampTo(audio, deck.gain.gain, 0, seconds);
    setTimeout(() => {
      if (deck.generation === generation) deck.el.pause();
    }, seconds * 1000 + 60);
  }

  /** Fades out and pauses where it is (it resumes from there). */
  private stop(seconds: number) {
    for (const deck of this.decks) {
      if (deck === this.current) {
        if (!deck.el.paused) this.fadeAndPause(deck, seconds);
        else deck.generation++;
      } else if (!deck.el.paused) this.fadeAndPause(deck, Math.min(seconds, 0.3));
    }
    this.setState("off");
  }

  /** Near the end: fetch the next track, then crossfade into it. */
  private onTime(deck: Deck) {
    if (deck !== this.current || deck.el.paused || !this.wanted) return;
    const left = deck.el.duration - deck.el.currentTime;
    if (!Number.isFinite(left)) return;
    if (left <= CROSSFADE_S + 0.1) {
      this.advance(CROSSFADE_S);
      return;
    }
    if (left <= CROSSFADE_S + PRELOAD_S) {
      const spare = this.decks.find((d) => d !== deck)!;
      if (spare.el.paused) this.load(spare, this.playlist.peek(), "auto");
    }
  }

  private onError(deck: Deck) {
    // An Ogg the browser claimed it could play but couldn't: MP3 from now on, the same track again.
    if (this.ext === "ogg" && deck.track) {
      this.ext = "mp3";
      const track = deck.track;
      deck.track = null;
      this.load(deck, track, "auto");
      if (deck === this.current && this.wanted) this.play(deck, FADE_IN_S);
    }
  }

  /** Dips the music under a sound effect (a reveal, the score counting up, the timer's tick), then brings it back. */
  private duckFor(kind: SoundKind) {
    const audio = this.audio;
    if (!audio || !this.duck || NO_DUCK.has(kind) || this.state !== "playing") return;
    const now = audio.currentTime;
    hold(this.duck.gain, now);
    this.duck.gain.setTargetAtTime(DUCK, now, 0.05);
    if (this.duckTimer) clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => {
      this.duckTimer = null;
      if (!this.audio || !this.duck) return;
      const t = this.audio.currentTime;
      hold(this.duck.gain, t);
      this.duck.gain.setTargetAtTime(1, t, 0.45);
    }, DUCK_HOLD_MS);
  }
}

export const guessrMusic = new GuessrMusicPlayer();
