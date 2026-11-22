import type { Beat, Chapter, WorldHistory } from "./types";

/**
 * The History of the Pokémon World in another language: only the translated text of src/data/world-history.json,
 * keyed by the English ids (chapters, beats, sources) and, for notes and the screen lane, by the English label or
 * film. Lives in src/data/i18n/<locale>/content/world-history.json; tests/world-history-i18n.test.ts keeps every file
 * complete. A chapter's tag (Myth, Legend, Folk tale, Record) stays English in the data: it picks the caption tags,
 * and the page shows it through the world-history-film messages.
 */
export type BeatText = Partial<Pick<Beat, "lead" | "quote" | "text" | "cut">>;

export interface HistoryChapterContent {
  region: string;
  title: string;
  when: string;
  whenNote?: string;
  summary: string;
  beats: Record<string, BeatText>;
  notes: Record<string, { label: string; text: string }>;
  sources: Record<string, { game: string; label: string }>;
}

export interface HistoryContent {
  title: string;
  tagline: string;
  intro: string;
  method: string;
  screen: { title: string; note: string; items: Record<string, { film: string; text: string }> };
  chapters: Record<string, HistoryChapterContent>;
}

const BEAT_FIELDS = ["lead", "quote", "text", "cut"] as const;

function localChapter(c: Chapter, t: HistoryChapterContent | undefined, name: (dex: number, english: string) => string): Chapter {
  return {
    ...c,
    ...(t && { region: t.region, title: t.title, when: t.when, summary: t.summary }),
    ...(t && c.whenNote !== undefined && t.whenNote && { whenNote: t.whenNote }),
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
      const ts = t?.sources[s.id];
      return ts ? { ...s, game: ts.game, label: ts.label } : s;
    }),
  };
}

/** The history with a language's text over the English (anything missing stays English), and the figures' names in that language. */
export function localizeHistory(en: WorldHistory, t: HistoryContent, name: (dex: number, english: string) => string = (_, n) => n): WorldHistory {
  return {
    ...en,
    title: t.title,
    tagline: t.tagline,
    intro: t.intro,
    method: t.method,
    screen: {
      title: t.screen.title,
      note: t.screen.note,
      items: en.screen.items.map((i) => t.screen.items[i.film] ?? i),
    },
    chapters: en.chapters.map((c) => localChapter(c, t.chapters[c.id], name)),
  };
}
