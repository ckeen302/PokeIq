import { CHAPTERS, filmBeats, filmLine } from "./data";
import type { Beat, Chapter } from "./types";

/** What the clock needs of a chapter (World History's chapters, or another film's with the same shape). */
export type TimedBeat = Pick<Beat, "id" | "lead" | "quote" | "text" | "cut" | "film">;
export interface TimedChapter {
  id: string;
  video: string;
  beats: TimedBeat[];
}
export interface SlowSpec { beat: string; offset: number; dur: number; rate: number }
/** A film's per-chapter pacing: extra seconds on big beats, and its slow-motion windows. */
export interface Pacing {
  extra(c: TimedChapter): Record<string, number>;
  slow(c: TimedChapter): SlowSpec[];
}

/**
 * The film's clock. Each chapter has its own animation clock ("anim"
 * seconds): a title card, then its beats, each held long enough to read.
 * Slow-motion windows play a stretch of anim time slower, so the film
 * clock (what scrolling and Play advance) runs longer than the anim clock
 * there. Chapters are joined by a walk through the museum hall: the
 * prologue opens on it, a transition glides from one exhibit's doorway to
 * the next, and the epilogue pulls back from the last. Pure math, tested.
 */

/** Seconds of title card before a chapter's first caption. */
export const TITLE_HOLD = 3;
/** Seconds after the last caption before the chapter ends. */
export const TAIL = 1.4;
export const PROLOGUE = 6.5;
export const TRANSITION = 3.2;
export const EPILOGUE = 6;

/** Reading speed for captions (characters per second) and the hold range. */
export const READ_CPS = 21;
export const MIN_BEAT = 3.4;
export const MAX_BEAT = 8.4;

/** Extra seconds on beats with a big moment in them (anim time). */
const EXTRA: Record<string, Record<string, number>> = {
  creation: { egg: 2.6, "time-space": 1.2, sleep: 0.8 },
  galar: { meteorite: 2.2, storm: 1.0, two: 1.0 },
  hoenn: { clash: 1.4, rayquaza: 2.0, sootopolis: 0.8 },
  kalos: { weapon: 2.2 },
  unova: { split: 2.2, sons: 1.0 },
  kitakami: { donned: 0.8 },
  alola: { stole: 1.6, tapu: 1.0 },
  johto: { fire: 1.6, perished: 2.0 },
  hisui: { rift: 2.0 },
  kanto: { birth: 1.2, powerful: 1.4 },
  paldea: { machine: 1.6, paradox: 2.2 },
};

/** Slow-motion windows: from `offset` s after a beat starts, `dur` anim seconds played at `rate`. */
const SLOW: Record<string, { beat: string; offset: number; dur: number; rate: number }[]> = {
  creation: [{ beat: "egg", offset: 2.4, dur: 1.8, rate: 0.4 }],
  galar: [{ beat: "meteorite", offset: 1.6, dur: 1.4, rate: 0.35 }],
  hoenn: [{ beat: "rayquaza", offset: 1.2, dur: 2.0, rate: 0.45 }],
  kalos: [{ beat: "weapon", offset: 2.2, dur: 1.6, rate: 0.4 }],
  unova: [{ beat: "split", offset: 1.4, dur: 1.8, rate: 0.4 }],
  kitakami: [],
  alola: [{ beat: "stole", offset: 1.8, dur: 1.4, rate: 0.45 }],
  johto: [{ beat: "perished", offset: 1.6, dur: 1.8, rate: 0.45 }],
  hisui: [{ beat: "rift", offset: 1.6, dur: 1.6, rate: 0.45 }],
  kanto: [{ beat: "powerful", offset: 1.5, dur: 1.2, rate: 0.45 }],
  paldea: [{ beat: "paradox", offset: 1.0, dur: 1.6, rate: 0.5 }],
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** World History's pacing (the tables above). */
export const HISTORY_PACING: Pacing = { extra: (c) => EXTRA[c.id] ?? {}, slow: (c) => SLOW[c.id] ?? [] };

/** How long a caption stays up (anim seconds). */
export function beatSeconds(b: TimedBeat): number {
  const chars = filmLine(b).length + (b.lead ? b.lead.length * 0.45 : 0);
  return clamp(1.4 + chars / READ_CPS, MIN_BEAT, MAX_BEAT);
}

export interface SlowWindow {
  /** Anim time where it starts, and its anim length. */
  at: number;
  dur: number;
  rate: number;
}

export interface BeatTime {
  id: string;
  /** Anim time the caption appears. */
  anim: number;
  /** Anim seconds it stays up. */
  hold: number;
}

export interface ChapterTime {
  id: string;
  index: number;
  /** Anim duration. */
  anim: number;
  /** Film duration (longer than anim by the slow-motion stretch). */
  film: number;
  /** Film time the chapter starts. */
  start: number;
  beats: BeatTime[];
  slow: SlowWindow[];
}

export function chapterTiming(c: TimedChapter, index = CHAPTERS.indexOf(c as Chapter), start = 0, pacing: Pacing = HISTORY_PACING): ChapterTime {
  const extra = pacing.extra(c);
  let t = TITLE_HOLD;
  const beats: BeatTime[] = filmBeats(c).map((b) => {
    const hold = beatSeconds(b) + (extra[b.id] ?? 0);
    const bt = { id: b.id, anim: t, hold };
    t += hold;
    return bt;
  });
  const anim = t + TAIL;
  const slow: SlowWindow[] = pacing.slow(c).map((s) => {
    const b = beats.find((x) => x.id === s.beat);
    if (!b) throw new Error(`world-history: ${c.id} slow motion on unknown beat ${s.beat}`);
    return { at: b.anim + s.offset, dur: s.dur, rate: s.rate };
  }).sort((a, b) => a.at - b.at);
  const film = anim + slow.reduce((sum, s) => sum + s.dur / s.rate - s.dur, 0);
  return { id: c.id, index, anim, film, start, beats, slow };
}

/** Film seconds into a chapter → its anim time. */
export function filmToAnim(ct: ChapterTime, film: number): number {
  let anim = 0, f = 0;
  for (const s of ct.slow) {
    if (film <= f + (s.at - anim)) return anim + (film - f);
    f += s.at - anim;
    anim = s.at;
    const span = s.dur / s.rate;
    if (film <= f + span) return anim + (film - f) * s.rate;
    f += span;
    anim += s.dur;
  }
  return anim + (film - f);
}

/** Anim time → film seconds into the chapter. */
export function animToFilm(ct: ChapterTime, a: number): number {
  let anim = 0, f = 0;
  for (const s of ct.slow) {
    if (a <= s.at) return f + (a - anim);
    f += s.at - anim;
    anim = s.at;
    if (a <= s.at + s.dur) return f + (a - anim) / s.rate;
    f += s.dur / s.rate;
    anim += s.dur;
  }
  return f + (a - anim);
}

/** How slow the film is running at an anim time (1 = normal). */
export function rateAt(ct: ChapterTime, a: number): number {
  const s = ct.slow.find((w) => a >= w.at && a < w.at + w.dur);
  return s ? s.rate : 1;
}

/** The caption up at an anim time (−1 during the title card). */
export function beatIndexAt(ct: ChapterTime, a: number): number {
  let i = -1;
  for (let k = 0; k < ct.beats.length; k++) if (a >= ct.beats[k].anim) i = k;
  return i;
}

export interface Transition {
  /** Chapter indices it joins (from −1: the prologue; to = count: the epilogue). */
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface Film {
  duration: number;
  chapters: ChapterTime[];
  /** Prologue, transitions between chapters, epilogue: every stretch spent in the hall. */
  halls: Transition[];
}

export function buildFilm(chapters: TimedChapter[] = CHAPTERS, pacing: Pacing = HISTORY_PACING): Film {
  let t = PROLOGUE;
  const halls: Transition[] = [{ from: -1, to: 0, start: 0, end: PROLOGUE }];
  const times: ChapterTime[] = [];
  chapters.forEach((c, i) => {
    const ct = chapterTiming(c, i, t, pacing);
    times.push(ct);
    t += ct.film;
    const last = i === chapters.length - 1;
    const dur = last ? EPILOGUE : TRANSITION;
    halls.push({ from: i, to: last ? chapters.length : i + 1, start: t, end: t + dur });
    t += dur;
  });
  return { duration: t, chapters: times, halls };
}

export type FilmState =
  | { kind: "chapter"; index: number; anim: number; film: number }
  | { kind: "hall"; hall: Transition; k: number; film: number };

/** Where the film is at film time t. */
export function filmAt(f: Film, t: number): FilmState {
  const time = clamp(t, 0, f.duration);
  for (const h of f.halls) if (time >= h.start && time < h.end) return { kind: "hall", hall: h, k: (time - h.start) / (h.end - h.start), film: time };
  for (const c of f.chapters) if (time >= c.start && time < c.start + c.film) return { kind: "chapter", index: c.index, anim: filmToAnim(c, time - c.start), film: time };
  const last = f.halls[f.halls.length - 1];
  return { kind: "hall", hall: last, k: 1, film: f.duration };
}

/** The chapter a film time belongs to for the rail and the URL: a hall counts as the chapter it leads into (the epilogue as the last). */
export function chapterAtFilm(f: Film, t: number): number {
  const s = filmAt(f, t);
  if (s.kind === "chapter") return s.index;
  return clamp(s.k < 0.5 && s.hall.from >= 0 ? s.hall.from : s.hall.to, 0, f.chapters.length - 1);
}

/** Film time a chapter's title card starts. */
export function chapterStart(f: Film, index: number): number {
  return f.chapters[clamp(index, 0, f.chapters.length - 1)].start;
}

/** Film times of every caption, in order (for ← and →). */
export function beatStops(f: Film): { chapter: number; beat: number; t: number }[] {
  const out: { chapter: number; beat: number; t: number }[] = [];
  for (const c of f.chapters) {
    out.push({ chapter: c.index, beat: -1, t: c.start });
    c.beats.forEach((b, i) => out.push({ chapter: c.index, beat: i, t: c.start + animToFilm(c, b.anim) }));
  }
  return out;
}

/** The next (dir 1) or previous (dir −1) caption from film time t. */
export function stepStop(f: Film, t: number, dir: 1 | -1): number {
  const stops = beatStops(f);
  if (dir > 0) return (stops.find((s) => s.t > t + 0.25) ?? { t: f.duration }).t;
  const prev = [...stops].reverse().find((s) => s.t < t - 0.6);
  return prev ? prev.t : 0;
}

// ---------------------------------------------------------------------------
// Scrolling: the page scrolls through the film; one screen ≈ SCREEN_SECONDS.
// ---------------------------------------------------------------------------

export const SCREEN_SECONDS = 7;

export function pxPerSecond(viewH: number): number {
  return Math.max(60, viewH / SCREEN_SECONDS);
}

/** The scroll track's height (px): the film plus one screen for the sticky stage. */
export function trackHeight(f: Film, viewH: number): number {
  return Math.ceil(f.duration * pxPerSecond(viewH) + viewH);
}

export function scrollToFilm(f: Film, scrolled: number, viewH: number): number {
  return clamp(scrolled / pxPerSecond(viewH), 0, f.duration);
}

export function filmToScroll(f: Film, t: number, viewH: number): number {
  return clamp(t, 0, f.duration) * pxPerSecond(viewH);
}

/** Eases the playhead toward where the scroll is: small gaps glide, a big jump lands in about half a second. */
export function easePlayhead(current: number, target: number, dt: number): number {
  const gap = target - current;
  if (Math.abs(gap) < 1e-4) return target;
  const k = 1 - Math.exp(-dt * (Math.abs(gap) > 12 ? 9 : 5));
  return current + gap * k;
}

// ---------------------------------------------------------------------------
// Videos: the whole story in 60 seconds, or one chapter.
// ---------------------------------------------------------------------------

export interface VideoSegment {
  chapter: number;
  /** Video seconds. */
  t0: number;
  t1: number;
  /** Anim window played across it. */
  from: number;
  to: number;
}

export interface VideoPlan {
  kind: "story" | "chapter";
  seconds: number;
  /** The hook card's end and the end card's start (video seconds). */
  hook: number;
  endAt: number;
  segments: VideoSegment[];
  /** Length of the light-burst cut between segments. */
  cut: number;
}

export const STORY_SECONDS = 60;
const HOOK = 2.6;
const END = 3.4;

/** "The entire history of the Pokémon world in 60 seconds": each chapter's big moment, quoted once. */
export function storyVideoPlan(f: Film, seconds = STORY_SECONDS, chapters: TimedChapter[] = CHAPTERS): VideoPlan {
  const n = f.chapters.length;
  const body = Math.max(n * 0.5, seconds - HOOK * 0.5 - END);
  const each = body / n;
  const segments: VideoSegment[] = f.chapters.map((ct, i) => {
    const c = chapters[i];
    const b = ct.beats.find((x) => x.id === c.video) ?? ct.beats[0];
    const from = Math.max(0, b.anim - 1.2);
    const to = Math.min(ct.anim, Math.max(from + 2, b.anim + Math.min(b.hold, 4.2)));
    const t0 = HOOK * 0.5 + i * each;
    return { chapter: i, t0, t1: t0 + each, from, to };
  });
  return { kind: "story", seconds, hook: HOOK, endAt: seconds - END, segments, cut: Math.min(0.55, each * 0.18) };
}

/** One chapter, at film speed, with a hook card over its title and an end card. */
export function chapterVideoPlan(f: Film, index: number, maxSeconds = 59): VideoPlan {
  const ct = f.chapters[index];
  const lead = 1.2;
  const length = Math.min(ct.anim, maxSeconds - lead - END);
  const seconds = lead + length + END;
  return { kind: "chapter", seconds, hook: HOOK, endAt: seconds - END, segments: [{ chapter: index, t0: 0, t1: seconds, from: -lead, to: length + END }], cut: 0 };
}

export interface VideoFrame {
  chapter: number;
  anim: number;
  /** Into the next segment during a cut. */
  next?: { chapter: number; anim: number; k: number };
}

/** What a video shows at video time t. */
export function videoAt(plan: VideoPlan, t: number): VideoFrame {
  const segs = plan.segments;
  const time = clamp(t, 0, plan.seconds);
  const found = segs.findIndex((x) => time < x.t1);
  const s = segs[found === -1 ? segs.length - 1 : found];
  const u = clamp((time - s.t0) / Math.max(1e-6, s.t1 - s.t0), 0, 1);
  // Story cuts ease each window in and out (the big moment near the middle); a chapter plays straight.
  const e = plan.kind === "story" ? u * 0.85 + 0.15 * (0.5 - 0.5 * Math.cos(Math.PI * u)) : u;
  const anim = s.from + (s.to - s.from) * e;
  const nextSeg = segs[segs.indexOf(s) + 1];
  if (plan.cut > 0 && nextSeg && time > s.t1 - plan.cut) {
    const k = (time - (s.t1 - plan.cut)) / plan.cut;
    return { chapter: s.chapter, anim, next: { chapter: nextSeg.chapter, anim: nextSeg.from, k } };
  }
  return { chapter: s.chapter, anim };
}

/** The segment a video time falls in. */
export function videoSegmentAt(plan: VideoPlan, t: number): VideoSegment {
  return plan.segments.find((s) => t < s.t1) ?? plan.segments[plan.segments.length - 1];
}
