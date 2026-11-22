import type { Beat, Chapter, Story } from "./types";

/**
 * The Story of Pokémon in another language: only the translated text of src/data/pokemon-story.json, keyed by the
 * English ids (chapters, beats, sources) and, for notes, by the English label. Lives in
 * src/data/i18n/<locale>/content/pokemon-story.json; tests/pokemon-story-i18n.test.ts keeps every file complete.
 */
export type BeatText = Partial<Pick<Beat, "lead" | "quote" | "text" | "cut">>;

export interface StoryChapterContent {
  title: string;
  when: string;
  place: string;
  tag: string;
  summary: string;
  beats: Record<string, BeatText>;
  notes: Record<string, { label: string; text: string }>;
  /** Sources whose title reads differently in this language (a work's own title stays as published). */
  sources?: Record<string, { title: string }>;
}

export interface StoryContent {
  title: string;
  tagline: string;
  intro: string;
  method: string;
  prologue: { title: string; line: string };
  chapters: Record<string, StoryChapterContent>;
}

const BEAT_FIELDS = ["lead", "quote", "text", "cut"] as const;

function localChapter(c: Chapter, t: StoryChapterContent | undefined, name: (dex: number, english: string) => string): Chapter {
  return {
    ...c,
    ...(t && { title: t.title, when: t.when, place: t.place, tag: t.tag, summary: t.summary }),
    figures: c.figures.map((f) => ({ ...f, name: name(f.dex, f.name) })),
    beats: c.beats.map((b) => {
      const tb = t?.beats[b.id];
      if (!tb) return b;
      const out = { ...b };
      for (const k of BEAT_FIELDS) if (b[k] !== undefined && tb[k]) out[k] = tb[k];
      return out;
    }),
    notes: c.notes.map((n) => {
      const tn = t?.notes[n.label];
      return tn ? { ...n, label: tn.label, text: tn.text } : n;
    }),
    sources: c.sources.map((s) => {
      const ts = t?.sources?.[s.id];
      return ts ? { ...s, title: ts.title } : s;
    }),
  };
}

/** The story with a language's text over the English (anything missing stays English), and the figures' names in that language. */
export function localizeStory(en: Story, t: StoryContent, name: (dex: number, english: string) => string = (_, n) => n): Story {
  return {
    ...en,
    title: t.title,
    tagline: t.tagline,
    intro: t.intro,
    method: t.method,
    prologue: { ...t.prologue },
    chapters: en.chapters.map((c) => localChapter(c, t.chapters[c.id], name)),
  };
}
