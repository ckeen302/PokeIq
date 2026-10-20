/**
 * Battle music: original chiptune tracks released under CC0 / CC-BY
 * (public/audio/battle/CREDITS.md), never game music. One looping track per
 * battle, a short jingle on a win.
 *
 * - Off until the player's first tap or key press on the page (browsers block
 *   autoplay before that), and silent while the site's sound is muted
 *   (MuteToggle).
 * - On / off and the volume are kept on this device.
 *
 * Browser-only; everything no-ops on the server.
 */

import { isMuted, onMuteChange } from "@/lib/sound";

export type BattleTrack = "wild" | "trainer" | "boss" | "victory";

const DIR = "/audio/battle";
const FILES: Record<BattleTrack, string> = { wild: "wild-battle", trainer: "trainer-battle", boss: "boss-battle", victory: "victory" };

export interface MusicPrefs {
  on: boolean;
  /** 0 to 1. */
  volume: number;
}

const PREFS_KEY = "pokeiq:battle:music";
export const DEFAULT_MUSIC: MusicPrefs = { on: true, volume: 0.4 };

export function loadMusicPrefs(): MusicPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<MusicPrefs>) : {};
    return {
      on: typeof p.on === "boolean" ? p.on : DEFAULT_MUSIC.on,
      volume: typeof p.volume === "number" && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULT_MUSIC.volume,
    };
  } catch {
    return DEFAULT_MUSIC;
  }
}

function saveMusicPrefs(prefs: MusicPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // kept for this page only
  }
}

/** The format the browser plays: Ogg Vorbis where it can, MP3 otherwise (Safari). */
function src(track: BattleTrack): string {
  const probe = document.createElement("audio");
  const ogg = probe.canPlayType('audio/ogg; codecs="vorbis"') !== "";
  return `${DIR}/${FILES[track]}.${ogg ? "ogg" : "mp3"}`;
}

type Listener = (state: MusicState) => void;

export interface MusicState {
  prefs: MusicPrefs;
  /** The site's sound is muted. */
  muted: boolean;
  /** The player has interacted with the page, so audio may start. */
  armed: boolean;
  /** What should be playing now (null: nothing). */
  track: BattleTrack | null;
}

/** The page's one music player. */
class MusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private current: BattleTrack | null = null;
  private listeners = new Set<Listener>();
  state: MusicState = { prefs: DEFAULT_MUSIC, muted: true, armed: false, track: null };
  private started = false;

  /** Wires up the first-interaction gate and the site's mute toggle (once). */
  init() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.state = { ...this.state, prefs: loadMusicPrefs(), muted: isMuted() };
    const arm = () => {
      window.removeEventListener("pointerdown", arm, true);
      window.removeEventListener("keydown", arm, true);
      this.set({ armed: true });
    };
    window.addEventListener("pointerdown", arm, true);
    window.addEventListener("keydown", arm, true);
    onMuteChange((muted) => this.set({ muted }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** The track the battle wants now (null: silence). */
  want(track: BattleTrack | null) {
    if (track === this.state.track) return;
    this.set({ track });
  }

  setPrefs(prefs: Partial<MusicPrefs>) {
    const next = { ...this.state.prefs, ...prefs };
    saveMusicPrefs(next);
    this.set({ prefs: next });
  }

  private set(patch: Partial<MusicState>) {
    this.state = { ...this.state, ...patch };
    this.apply();
    for (const l of this.listeners) l(this.state);
  }

  /** Makes the audio match the state. */
  private apply() {
    const { prefs, muted, armed, track } = this.state;
    const audible = !!track && prefs.on && !muted && armed && prefs.volume > 0;
    if (!audible) {
      this.audio?.pause();
      if (!track) this.current = null;
      return;
    }
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
    }
    const audio = this.audio;
    audio.volume = prefs.volume;
    if (this.current !== track) {
      this.current = track;
      audio.src = src(track!);
      audio.loop = track !== "victory";
      audio.currentTime = 0;
    }
    if (audio.paused && !(track === "victory" && audio.ended)) void audio.play().catch(() => undefined);
  }

  /** Stops everything (leaving the battle page). */
  stop() {
    this.audio?.pause();
    this.current = null;
    this.state = { ...this.state, track: null };
    for (const l of this.listeners) l(this.state);
  }
}

export const battleMusic = new MusicPlayer();
