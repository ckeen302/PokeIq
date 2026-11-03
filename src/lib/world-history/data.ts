import RAW from "@/data/world-history.json";
import type { Beat, Chapter, Source, WorldHistory } from "./types";

/** The content, typed. Pure data (no three.js): safe for server pages and tests. */
export const HISTORY = RAW as unknown as WorldHistory;
export const CHAPTERS: Chapter[] = HISTORY.chapters;
export const CHAPTER_IDS = CHAPTERS.map((c) => c.id);
const BY_ID = new Map(CHAPTERS.map((c) => [c.id, c]));

export function chapterById(id: string): Chapter | undefined {
  return BY_ID.get(id);
}

export function chapterIndex(id: string): number {
  return CHAPTER_IDS.indexOf(id);
}

export function sourceOf(chapter: Chapter, beat: Pick<Beat, "source">): Source {
  const s = chapter.sources.find((x) => x.id === beat.source);
  if (!s) throw new Error(`world-history: ${chapter.id} has no source ${beat.source}`);
  return s;
}

/** Every HOME art id the chapters show (for the art route and preloading). */
export const FIGURE_ARTS: number[] = [...new Set(CHAPTERS.flatMap((c) => c.figures.map((f) => f.art)))];

/** A quote or narration as one plain line (for metadata and the text version's summaries). */
export function beatPlain(b: Beat): string {
  return (b.quote ?? b.text ?? "").replace(/\n/g, " ").trim();
}

/** The beats the film captions (some are kept for the text version only). */
export function filmBeats(c: Chapter): Beat[] {
  return c.beats.filter((b) => b.film !== false);
}

/** What the film's caption shows: the excerpt when there is one (line breaks kept). */
export function filmLine(b: Beat): string {
  return b.cut ?? b.quote ?? b.text ?? "";
}
