/**
 * The Story of Pokémon: the content's shape. The text lives in
 * src/data/pokemon-story.json; every beat cites a source, and its basis
 * says how it is known.
 */

/**
 * How a line is known:
 * - record: a dated, documented fact (a release, a founding).
 * - said: something a creator said in an interview.
 * - reported: reported by the press or a biography.
 * - retold: widely repeated, in versions that differ (the caption says "the story goes…").
 * - line: the film's own narration, a callback or a title, resting on the beats around it.
 */
export type Basis = "record" | "said" | "reported" | "retold" | "line";

export const BASES: Basis[] = ["record", "said", "reported", "retold", "line"];

export type SourceKind = "interview" | "official" | "press" | "reference";

export interface Source {
  id: string;
  /** Who published it ("TIME", "The Pokémon Company"). */
  publisher: string;
  /** What it is ("“The Ultimate Game Freak”, interview with Satoshi Tajiri"). */
  title: string;
  year: string;
  kind: SourceKind;
  url: string;
}

/** A date a beat states, and (for releases) the Pokémon Timeline entry it must match. */
export interface BeatDate {
  date: string;
  timeline?: string;
  field?: "jp" | "na" | "eu";
}

export interface Beat {
  id: string;
  /** Narration over a quote. */
  lead?: string;
  /** Someone's own words, verbatim. */
  quote?: string;
  /** Narration (when there's no quote). */
  text?: string;
  cut?: string;
  film?: boolean;
  basis: Basis;
  source: string;
  dates?: BeatDate[];
  /** HOME art ids of the Pokémon this beat shows. */
  figures?: number[];
}

export interface Note {
  label: string;
  text: string;
  basis: Basis;
  source?: string;
}

export interface Figure {
  dex: number;
  art: number;
  name: string;
}

export interface Chapter {
  id: string;
  numeral: string;
  title: string;
  when: string;
  /** The year on its hall plaque ("1996"). */
  year: string;
  place: string;
  tag: string;
  summary: string;
  accent: string;
  figures: Figure[];
  beats: Beat[];
  notes: Note[];
  sources: Source[];
  /** The beat the 60-second video shows. */
  video: string;
  /** Its slow-motion moment, and extra seconds on its big beats. */
  slow: { beat: string; offset: number; dur: number; rate: number }[];
  extra: Record<string, number>;
}

export interface Story {
  title: string;
  tagline: string;
  intro: string;
  method: string;
  prologue: { title: string; line: string };
  chapters: Chapter[];
}

/** The caption tag a beat carries; null when it needs none. */
export function basisTag(b: Basis): string | null {
  switch (b) {
    case "said":
      return "In their words";
    case "reported":
      return "Reported";
    case "retold":
      return "As it's told";
    default:
      return null;
  }
}

/** "TIME · “The Ultimate Game Freak”, interview with Satoshi Tajiri (1999)". */
export function sourceLine(s: Source): string {
  return `${s.publisher} · ${s.title} (${s.year})`;
}
