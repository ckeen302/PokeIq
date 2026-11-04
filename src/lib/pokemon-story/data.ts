import RAW from "@/data/pokemon-story.json";
import type { Pacing } from "@/lib/world-history/timing";
import type { Beat, Chapter, Source, Story } from "./types";

/** The content, typed. Pure data (no three.js): safe for server pages and tests. */
export const STORY = RAW as unknown as Story;
export const CHAPTERS: Chapter[] = STORY.chapters;
export const CHAPTER_IDS = CHAPTERS.map((c) => c.id);
const BY_ID = new Map(CHAPTERS.map((c) => [c.id, c]));

export function chapterById(id: string): Chapter | undefined {
  return BY_ID.get(id);
}

export function sourceOf(chapter: Chapter, beat: Pick<Beat, "source">): Source {
  const s = chapter.sources.find((x) => x.id === beat.source);
  if (!s) throw new Error(`pokemon-story: ${chapter.id} has no source ${beat.source}`);
  return s;
}

/** Every HOME art id the film shows (for the art route and preloading). */
export const FIGURE_ARTS: number[] = [...new Set(CHAPTERS.flatMap((c) => c.figures.map((f) => f.art)))];

/** A beat as one plain line (lead and words). */
export function beatPlain(b: Beat): string {
  return [b.lead, b.quote ?? b.text].filter(Boolean).join(" ").replace(/\n/g, " ").trim();
}

/** The film's pacing comes from the data: each chapter's slow motion and extra beat time. */
export const STORY_PACING: Pacing = {
  extra: (c) => BY_ID.get(c.id)?.extra ?? {},
  slow: (c) => BY_ID.get(c.id)?.slow ?? [],
};
