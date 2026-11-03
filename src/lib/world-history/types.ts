/**
 * The History of the Pokémon World: the content's shape. The text itself
 * lives in src/data/world-history.json; every beat cites a source, and the
 * basis says how firmly the games state it.
 */

/**
 * How a line stands in the games:
 * - stated: the game says it outright.
 * - myth: the game tells it as myth, legend or folk tale ("it is said…").
 * - implied: not said outright, but follows closely from what is stated.
 * - theory: a character's theory or hypothesis.
 * - speculation: a character's guess.
 * - contested: the games tell it in more than one way (the note shows each).
 */
export type Basis = "stated" | "myth" | "implied" | "theory" | "speculation" | "contested";

export const BASES: Basis[] = ["stated", "myth", "implied", "theory", "speculation", "contested"];

export type SourceKind = "book" | "pokedex" | "npc" | "sign" | "journal" | "official" | "story" | "inscription" | "song";

export interface Source {
  id: string;
  /** The game the line comes from ("Pokémon Platinum"). */
  game: string;
  kind: SourceKind;
  /** Where in that game ("Canalave Library book, “The Original Story”", "Pokédex: Dialga", "Drayden"). */
  label: string;
}

export interface Beat {
  id: string;
  /** A short line of narration over the quote (accurate to the sources, in our words). */
  lead?: string;
  /** The game's own words (modern capitalisation; "\n" where the game breaks the line). */
  quote?: string;
  /** Narration instead of a quote (may quote inline). */
  text?: string;
  /** The film's caption: a shorter excerpt of the quote, in the game's own words (omissions marked "..."). */
  cut?: string;
  /** false: in the text version only, not captioned in the film. */
  film?: boolean;
  basis: Basis;
  /** A source id in the chapter's `sources`. */
  source: string;
  /** HOME art ids of the figures this beat is about. */
  figures?: number[];
}

export interface Note {
  label: string;
  text: string;
  basis: Basis;
  source?: string;
}

export interface Figure {
  /** National Pokédex number. */
  dex: number;
  /** PokéAPI id of the HOME render (the species, or a form's 10xxx id). */
  art: number;
  name: string;
}

export interface Chapter {
  id: string;
  numeral: string;
  region: string;
  title: string;
  /** When, in the sources' own words ("Thousands of years ago", "Undated"). */
  when: string;
  whenNote?: string;
  /** How the chapter is framed in-game: Myth, Legend, Folk tale or Record. */
  tag: string;
  summary: string;
  /** Hex accent. */
  accent: string;
  figures: Figure[];
  beats: Beat[];
  notes: Note[];
  sources: Source[];
  /** The beat the 60-second video quotes. */
  video: string;
}

/** The anime and films: a separate continuity, shown apart from the games' history (text version only). */
export interface ScreenLane {
  title: string;
  note: string;
  items: { film: string; text: string }[];
}

export interface WorldHistory {
  title: string;
  tagline: string;
  intro: string;
  method: string;
  chapters: Chapter[];
  screen: ScreenLane;
}

/** The caption tag a beat carries ("Myth", "Speculation"…); null for a plain record. */
export function basisTag(b: Basis, chapterTag: string): string | null {
  switch (b) {
    case "myth":
      return chapterTag === "Record" ? "Legend" : chapterTag;
    case "implied":
      return "Implied";
    case "theory":
      return "Theory";
    case "speculation":
      return "Speculation";
    case "contested":
      return "Sources differ";
    default:
      return null;
  }
}

/** "Pokémon Platinum · Canalave Library book, “The Original Story”". */
export function sourceLine(s: Source): string {
  return `${s.game} · ${s.label}`;
}
