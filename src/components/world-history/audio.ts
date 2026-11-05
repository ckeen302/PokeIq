import { CHAPTERS } from "@/lib/world-history/data";
import type { Film, FilmState, VideoPlan } from "@/lib/world-history/timing";
import * as K from "@/lib/film-sound/kit";
import type { AmbienceLevels, Bus } from "@/lib/film-sound/kit";
import { createFilmAudio, renderFilmVideo, type FilmAudio, type FilmSound } from "@/lib/film-sound/engine";

/**
 * The film's sound. The score is one theme in D minor (credited in
 * public/audio/world-history/CREDITS.md) arranged as four stems of the same
 * piece, in one key, tempo and 24-bar form, so they play together: a dark
 * bed (slow strings and choir, the theme on a solo cello and an oboe), a
 * deep layer for ruins and laboratories (a low ostinato and a drum
 * heartbeat), an icy layer for the cosmos and the snow (harp, celesta and
 * glockenspiel), and the full orchestra and choir, which swells at each
 * chapter's big moment. The cues lock to the score's grid, slow motion drops
 * the band under a held chord, the music ducks under impacts, and each
 * place has its own quiet ambience (src/lib/film-sound/). Like the site's
 * other audio it follows the sound toggle (off means no AudioContext at
 * all) and starts only from a user gesture. Videos get the same mix,
 * rendered offline.
 */

export const MUSIC = {
  bed: "/audio/world-history/theme-dark.mp3",
  cave: "/audio/world-history/theme-deep.mp3",
  ice: "/audio/world-history/theme-ice.mp3",
  epic: "/audio/world-history/theme-epic.mp3",
} as const;
export const HOLD = "/audio/world-history/theme-hold.mp3";
type Layer = keyof typeof MUSIC;
const LAYERS: Layer[] = ["bed", "cave", "ice", "epic"];

/** The score's grid: 70 bpm, a 24-bar loop. */
export const BPM = 70;
export const BEAT = 60 / BPM;
export const LOOP = 24 * 4 * BEAT;

type Hit = "boom" | "rumble" | "shimmer" | "thunder";
const MUSICAL = new Set<Hit>(["shimmer"]);
const DUCK: Partial<Record<Hit, number>> = { boom: 0.55, thunder: 0.4, rumble: 0.25 };

/** Each chapter's mix: base levels, the windows where the orchestra swells (beat id + offset, anim seconds), hits, ambience. */
interface Mood {
  bed: number;
  cave: number;
  ice: number;
  swells: [string, number, string, number][];
  hits: [Hit, string, number][];
  amb: [string, number, AmbienceLevels][];
}

export const MOODS: Record<string, Mood> = {
  creation: {
    bed: 0.55, cave: 0, ice: 0.6, swells: [["egg", 2.6, "time-space", 3], ["third", 0, "banished", 5]],
    hits: [["boom", "egg", 3.6], ["shimmer", "arceus", 0.2], ["rumble", "third", 0.4]],
    amb: [["chaos", 0, { space: 0.7 }], ["three", 0, { space: 0.45 }], ["third", 0, { space: 0.3, wind: 0.3 }]],
  },
  giants: {
    bed: 0.6, cave: 0.45, ice: 0, swells: [["towed", 0, "shaped", 0]],
    hits: [["rumble", "towed", 0.8], ["shimmer", "shaped", 0.5], ["boom", "sealed", -0.35]],
    amb: [["towed", 0, { wind: 0.5, cave: 0.2 }], ["hisui", 0, { snow: 0.55 }], ["shaped", 0, { wind: 0.4, sea: 0.25 }], ["sealed", 0, { cave: 0.6 }]],
  },
  hoenn: {
    bed: 0.45, cave: 0, ice: 0, swells: [["clash", 0, "sootopolis", 1.5], ["sootopolis", 4.6, "peace", 3]],
    hits: [["thunder", "clash", 0.6], ["boom", "rayquaza", 3], ["shimmer", "sootopolis", 6.2]],
    amb: [["clash", 0, { storm: 0.6, sea: 0.4 }], ["rayquaza", 0, { storm: 0.35, wind: 0.4 }], ["sootopolis", 0, { sea: 0.5 }], ["peace", 0, { sea: 0.45, field: 0.2 }]],
  },
  kalos: {
    bed: 0.6, cave: 0, ice: 0, swells: [["weapon", 1, "left", -1]],
    hits: [["rumble", "weapon", -0.6], ["boom", "light", -0.2], ["shimmer", "light", 4.4]],
    amb: [["war", 0, { fire: 0.35, wind: 0.4 }], ["man", 0, { wind: 0.35 }], ["weapon", 0, { cave: 0.35, wind: 0.2 }], ["light", 0, { wind: 0.3 }], ["az", 0, { wind: 0.25, city: 0.15 }]],
  },
  galar: {
    bed: 0.5, cave: 0, ice: 0, swells: [["meteorite", 0.6, "hero", -0.5], ["two", 0, "calyrex", -0.5]],
    hits: [["boom", "meteorite", 1.75], ["thunder", "storm", 0.6], ["shimmer", "two", 0]],
    amb: [["meteorite", 0, { wind: 0.45 }], ["storm", 0, { storm: 0.55 }], ["hero", 0, { forest: 0.45 }], ["calyrex", 0, { forest: 0.3, snow: 0.25 }]],
  },
  unova: {
    bed: 0.55, cave: 0, ice: 0, swells: [["split", 0, "ceased", 1], ["sons", 0, "husk", -0.5]],
    hits: [["boom", "split", 1.5], ["thunder", "sons", 0.5], ["shimmer", "husk", 1]],
    amb: [["one", 0, { wind: 0.4 }], ["split", 0, { storm: 0.4 }], ["ceased", 0, { wind: 0.3 }], ["sons", 0, { storm: 0.45 }], ["husk", 0, { wind: 0.3 }]],
  },
  kitakami: {
    bed: 0.7, cave: 0, ice: 0, swells: [["donned", 0, "thought", 0]],
    hits: [["shimmer", "masks", 0.6], ["boom", "donned", 1.6]],
    amb: [["monument", 0, { forest: 0.5, crickets: 0.2 }], ["masks", 0, { crickets: 0.45 }], ["stole", 0, { forest: 0.4 }], ["donned", 0, { fire: 0.3, crickets: 0.2 }], ["thought", 0, { crickets: 0.4 }], ["heretic", 0, { forest: 0.4 }]],
  },
  johto: {
    bed: 0.6, cave: 0.4, ice: 0, swells: [["fire", 0, "perished", 0], ["perished", 1, "flew", 5]],
    hits: [["thunder", "fire", 0.9], ["shimmer", "perished", 1.4], ["shimmer", "beasts", 0.6]],
    amb: [["alph", 0, { cave: 0.5 }], ["towers", 0, { wind: 0.4, field: 0.2 }], ["lugia", 0, { sea: 0.45 }], ["fire", 0, { fire: 0.6, rain: 0.2 }], ["perished", 0, { rain: 0.4 }], ["beasts", 0, { rain: 0.3, wind: 0.2 }], ["flew", 0, { wind: 0.4 }]],
  },
  hisui: {
    bed: 0.5, cave: 0, ice: 0.45, swells: [["rift", 0, "name", 1]],
    hits: [["boom", "rift", 1.4], ["shimmer", "creator", 0], ["boom", "creator", 2.4]],
    amb: [["era", 0, { forest: 0.5 }], ["celestica", 0, { wind: 0.4 }], ["diamond", 0, { space: 0.4 }], ["rift", 0, { storm: 0.35, space: 0.3 }], ["creator", 0, { space: 0.5 }], ["name", 0, { forest: 0.4 }]],
  },
  alola: {
    bed: 0.55, cave: 0.3, ice: 0, swells: [["islands", -1, "greed", -0.5], ["stole", 0, "z", 1]],
    hits: [["rumble", "islands", 1.5], ["boom", "stole", 1.6], ["shimmer", "tapu", 1.6]],
    amb: [["islands", 0, { sea: 0.6 }], ["greed", 0, { sea: 0.4, wind: 0.2 }], ["stole", 0, { cave: 0.4 }], ["tapu", 0, { forest: 0.5, sea: 0.2 }], ["z", 0, { sea: 0.4 }]],
  },
  kanto: {
    bed: 0.5, cave: 0.5, ice: 0, swells: [["powerful", 0.5, "created", 2]],
    hits: [["shimmer", "mew", 0], ["boom", "powerful", 1.5]],
    amb: [["jungle", 0, { forest: 0.6, rain: 0.2 }], ["mew", 0, { forest: 0.5 }], ["birth", 0, { room: 0.5 }], ["powerful", 0, { room: 0.4 }]],
  },
  paldea: {
    bed: 0.5, cave: 0.4, ice: 0, swells: [["tera", 0, "machine", 0], ["paradox", 0, "paradox", 9.5]],
    hits: [["rumble", "tera", 0], ["shimmer", "machine", 0], ["boom", "paradox", 1.2]],
    amb: [["empire", 0, { wind: 0.4, field: 0.2 }], ["treasure", 0, { cave: 0.4 }], ["united", 0, { field: 0.5 }], ["heath", 0, { wind: 0.4 }], ["tera", 0, { cave: 0.5 }], ["paradox", 0, { space: 0.3 }]],
  },
};

const smoothstep = K.smoothstep;
const blend = (a: number, b: number, k: number) => Math.sqrt(Math.max(0, a * a * (1 - k) + b * b * k));

/** Anim time of a beat in chapter `index` (the chapter's start when the beat isn't in the film). */
function beatAnim(film: Film, index: number, id: string): number {
  return film.chapters[index].beats.find((b) => b.id === id)?.anim ?? 0;
}

/** How far a slow-motion moment has dropped the band away (0..1). */
export function dropAt(film: Film, index: number, anim: number): number {
  let d = 0;
  for (const s of film.chapters[index].slow) d = Math.max(d, smoothstep(s.at - 0.25, s.at + 0.1, anim) * (1 - smoothstep(s.at + s.dur - 0.1, s.at + s.dur + 0.6, anim)));
  return d;
}

export function revealsOf(film: Film, index: number): number[] {
  const m = MOODS[CHAPTERS[index].id];
  return m ? m.swells.map(([a, da]) => beatAnim(film, index, a) + da) : [];
}

/** The mix (0..1 per layer) at a chapter moment. */
export function mixAt(film: Film, index: number, anim: number): Record<Layer, number> {
  const c = CHAPTERS[index];
  const m = MOODS[c.id];
  if (!m) return { bed: 0.7, cave: 0, ice: 0, epic: 0 };
  let epic = 0;
  for (const [a, da, b, db] of m.swells) {
    const t0 = beatAnim(film, index, a) + da, t1 = beatAnim(film, index, b) + db;
    epic = Math.max(epic, smoothstep(t0 - 1.5, t0 + 0.5, anim) * (1 - smoothstep(t1 - 0.5, t1 + 2.5, anim)));
  }
  const d = dropAt(film, index, anim);
  const bed = m.bed * (1 - epic * 0.45);
  return { bed: bed * (1 - d) + Math.max(bed, 0.55) * d, cave: m.cave * (1 - epic * 0.6) * (1 - d), ice: m.ice * (1 - epic * 0.5) * (1 - d * 0.5), epic: epic * (1 - d * 0.75) };
}

const HALL_MIX: Record<Layer, number> = { bed: 0.75, cave: 0, ice: 0.15, epic: 0 };
const HALL_AMB: AmbienceLevels = { hall: 0.5 };

/** The mix at any film state: the hall crossfades out of one chapter and into the next. */
export function mixFor(film: Film, s: FilmState): Record<Layer, number> {
  if (s.kind === "chapter") return mixAt(film, s.index, s.anim);
  const k = s.k;
  const a = s.hall.from >= 0 ? mixAt(film, s.hall.from, film.chapters[s.hall.from].anim) : HALL_MIX;
  const b = s.hall.to < film.chapters.length ? mixAt(film, s.hall.to, 0) : HALL_MIX;
  const out = {} as Record<Layer, number>;
  for (const l of LAYERS) out[l] = k < 0.5 ? blend(a[l], HALL_MIX[l], smoothstep(0, 0.5, k)) : blend(HALL_MIX[l], b[l], smoothstep(0.5, 1, k));
  return out;
}

export function ambienceAt(film: Film, index: number, anim: number): AmbienceLevels {
  const m = MOODS[CHAPTERS[index].id];
  if (!m) return {};
  let cur: AmbienceLevels = {};
  for (const [id, d, lv] of m.amb) {
    const t = beatAnim(film, index, id) + d;
    const k = smoothstep(t - 0.6, t + 0.9, anim);
    if (k <= 0) break;
    const next: AmbienceLevels = {};
    for (const key of new Set([...Object.keys(cur), ...Object.keys(lv)]) as Set<keyof AmbienceLevels>) next[key] = blend(cur[key] ?? 0, lv[key] ?? 0, k);
    cur = next;
  }
  return cur;
}

export function ambienceFor(film: Film, s: FilmState): AmbienceLevels {
  if (s.kind === "chapter") return ambienceAt(film, s.index, s.anim);
  const a = s.hall.from >= 0 ? ambienceAt(film, s.hall.from, film.chapters[s.hall.from].anim) : HALL_AMB;
  const b = s.hall.to < film.chapters.length ? ambienceAt(film, s.hall.to, 0) : HALL_AMB;
  const k = s.k;
  const from = k < 0.5 ? a : HALL_AMB, to = k < 0.5 ? HALL_AMB : b, kk = k < 0.5 ? smoothstep(0, 0.5, k) : smoothstep(0.5, 1, k);
  const out: AmbienceLevels = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)]) as Set<keyof AmbienceLevels>) out[key] = blend(from[key] ?? 0, to[key] ?? 0, kk);
  return out;
}

/** The hits of chapter `index` (anim seconds). */
export function hitsOf(film: Film, index: number): { kind: Hit; at: number }[] {
  const m = MOODS[CHAPTERS[index].id];
  return m ? m.hits.map(([kind, id, d]) => ({ kind, at: beatAnim(film, index, id) + d })) : [];
}

function playHit(b: Bus, kind: Hit, at: number, gain: number, r: K.Rand) {
  switch (kind) {
    case "boom": return K.impact(b, at, 0.34 * gain, 0.75, 0.8);
    case "rumble": return K.rumble(b, at, 0.38 * gain);
    case "thunder": return K.thunder(b, at, 0.4 * gain, r);
    case "shimmer": {
      // A form made of light: a soft rising glass chord in D minor.
      [587.33, 698.46, 880, 1174.66, 1396.9].forEach((f, i) => K.tone(b, f, at + i * 0.06, 2.4 - i * 0.2, 0.045 * gain, { attack: 0.35, wet: 0.9, pan: (i - 2) * 0.3 }));
      K.noise(b, at, { type: "highpass", f0: 6500, dur: 2, gain: 0.03 * gain, attack: 0.6, wet: 1 });
      return;
    }
  }
}

/** The 60-second cut's arc: mystery (bed and ice), the deep layer, then the full orchestra. */
function videoArc(u: number): Record<Layer, number> {
  const k = (a: number, b: number) => smoothstep(a, b, u);
  const full = k(0.6, 0.68);
  return { bed: 0.7 - 0.3 * full, cave: 0.55 * k(0.2, 0.3) * (1 - 0.5 * full), ice: 0.65 * (1 - k(0.25, 0.4)) + 0.2 * full, epic: full };
}

export const SOUND: FilmSound<Layer, Hit> = {
  music: MUSIC,
  layers: LAYERS,
  hold: HOLD,
  bpm: BPM,
  loop: LOOP,
  layerGain: { bed: 0.95, cave: 0.7, ice: 0.75, epic: 1 },
  sfxGain: 0.45,
  ambGain: 0.11,
  room: [3.2, 2.1, 0.5],
  mixFor, mixAt, ambienceFor, ambienceAt, dropAt, revealsOf, hitsOf, playHit,
  musical: MUSICAL,
  duck: DUCK,
  videoArc,
  // Bar 13, the bridge's height (about 41 s in), where the arc reaches the full orchestra.
  videoPeakBar: 12,
};

export type HistoryAudio = FilmAudio;

export function createHistoryAudio(film: Film): HistoryAudio {
  return createFilmAudio(SOUND, film);
}

/** The video's soundtrack: the same stems, hits and ambience, following the video's cuts. */
export function renderVideoAudio(film: Film, plan: VideoPlan, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  return renderFilmVideo(SOUND, film, plan, rate, signal);
}
