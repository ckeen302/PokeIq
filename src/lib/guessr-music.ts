/**
 * PokéGuessr's music: a menu loop, a calm loop while studying a screenshot,
 * a tenser loop for duels, ranked and parties, and short win / lose / draw
 * stings. All CC0 chiptune (public/audio/guessr/CREDITS.md), never game music.
 *
 * - WebAudio, so loops are sample-accurate (no gap at the seam), states
 *   crossfade, and the duel loop can speed up and duck under the countdown.
 * - Lazy: a state's file is fetched when it's first wanted, and only the
 *   states that can come next are fetched ahead of time.
 * - On by default, but silent until the player's first tap or key press, while
 *   the site's sound is muted, or when they turn it off (remembered here).
 *
 * Browser-only; everything no-ops on the server.
 */

import { isMuted, liveAudio, onMuteChange } from "./sound";

export type MusicState = "lobby" | "round" | "duel" | "win" | "lose" | "draw";

interface Track {
  file: string;
  loop: boolean;
  /** The track's own level under the player's volume. */
  gain: number;
}

export const MUSIC_TRACKS: Record<MusicState, Track> = {
  lobby: { file: "lobby", loop: true, gain: 0.55 },
  round: { file: "round", loop: true, gain: 0.4 },
  duel: { file: "duel", loop: true, gain: 0.45 },
  win: { file: "win", loop: false, gain: 0.6 },
  lose: { file: "lose", loop: false, gain: 0.6 },
  draw: { file: "draw", loop: false, gain: 0.6 },
};

/** What can follow each state: the only files fetched ahead of time. */
export const MUSIC_NEXT: Record<MusicState, MusicState[]> = {
  lobby: ["round", "duel"],
  round: ["win", "draw"],
  duel: ["win", "lose", "draw"],
  win: ["lobby"],
  lose: ["lobby"],
  draw: ["lobby"],
};

export const CROSSFADE_S = 1.2;
/** The countdown's pressure: the music ducks to this share and the duel loop speeds up. */
export const PRESSURE_DUCK = 0.45;
export const PRESSURE_RATE = 1.06;

// ---------------------------------------------------------------------------
// Preferences: music and sound effects, each on/off with a volume
// ---------------------------------------------------------------------------

export interface ChannelPrefs {
  on: boolean;
  /** 0 to 1. */
  volume: number;
}
export interface GuessrAudioPrefs {
  music: ChannelPrefs;
  /** Sound effects' level, 0 to 1. (Whether they're on at all is the duel-sound toggle, duel-sfx.ts.) */
  sfxVolume: number;
}

const PREFS_KEY = "pokeiq:guessr:audio";
export const DEFAULT_GUESSR_AUDIO: GuessrAudioPrefs = { music: { on: true, volume: 0.5 }, sfxVolume: 0.8 };

function channel(raw: unknown, fallback: ChannelPrefs): ChannelPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<ChannelPrefs>;
  return {
    on: typeof p.on === "boolean" ? p.on : fallback.on,
    volume: typeof p.volume === "number" && p.volume >= 0 && p.volume <= 1 ? p.volume : fallback.volume,
  };
}

export function loadGuessrAudio(): GuessrAudioPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<GuessrAudioPrefs>) : {};
    const sfx = p.sfxVolume;
    return { music: channel(p.music, DEFAULT_GUESSR_AUDIO.music), sfxVolume: typeof sfx === "number" && sfx >= 0 && sfx <= 1 ? sfx : DEFAULT_GUESSR_AUDIO.sfxVolume };
  } catch {
    return DEFAULT_GUESSR_AUDIO;
  }
}

function saveGuessrAudio(prefs: GuessrAudioPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // kept for this page only
  }
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

interface Voice {
  state: MusicState;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

type Listener = () => void;

function extension(): string {
  try {
    return typeof Audio !== "undefined" && new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  } catch {
    return "mp3";
  }
}

export class GuessrMusic {
  prefs: GuessrAudioPrefs = DEFAULT_GUESSR_AUDIO;
  /** What the page wants now (null: silence). */
  state: MusicState | null = null;
  pressure = false;
  private muted = true;
  private started = false;
  private bytes = new Map<MusicState, Promise<ArrayBuffer | null>>();
  private buffers = new Map<MusicState, AudioBuffer>();
  private decoding = new Map<MusicState, Promise<AudioBuffer | null>>();
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: Voice | null = null;
  /** The sting that already played for this state (a sting plays once). */
  private stungFor: MusicState | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();

  /** Reads the prefs, and wires up the first-gesture gate and the site mute (once). */
  init() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.prefs = loadGuessrAudio();
    this.muted = isMuted();
    const arm = () => {
      window.removeEventListener("pointerdown", arm, true);
      window.removeEventListener("keydown", arm, true);
      // After the gesture's own handlers (the context may only start inside one).
      setTimeout(() => this.apply(), 0);
    };
    window.addEventListener("pointerdown", arm, true);
    window.addEventListener("keydown", arm, true);
    onMuteChange((muted) => {
      this.muted = muted;
      this.apply();
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    // What's sounding, on the page for the e2e.
    if (typeof document !== "undefined" && document.documentElement) document.documentElement.dataset.guessrMusic = this.voice?.state ?? "none";
    for (const l of this.listeners) l();
  }

  /** The state the page wants. Null fades out (after a moment, so moving between PokéGuessr pages doesn't restart the music). */
  want(state: MusicState | null) {
    this.init();
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (state === null) {
      this.clearTimer = setTimeout(() => {
        this.clearTimer = null;
        this.state = null;
        this.pressure = false;
        this.apply();
      }, 400);
      return;
    }
    if (state === this.state) return;
    this.state = state;
    if (!MUSIC_TRACKS[state].loop) this.stungFor = null;
    this.apply();
  }

  /** The countdown's pressure: ducks the music, and the duel loop speeds up. */
  setPressure(on: boolean) {
    if (on === this.pressure) return;
    this.pressure = on;
    this.shape();
  }

  setPrefs(patch: { music?: Partial<ChannelPrefs>; sfxVolume?: number }) {
    this.init();
    this.prefs = { music: { ...this.prefs.music, ...patch.music }, sfxVolume: patch.sfxVolume ?? this.prefs.sfxVolume };
    saveGuessrAudio(this.prefs);
    this.apply();
    this.emit();
  }

  /** Whether music should be heard now (gesture aside). */
  get audible(): boolean {
    return !!this.state && this.prefs.music.on && this.prefs.music.volume > 0 && !this.muted;
  }

  /** The state whose loop or sting is sounding (for tests and the e2e). */
  get playing(): MusicState | null {
    return this.voice?.state ?? null;
  }

  private fetchBytes(state: MusicState): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(state);
    if (!p) {
      p =
        typeof fetch === "function"
          ? fetch(`/audio/guessr/music/${MUSIC_TRACKS[state].file}.${extension()}`).then(
              (r) => (r.ok ? r.arrayBuffer() : null),
              () => null,
            )
          : Promise.resolve(null);
      this.bytes.set(state, p);
    }
    return p;
  }

  private buffer(audio: AudioContext, state: MusicState): Promise<AudioBuffer | null> {
    let p = this.decoding.get(state);
    if (!p) {
      p = this.fetchBytes(state).then(async (bytes) => {
        if (!bytes) return null;
        try {
          const b = await audio.decodeAudioData(bytes.slice(0));
          this.buffers.set(state, b);
          return b;
        } catch {
          return null;
        }
      });
      this.decoding.set(state, p);
    }
    return p;
  }

  /** Fetches (doesn't decode) the files of the states that can come next. */
  private preloadNext(state: MusicState) {
    for (const next of MUSIC_NEXT[state]) void this.fetchBytes(next);
  }

  private level(state: MusicState) {
    return MUSIC_TRACKS[state].gain * (this.pressure ? PRESSURE_DUCK : 1);
  }

  /** Makes the audio match the state, the prefs and the mute. */
  private apply() {
    const state = this.state;
    if (!this.audible || !state) {
      this.fadeOut(0.4);
      return;
    }
    const audio = liveAudio();
    if (!audio) return; // no gesture yet: the first tap calls this again
    if (this.audio !== audio || !this.master) {
      this.audio = audio;
      this.master = audio.createGain();
      this.master.connect(audio.destination);
    }
    const now = audio.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.prefs.music.volume, now, 0.05);
    this.preloadNext(state);
    if (this.voice?.state === state) return;
    if (!MUSIC_TRACKS[state].loop && this.stungFor === state) return;
    const ready = this.buffers.get(state);
    if (ready) this.start(audio, state, ready);
    else
      void this.buffer(audio, state).then((b) => {
        // Still wanted, still audible, and nothing newer started meanwhile.
        if (b && this.state === state && this.audible && this.audio === audio && this.voice?.state !== state) this.start(audio, state, b);
      });
  }

  private start(audio: AudioContext, state: MusicState, buffer: AudioBuffer) {
    const track = MUSIC_TRACKS[state];
    // A sting cuts the loop quickly; loops crossfade.
    const fade = track.loop ? CROSSFADE_S : 0.35;
    this.fadeOut(fade);
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.loop = track.loop;
    const gain = audio.createGain();
    const now = audio.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(this.level(state), now + (track.loop ? fade : 0.02));
    src.playbackRate.value = this.pressure && state === "duel" ? PRESSURE_RATE : 1;
    src.connect(gain).connect(this.master!);
    src.start(now);
    const voice: Voice = { state, src, gain };
    this.voice = voice;
    if (!track.loop) {
      this.stungFor = state;
      src.onended = () => {
        if (this.voice === voice) {
          this.voice = null;
          this.emit();
        }
      };
    }
    this.emit();
  }

  /** Ducks or restores the music, and speeds the duel loop up or back down. */
  private shape() {
    const v = this.voice;
    if (!v || !this.audio) return;
    const now = this.audio.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(this.level(v.state), now, 0.08);
    if (v.state === "duel") {
      v.src.playbackRate.cancelScheduledValues(now);
      v.src.playbackRate.setTargetAtTime(this.pressure ? PRESSURE_RATE : 1, now, 0.4);
    }
  }

  private fadeOut(seconds: number) {
    const v = this.voice;
    if (!v || !this.audio) return;
    this.voice = null;
    const now = this.audio.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + seconds);
    try {
      v.src.stop(now + seconds + 0.05);
    } catch {
      // already stopped
    }
    this.emit();
  }
}

export const guessrMusic = new GuessrMusic();
