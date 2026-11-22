import { describe, expect, it } from "vitest";
import { OTHER_LOCALES, type OtherLocale } from "@/i18n/config";
import { STORY } from "@/lib/pokemon-story/data";
import { HISTORY } from "@/lib/world-history/data";
import { localizeStory, type StoryContent } from "@/lib/pokemon-story/content";
import { localizeHistory, type HistoryContent } from "@/lib/world-history/content";
import { BASES as STORY_BASES, basisTag as storyTag, basisTagKey as storyTagKey } from "@/lib/pokemon-story/types";
import { BASES as HISTORY_BASES, basisTag as historyTag, basisTagKey as historyTagKey, chapterTagKey } from "@/lib/world-history/types";
import storyFilmEn from "@/messages/en/pokemon-story-film.json";
import historyFilmEn from "@/messages/en/world-history-film.json";
import jaStory from "@/data/i18n/ja/content/pokemon-story.json";
import esStory from "@/data/i18n/es/content/pokemon-story.json";
import frStory from "@/data/i18n/fr/content/pokemon-story.json";
import deStory from "@/data/i18n/de/content/pokemon-story.json";
import itStory from "@/data/i18n/it/content/pokemon-story.json";
import jaHistory from "@/data/i18n/ja/content/world-history.json";
import esHistory from "@/data/i18n/es/content/world-history.json";
import frHistory from "@/data/i18n/fr/content/world-history.json";
import deHistory from "@/data/i18n/de/content/world-history.json";
import itHistory from "@/data/i18n/it/content/world-history.json";

// The 3D Lab's two films in other languages: each language's content file (src/data/i18n/<locale>/content/) holds
// exactly the English data's text fields, keyed by id, so no chapter, beat, note or source is missing or left over.
const STORIES: Record<OtherLocale, StoryContent> = { ja: jaStory, es: esStory, fr: frStory, de: deStory, it: itStory };
const HISTORIES: Record<OtherLocale, HistoryContent> = { ja: jaHistory, es: esHistory, fr: frHistory, de: deHistory, it: itHistory };
const BEAT_FIELDS = ["lead", "quote", "text", "cut"] as const;
const sorted = (xs: Iterable<string>) => [...xs].sort();
const filled = (s: unknown) => typeof s === "string" && s.trim().length > 0;

/** Strings of a content file, for the site-wide word rules. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

describe.each(OTHER_LOCALES)("The Story of Pokémon in %s", (locale) => {
  const t = STORIES[locale];
  it("translates the story's own text", () => {
    for (const k of ["title", "tagline", "intro", "method"] as const) expect(filled(t[k]), k).toBe(true);
    expect(filled(t.prologue.title) && filled(t.prologue.line)).toBe(true);
  });
  it("covers every chapter, and nothing else", () => {
    expect(sorted(Object.keys(t.chapters))).toEqual(sorted(STORY.chapters.map((c) => c.id)));
  });
  it.each(STORY.chapters.map((c) => [c.id, c] as const))("chapter %s: every beat, note and field", (id, c) => {
    const tc = t.chapters[id];
    for (const k of ["title", "when", "place", "tag", "summary"] as const) expect(filled(tc[k]), `${id}.${k}`).toBe(true);
    expect(sorted(Object.keys(tc.beats)), `${id} beats`).toEqual(sorted(c.beats.map((b) => b.id)));
    for (const b of c.beats) {
      const has = BEAT_FIELDS.filter((f) => b[f] !== undefined);
      expect(sorted(Object.keys(tc.beats[b.id])), `${id}/${b.id}`).toEqual(sorted(has));
      for (const f of has) expect(filled(tc.beats[b.id][f]), `${id}/${b.id}.${f}`).toBe(true);
    }
    expect(sorted(Object.keys(tc.notes)), `${id} notes`).toEqual(sorted(c.notes.map((n) => n.label)));
    for (const n of Object.values(tc.notes)) expect(filled(n.label) && filled(n.text)).toBe(true);
    // Sources: only the ones whose title reads differently (a work's own title stays as published).
    for (const sid of Object.keys(tc.sources ?? {})) expect(c.sources.map((s) => s.id), `${id} source ${sid}`).toContain(sid);
  });
  it("keeps the line breaks the film's captions rely on", () => {
    for (const c of STORY.chapters)
      for (const b of c.beats)
        for (const f of BEAT_FIELDS) {
          const en = b[f];
          if (en === undefined) continue;
          expect((t.chapters[c.id].beats[b.id][f] ?? "").split("\n").length, `${c.id}/${b.id}.${f}`).toBe(en.split("\n").length);
        }
  });
  it("localizes over the English data without changing anything else", () => {
    const l = localizeStory(STORY, t, (dex) => `#${dex}`);
    expect(l.chapters.map((c) => c.id)).toEqual(STORY.chapters.map((c) => c.id));
    l.chapters.forEach((c, i) => {
      const en = STORY.chapters[i];
      expect(c.title).toBe(t.chapters[c.id].title);
      expect(c.beats.map((b) => [b.id, b.basis, b.source, b.film, b.dates])).toEqual(en.beats.map((b) => [b.id, b.basis, b.source, b.film, b.dates]));
      expect(c.sources.map((s) => [s.id, s.publisher, s.year, s.url])).toEqual(en.sources.map((s) => [s.id, s.publisher, s.year, s.url]));
      expect(c.figures.map((f) => f.name)).toEqual(en.figures.map((f) => `#${f.dex}`));
      expect([c.numeral, c.accent, c.year, c.video]).toEqual([en.numeral, en.accent, en.year, en.video]);
    });
    expect(STORY.chapters[0].title).toBe("The Collector");
  });
  it("follows the site's word rules", () => {
    for (const s of strings(t)) expect(s).not.toMatch(/olymp|olímpic|オリンピック/i);
  });
});

describe.each(OTHER_LOCALES)("The History of the Pokémon World in %s", (locale) => {
  const t = HISTORIES[locale];
  it("translates the history's own text and the screen lane", () => {
    for (const k of ["title", "tagline", "intro", "method"] as const) expect(filled(t[k]), k).toBe(true);
    expect(filled(t.screen.title) && filled(t.screen.note)).toBe(true);
    expect(sorted(Object.keys(t.screen.items))).toEqual(sorted(HISTORY.screen.items.map((i) => i.film)));
    for (const i of Object.values(t.screen.items)) expect(filled(i.film) && filled(i.text)).toBe(true);
  });
  it("covers every chapter, and nothing else", () => {
    expect(sorted(Object.keys(t.chapters))).toEqual(sorted(HISTORY.chapters.map((c) => c.id)));
  });
  it.each(HISTORY.chapters.map((c) => [c.id, c] as const))("chapter %s: every beat, note, source and field", (id, c) => {
    const tc = t.chapters[id];
    for (const k of ["region", "title", "when", "summary"] as const) expect(filled(tc[k]), `${id}.${k}`).toBe(true);
    expect(filled(tc.whenNote), `${id}.whenNote`).toBe(c.whenNote !== undefined);
    expect(sorted(Object.keys(tc.beats)), `${id} beats`).toEqual(sorted(c.beats.map((b) => b.id)));
    for (const b of c.beats) {
      const has = BEAT_FIELDS.filter((f) => b[f] !== undefined);
      expect(sorted(Object.keys(tc.beats[b.id])), `${id}/${b.id}`).toEqual(sorted(has));
      for (const f of has) expect(filled(tc.beats[b.id][f]), `${id}/${b.id}.${f}`).toBe(true);
    }
    expect(sorted(Object.keys(tc.notes)), `${id} notes`).toEqual(sorted(c.notes.map((n) => n.label)));
    expect(sorted(Object.keys(tc.sources)), `${id} sources`).toEqual(sorted(c.sources.map((s) => s.id)));
    for (const s of Object.values(tc.sources)) expect(filled(s.game) && filled(s.label)).toBe(true);
  });
  it("keeps the journals' line breaks (the film's captions and the Kanto pages draw them)", () => {
    for (const c of HISTORY.chapters)
      for (const b of c.beats)
        for (const f of BEAT_FIELDS) {
          const en = b[f];
          if (en === undefined) continue;
          expect((t.chapters[c.id].beats[b.id][f] ?? "").split("\n").length, `${c.id}/${b.id}.${f}`).toBe(en.split("\n").length);
        }
  });
  it("localizes over the English data without changing anything else", () => {
    const l = localizeHistory(HISTORY, t, (dex) => `#${dex}`);
    l.chapters.forEach((c, i) => {
      const en = HISTORY.chapters[i];
      expect(c.id).toBe(en.id);
      expect(c.region).toBe(t.chapters[c.id].region);
      // The tag picks the caption tags: it stays English (the page shows it through messages).
      expect(c.tag).toBe(en.tag);
      expect(c.beats.map((b) => [b.id, b.basis, b.source, b.film])).toEqual(en.beats.map((b) => [b.id, b.basis, b.source, b.film]));
      expect(c.sources.map((s) => [s.id, s.kind])).toEqual(en.sources.map((s) => [s.id, s.kind]));
      expect(c.figures.map((f) => f.name)).toEqual(en.figures.map((f) => `#${f.dex}`));
    });
    expect(l.screen.items.map((i) => i.film)).toEqual(HISTORY.screen.items.map((i) => t.screen.items[i.film].film));
    expect(HISTORY.chapters[0].title).toBe("The Original One");
  });
  it("follows the site's word rules", () => {
    for (const s of strings(t)) expect(s).not.toMatch(/olymp|olímpic|オリンピック/i);
  });
});

describe("Caption tags as message keys", () => {
  it("say in English exactly what basisTag said", () => {
    for (const b of STORY_BASES) {
      const k = storyTagKey(b);
      expect(k ? storyFilmEn.tags[k] : null).toBe(storyTag(b));
    }
    for (const tag of ["Myth", "Legend", "Folk tale", "Record"])
      for (const b of HISTORY_BASES) {
        const k = historyTagKey(b, tag);
        expect(k ? historyFilmEn.tags[k] : null, `${b}/${tag}`).toBe(historyTag(b, tag));
      }
    for (const c of HISTORY.chapters) expect(historyFilmEn.chapterTag[chapterTagKey(c.tag)]).toBe(c.tag);
  });
});
