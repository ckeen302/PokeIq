import { CHAPTERS } from "@/lib/pokemon-story/data";
import type { Film, FilmState, VideoPlan } from "@/lib/world-history/timing";
import * as K from "@/lib/film-sound/kit";
import type { AmbienceLevels, Bus } from "@/lib/film-sound/kit";
import { createFilmAudio, renderFilmVideo, type FilmAudio, type FilmSound } from "@/lib/film-sound/engine";

/**
 * The Story's sound. The score is one theme (credited in
 * public/audio/pokemon-story/CREDITS.md) arranged six ways in the same key,
 * tempo and 24-bar form, so the stems play together as layers and each
 * chapter's mix decides how the theme sounds: curious on celesta and music
 * box at the start, eight-bit in the Game Boy years, warm on strings and
 * horn in the middle, full orchestra at each big moment, and solo piano at
 * the close. The cues lock to the score's beat grid: a riser peaks on each
 * reveal (on the nearest eighth note), the chimes land on the next
 * sixteenth, every slow-motion moment drops the band away under a held
 * chord, and the music ducks under each impact. Under it all, each scene has
 * its own layered ambience and foley (src/lib/film-sound/kit.ts). It follows
 * the site's sound toggle (off means no AudioContext at all) and starts only
 * from a user gesture; videos get the same mix, rendered offline.
 */

export const MUSIC = {
  bed: "/audio/pokemon-story/theme-piano.mp3",
  curious: "/audio/pokemon-story/theme-curious.mp3",
  bright: "/audio/pokemon-story/theme-chip.mp3",
  drive: "/audio/pokemon-story/theme-band.mp3",
  warm: "/audio/pokemon-story/theme-warm.mp3",
  swell: "/audio/pokemon-story/theme-full.mp3",
} as const;
/** The held chord under each slow-motion moment (a one-shot). */
export const HOLD = "/audio/pokemon-story/theme-hold.mp3";
type Layer = keyof typeof MUSIC;
const LAYERS: Layer[] = ["bed", "curious", "bright", "drive", "warm", "swell"];

/** The score's grid: 84 bpm, a 24-bar loop. */
export const BPM = 84;
export const BEAT = 60 / BPM;
export const LOOP = 24 * 4 * BEAT;

export type Hit =
  | "chime" | "boom" | "roar" | "blip" | "whoosh" | "rumble" | "sparkle" | "wind" | "click" | "spawn" | "coin"
  | "paper" | "page" | "pen" | "cartridge" | "cable" | "steps" | "card" | "pop" | "splash" | "thud" | "glass";
export const HITS: Hit[] = ["chime", "boom", "roar", "blip", "whoosh", "rumble", "sparkle", "wind", "click", "spawn", "coin", "paper", "page", "pen", "cartridge", "cable", "steps", "card", "pop", "splash", "thud", "glass"];
/** Musical hits wait for the next sixteenth note; the rest land on the frame. */
const MUSICAL = new Set<Hit>(["chime", "sparkle", "spawn", "coin", "blip", "glass"]);
/** How far each hit ducks the music (0..1). */
const DUCK: Partial<Record<Hit, number>> = { boom: 0.55, thud: 0.25, roar: 0.3, rumble: 0.25, splash: 0.2 };

/** Each chapter's mix: base levels, the swell windows (beat + offset → beat + offset, anim seconds), hits, and its ambience (from a beat + offset on). */
export interface Mood {
  bed: number;
  curious: number;
  bright: number;
  drive: number;
  warm: number;
  swells: [string, number, string, number][];
  hits: [Hit, string, number][];
  amb: [string, number, AmbienceLevels][];
}

export const MOODS: Record<string, Mood> = {
  collector: {
    bed: 0.55, curious: 0.85, bright: 0, drive: 0, warm: 0.15, swells: [["jar", 0, "jar", 5]],
    hits: [["chime", "jar", 1.2], ["wind", "paved", 0.3], ["sparkle", "kept", 2.4]],
    amb: [["fields", 0, { field: 0.75 }], ["dr-bug", 0, { field: 0.7, forest: 0.35 }], ["learned", 1.5, { field: 0.4, crickets: 0.55 }], ["jar", 0, { crickets: 0.6, field: 0.25 }], ["paved", 0.5, { city: 0.45, wind: 0.35 }], ["kept", 0, { wind: 0.35, city: 0.2, crickets: 0.12 }]],
  },
  "game-freak": {
    bed: 0.45, curious: 0.35, bright: 0.6, drive: 0, warm: 0, swells: [["studio", 0, "studio", 5]],
    hits: [["coin", "arcade", 0.8], ["paper", "pages", 0.7], ["chime", "studio", 1.8]],
    amb: [["arcade", 0, { arcade: 0.75 }], ["zine", 0, { room: 0.6, rain: 0.28 }], ["studio", 1.5, { room: 0.4, hall: 0.2 }]],
  },
  cable: {
    bed: 0.6, curious: 0.25, bright: 0.45, drive: 0, warm: 0.2, swells: [["crawl", 0.5, "pitch", 3]],
    hits: [["cartridge", "game-boy", 0.6], ["blip", "crawl", 0.9], ["chime", "name", 1.6]],
    amb: [["game-boy", 0, { room: 0.6 }], ["crawl", 0, { room: 0.45 }], ["pitch", 0, { room: 0.6, rain: 0.15 }]],
  },
  "six-years": {
    bed: 0.75, curious: 0.15, bright: 0.12, drive: 0, warm: 0.3, swells: [["151", 0.4, "151", 6]],
    hits: [["rumble", "hard", 0.3], ["chime", "pikachu", 2], ["boom", "151", 1.2], ["sparkle", "mew", 1.2]],
    amb: [["hard", 0, { room: 0.6, rain: 0.32 }], ["masuda", 0, { room: 0.6, rain: 0.2 }], ["151", 0, { room: 0.35 }], ["mew", 0, { room: 0.45 }]],
  },
  "red-green": {
    bed: 0.45, curious: 0.2, bright: 0.65, drive: 0.12, warm: 0.3, swells: [["three", 0.4, "mew-rumour", 1.5]],
    hits: [["boom", "launch", 0.4], ["chime", "three", 1.2], ["sparkle", "mew-rumour", 0.6]],
    amb: [["launch", 1.2, { field: 0.6, forest: 0.25 }], ["three", 0, { field: 0.35 }], ["mew-rumour", 0, { field: 0.55 }], ["word", 0, { crickets: 0.5, field: 0.2 }], ["blue", 0, { field: 0.3 }]],
  },
  pokemania: {
    bed: 0.25, curious: 0, bright: 0.5, drive: 0.75, warm: 0.15, swells: [["world", 0, "catch", 3]],
    hits: [["whoosh", "cards", 0.4], ["click", "anime", 0.2], ["roar", "world", 1.5], ["boom", "catch", 0.1]],
    amb: [["cards", 0, { room: 0.2 }], ["anime", 0, { room: 0.55 }], ["company", 0, { crowd: 0.6, city: 0.3 }], ["movie", 0, { cinema: 0.75 }], ["world", 0, { crowd: 0.35, space: 0.25 }], ["catch", 0, { crowd: 0.2 }]],
  },
  growing: {
    bed: 0.45, curious: 0.1, bright: 0.2, drive: 0.55, warm: 0.5, swells: [["online", 0.5, "online", 6], ["fresh", 1, "fresh", 7]],
    hits: [["whoosh", "colour", 0], ["whoosh", "online", 0], ["roar", "worlds", 1], ["whoosh", "fresh", 0]],
    amb: [["clock", 0, { wind: 0.4, crickets: 0.25 }], ["colour", 0, { sea: 0.7, wind: 0.2 }], ["online", 0.5, { space: 0.7 }], ["worlds", 0, { stadium: 0.7 }], ["fresh", 0, { city: 0.5, wind: 0.2 }]],
  },
  together: {
    bed: 0.3, curious: 0.1, bright: 0.25, drive: 0.7, warm: 0.5, swells: [["same-day", 1, "fold", 5], ["alola", 1.5, "alola", 7]],
    hits: [["chime", "fold", 1.2], ["sparkle", "outbreak", 0.8], ["splash", "alola", 0.6]],
    amb: [["same-day", 0, { space: 0.55 }], ["fold", 0, { space: 0.2, room: 0.2 }], ["outbreak", 0, { crowd: 0.6, sea: 0.25 }], ["twenty", 0, { room: 0.5 }], ["alola", 0.6, { underwater: 0.75 }], ["alola", 3.2, { sea: 0.65, field: 0.2 }]],
  },
  outside: {
    bed: 0.65, curious: 0.2, bright: 0.45, drive: 0.75, warm: 0.6, swells: [["parks", 0, "outside", 8]],
    hits: [["spawn", "wild", 0.6], ["spawn", "wild", 1.8], ["spawn", "wild", 3.0], ["chime", "outside", 3.2]],
    amb: [["april", 0, { room: 0.3 }], ["launch", 0.4, { city: 0.6 }], ["parks", 0, { city: 0.4, crowd: 0.45 }], ["wild", 0, { city: 0.3, crickets: 0.35 }], ["together", 0, { crowd: 0.7 }], ["outside", 0, { city: 0.35, crickets: 0.35 }]],
  },
  "open-worlds": {
    bed: 0.3, curious: 0, bright: 0.2, drive: 0.75, warm: 0.55, swells: [["open", 0, "open", 6], ["champion", 0, "farewell", 1]],
    hits: [["roar", "galar", 0.8], ["whoosh", "hisui", 0], ["boom", "champion", 1.0], ["chime", "farewell", 2.2]],
    amb: [["home", 0, { field: 0.6, forest: 0.2 }], ["galar", 0, { stadium: 0.8 }], ["twenty-five", 0, { stadium: 0.2 }], ["hisui", 0, { forest: 0.55, wind: 0.25 }], ["open", 0, { wind: 0.7 }], ["champion", 0, { stadium: 0.7 }], ["champion", 1.8, { stadium: 0.04 }], ["farewell", 0, { field: 0.4, crickets: 0.3 }], ["lumiose", 0, { city: 0.6 }]],
  },
  thirty: {
    bed: 0.85, curious: 0.15, bright: 0.15, drive: 0.3, warm: 0.3, swells: [["now", 1, "yours", 12]],
    hits: [["cartridge", "then", 0.6], ["chime", "thousand", 1.4], ["boom", "yours", 4.2]],
    amb: [["thirty", 0, { hall: 0.4, sea: 0.25, wind: 0.2 }], ["then", 0, { room: 0.6 }], ["now", 0.6, { wind: 0.3, city: 0.2 }], ["thousand", 0, { space: 0.6 }], ["yours", 1, { field: 0.6, crickets: 0.4 }]],
  },
};

const smoothstep = K.smoothstep;

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

/** The swell windows' starts (the reveals), anim seconds. */
export function revealsOf(film: Film, index: number): number[] {
  const m = MOODS[CHAPTERS[index].id];
  return m ? m.swells.map(([a, da]) => beatAnim(film, index, a) + da) : [];
}

/** The mix (0..1 per layer) at a chapter moment. */
export function mixAt(film: Film, index: number, anim: number): Record<Layer, number> {
  const c = CHAPTERS[index];
  const m = MOODS[c.id];
  if (!m) return { bed: 0.7, curious: 0, bright: 0, drive: 0, warm: 0, swell: 0 };
  let epic = 0;
  for (const [a, da, b, db] of m.swells) {
    const t0 = beatAnim(film, index, a) + da, t1 = beatAnim(film, index, b) + db;
    epic = Math.max(epic, smoothstep(t0 - 1.5, t0 + 0.5, anim) * (1 - smoothstep(t1 - 0.5, t1 + 2.5, anim)));
  }
  // The slow-motion drop: rhythm and sparkle fall away, the theme thins to its bed.
  const d = dropAt(film, index, anim);
  const bed = m.bed * (1 - epic * 0.35);
  return {
    // Under the drop the piano comes forward and carries the theme alone.
    bed: bed * (1 - d) + Math.max(bed, 0.55) * d,
    curious: m.curious * (1 - epic * 0.6) * (1 - d * 0.7),
    bright: m.bright * (1 - epic * 0.45) * (1 - d),
    drive: m.drive * (1 - epic * 0.2) * (1 - d),
    warm: m.warm * (1 - epic * 0.3) * (1 - d * 0.5),
    swell: epic * (1 - d * 0.75),
  };
}

/** The Archive between chapters: the piano and a little celesta. */
const HALL_MIX: Record<Layer, number> = { bed: 0.8, curious: 0.3, bright: 0, drive: 0, warm: 0.1, swell: 0 };
const HALL_AMB: AmbienceLevels = { hall: 0.55 };

/** Equal-power blend of two levels. */
const blend = (a: number, b: number, k: number) => Math.sqrt(Math.max(0, a * a * (1 - k) + b * b * k));

/** The mix at any film state: the hall crossfades out of one chapter's mix and into the next. */
export function mixFor(film: Film, s: FilmState): Record<Layer, number> {
  if (s.kind === "chapter") return mixAt(film, s.index, s.anim);
  const k = s.k;
  const a = s.hall.from >= 0 ? mixAt(film, s.hall.from, film.chapters[s.hall.from].anim) : HALL_MIX;
  const b = s.hall.to < film.chapters.length ? mixAt(film, s.hall.to, 0) : HALL_MIX;
  const out = {} as Record<Layer, number>;
  for (const l of LAYERS) out[l] = k < 0.5 ? blend(a[l], HALL_MIX[l], smoothstep(0, 0.5, k)) : blend(HALL_MIX[l], b[l], smoothstep(0.5, 1, k));
  return out;
}

/** The ambience at a chapter moment: each step crossfades in over about a second and a half. */
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

// ---------------------------------------------------------------------------
// Synthesis (shared by the live mix and the offline render)
// ---------------------------------------------------------------------------

function playHit(b: Bus, kind: Hit, at: number, gain: number, r: K.Rand) {
  switch (kind) {
    case "boom": return K.impact(b, at, 0.9 * gain, 1, 1);
    case "thud": return K.impact(b, at, 0.45 * gain, 0.35, 0);
    case "rumble": return K.rumble(b, at, gain);
    case "roar": return K.roar(b, at, gain);
    case "whoosh": return K.whoosh(b, at, gain);
    case "wind": return K.gust(b, at, gain);
    case "blip": return K.blip(b, at, gain);
    case "coin": return K.coin(b, at, gain);
    case "click": return K.tv(b, at, gain);
    case "spawn": return K.spawn(b, at, gain);
    case "chime": return K.chime(b, at, gain);
    case "sparkle": return K.sparkle(b, at, gain, r);
    case "paper": return K.paper(b, at, gain, r);
    case "page": return K.page(b, at, gain);
    case "pen": return K.pen(b, at, gain, r);
    case "cartridge": return K.cartridge(b, at, gain);
    case "cable": return K.cable(b, at, gain);
    case "steps": return K.footsteps(b, at, 4, 0.42, gain, r);
    case "card": return K.card(b, at, gain);
    case "pop":
      K.noise(b, at, { type: "highpass", f0: 2000, dur: 0.04, gain: 0.2 * gain, attack: 0.001, wet: 0.3 });
      return K.tone(b, 520, at, 0.18, 0.12 * gain, { f2: 1250, attack: 0.003, wet: 0.5 });
    case "splash":
      K.noise(b, at, { color: "pink", type: "lowpass", f0: 5000, f1: 400, dur: 1.4, gain: 0.45 * gain, attack: 0.01, wet: 0.5 });
      for (let i = 0; i < 6; i++) { const f = 400 + r() * 600; K.tone(b, f, at + 0.2 + i * 0.09, 0.07, 0.04 * gain, { f2: f * 2.4, wet: 0.6, pan: r() - 0.5 }); }
      return;
    case "glass":
      // A jar's rim: two bright partials and a short ring.
      [2793.8, 4186, 5587.6].forEach((f, i) => K.tone(b, f, at + i * 0.004, 1.6 - i * 0.4, 0.04 * gain, { wet: 0.7, pan: 0.2 }));
      return;
  }
}

export const SOUND: FilmSound<Layer, Hit> = {
  music: MUSIC,
  layers: LAYERS,
  hold: HOLD,
  bpm: BPM,
  loop: LOOP,
  layerGain: { bed: 0.62, curious: 0.6, bright: 0.42, drive: 0.5, warm: 0.6, swell: 0.82 },
  // Hits and foley sit well under the music, the ambience lower still.
  sfxGain: 0.42,
  ambGain: 0.2,
  room: [2.6, 2.4, 0.6],
  mixFor, mixAt, ambienceFor, ambienceAt, dropAt, revealsOf, hitsOf, playHit,
  musical: MUSICAL,
  duck: DUCK,
  videoArc,
  videoPeakBar: 16,
};

/** The 60-second cut's arc: curious, then the Game Boy years, then warm, then the full theme as A' returns (bar 17). */
function videoArc(u: number): Record<Layer, number> {
  const k = (a: number, b: number) => smoothstep(a, b, u);
  const early = 1 - k(0.16, 0.24), chip = k(0.14, 0.22) * (1 - k(0.44, 0.52)), warm = k(0.42, 0.5), full = k(0.68, 0.76);
  return {
    bed: 0.7 - 0.35 * full,
    curious: 0.85 * early + 0.2 * chip,
    bright: 0.6 * chip + 0.2 * warm * (1 - full),
    drive: 0.65 * k(0.18, 0.26) * (1 - 0.3 * full),
    warm: 0.75 * warm * (1 - 0.35 * full),
    swell: full,
  };
}

export type StoryAudio = FilmAudio;

export function createStoryAudio(film: Film): StoryAudio {
  return createFilmAudio(SOUND, film);
}

/** The video's soundtrack: the same stems, hits and ambience, following the video's cuts. */
export function renderVideoAudio(film: Film, plan: VideoPlan, rate: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  return renderFilmVideo(SOUND, film, plan, rate, signal);
}
