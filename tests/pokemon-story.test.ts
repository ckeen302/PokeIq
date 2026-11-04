import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import TIMELINE from "@/data/pokemon-timeline.json";
import POKEDEX from "@/data/pokedex.json";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { CHAPTERS, CHAPTER_IDS, FIGURE_ARTS, STORY, beatPlain, chapterById, sourceOf } from "@/lib/pokemon-story/data";
import { BASES, basisTag, sourceLine } from "@/lib/pokemon-story/types";
import { STORY_PATH, chapterFromPath, chapterPath } from "@/lib/pokemon-story/deeplink";
import { buildFilm, storyVideoPlan } from "@/lib/pokemon-story/timing";
import { figureAsset } from "@/lib/world-history/assets";
import { buildFilm as buildHistoryFilm } from "@/lib/world-history/timing";
import { CHAPTERS as HISTORY_CHAPTERS } from "@/lib/world-history/data";

type TimelineEntry = { id: string; date_jp: string | null; date_na: string | null; date_eu: string | null };
const ENTRIES = new Map((TIMELINE as unknown as TimelineEntry[]).map((e) => [e.id, e]));
const film = buildFilm();

describe("The Story of Pokémon: content", () => {
  it("has eleven chapters in order, with unique ids and sequential numerals", () => {
    expect(CHAPTER_IDS).toEqual(["collector", "game-freak", "cable", "six-years", "red-green", "pokemania", "growing", "together", "outside", "open-worlds", "thirty"]);
    const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
    CHAPTERS.forEach((c, i) => expect(c.numeral).toBe(numerals[i]));
    for (const c of CHAPTERS) expect(c.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(STORY.title).toBe("The Story of Pokémon");
  });

  it("every beat and note cites one of its chapter's sources, and every source has a link", () => {
    for (const c of CHAPTERS) {
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      expect(new Set(c.sources.map((s) => s.id)).size, `${c.id} source ids`).toBe(c.sources.length);
      for (const s of c.sources) {
        expect(s.url, `${c.id}/${s.id}`).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+\//);
        expect(s.publisher.length).toBeGreaterThan(1);
        expect(sourceLine(s)).toContain(" · ");
      }
      expect(c.beats.length, c.id).toBeGreaterThanOrEqual(5);
      for (const b of c.beats) {
        expect(() => sourceOf(c, b), `${c.id}/${b.id}`).not.toThrow();
        expect(b.quote || b.text, `${c.id}/${b.id} has words`).toBeTruthy();
        expect(BASES, `${c.id}/${b.id}`).toContain(b.basis);
      }
      for (const n of c.notes) {
        expect(BASES).toContain(n.basis);
        if (n.source) expect(() => sourceOf(c, { source: n.source! })).not.toThrow();
      }
      const used = new Set([...c.beats.map((b) => b.source), ...c.notes.map((n) => n.source).filter(Boolean)]);
      for (const s of c.sources) expect(used.has(s.id), `${c.id}: source ${s.id} unused`).toBe(true);
      expect(c.beats.some((b) => b.id === c.video), `${c.id} video beat`).toBe(true);
      expect(new Set(c.beats.map((b) => b.id)).size).toBe(c.beats.length);
    }
  });

  it("every date matches the Pokémon Timeline", () => {
    let checked = 0;
    for (const c of CHAPTERS) {
      for (const b of c.beats) {
        for (const d of b.dates ?? []) {
          expect(d.date, `${c.id}/${b.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          if (!d.timeline) continue;
          const e = ENTRIES.get(d.timeline);
          expect(e, `${c.id}/${b.id}: timeline ${d.timeline}`).toBeTruthy();
          expect(e![`date_${d.field ?? "jp"}` as const], `${c.id}/${b.id}: ${d.timeline}`).toBe(d.date);
          checked++;
        }
        // A past year in the words is one of the beat's own dates (a future one, like a release planned for 2027, isn't).
        const words = beatPlain(b);
        for (const y of (words.match(/\b(19[89]\d|20[0-2]\d)\b/g) ?? []).filter((x) => Number(x) <= 2026)) {
          if (b.dates?.length) expect(b.dates.some((d) => d.date.startsWith(y)), `${c.id}/${b.id}: ${y}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(25);
  });

  it("keeps the verified points exactly", () => {
    const all = (id: string) => chapterById(id)!.beats.map(beatPlain).join(" ") + " " + chapterById(id)!.notes.map((n) => n.text).join(" ");
    expect(all("collector")).toContain("“Dr. Bug.”");
    expect(all("collector")).toContain("Machida");
    expect(all("cable")).toContain("I thought of actual living organisms moving back and forth across the cable.");
    expect(chapterById("cable")!.beats.find((b) => b.id === "name")!.basis).toBe("retold");
    expect(all("six-years")).toContain("punched in the dots");
    expect(all("six-years")).toContain("We put Mew in right at the very end.");
    expect(all("thirty")).toContain("Pokémon Winds and Pokémon Waves, for 2027");
    expect(all("thirty")).toContain("More than a thousand");
    expect(all("open-worlds")).toContain("Legends: Z-A");
    expect(all("outside")).toContain("April Fools' joke in 2014");
    // The film stays feel-good: no Porygon episode.
    for (const c of CHAPTERS) expect(c.beats.map(beatPlain).join(" "), c.id).not.toMatch(/Porygon/);
    // The species count in the notes is the Pokédex's own.
    const max = Math.max(...(POKEDEX as unknown as { id: number }[]).map((p) => p.id));
    expect(all("thirty")).toContain(max.toLocaleString("en-US"));
  });

  it("tags interviews, reports and retellings", () => {
    expect(basisTag("record")).toBeNull();
    expect(basisTag("line")).toBeNull();
    expect(basisTag("said")).toBe("In their words");
    expect(basisTag("reported")).toBe("Reported");
    expect(basisTag("retold")).toBe("As it's told");
    // A quote is always someone's words.
    for (const c of CHAPTERS) for (const b of c.beats) if (b.quote) expect(b.basis, `${c.id}/${b.id}`).toBe("said");
    // A retold beat says so in its own words.
    for (const c of CHAPTERS) for (const b of c.beats) if (b.basis === "retold") expect(beatPlain(b)).toMatch(/story goes|it's said|as it's told/i);
  });

  it("every Pokémon is real, with a HOME box and a baked relief", () => {
    for (const c of CHAPTERS) {
      for (const f of c.figures) {
        const p = getPokemon(f.dex);
        expect(p, `${c.id}: dex ${f.dex}`).toBeTruthy();
        expect(p!.name).toBe(f.name);
        const a = figureAsset(f.art);
        expect(a, `${c.id}: art ${f.art}`).toBeTruthy();
        expect(existsSync(join(process.cwd(), "public", a!.relief)), a!.relief).toBe(true);
      }
      const arts = new Set(c.figures.map((f) => f.art));
      for (const b of c.beats) for (const a of b.figures ?? []) expect(arts.has(a), `${c.id}/${b.id}: figure ${a}`).toBe(true);
    }
    expect(FIGURE_ARTS).toEqual(expect.arrayContaining([1007, 1008, 10, 25, 151]));
  });

  it("has no counts in its chrome", () => {
    for (const s of [STORY.tagline, STORY.intro, STORY.method]) expect(s).not.toMatch(/\b\d+\s+(chapters|beats|things|Pokémon)\b/i);
  });
});

describe("The Story of Pokémon: deep links and timing", () => {
  it("maps chapters to paths and back", () => {
    expect(STORY_PATH).toBe("/lab/pokemon-story");
    expect(chapterPath("cable")).toBe("/lab/pokemon-story/cable");
    expect(chapterPath("nope")).toBe(STORY_PATH);
    expect(chapterFromPath("/lab/pokemon-story/six-years")).toBe("six-years");
    expect(chapterFromPath("/lab/pokemon-story/nope")).toBeNull();
  });

  it("runs on World History's clock with its own pacing, and every slow motion names a real beat", () => {
    expect(film.chapters).toHaveLength(CHAPTERS.length);
    CHAPTERS.forEach((c, i) => {
      expect(c.slow, c.id).toHaveLength(1);
      for (const s of c.slow) expect(c.beats.some((b) => b.id === s.beat), `${c.id} slow ${s.beat}`).toBe(true);
      for (const id of Object.keys(c.extra)) expect(c.beats.some((b) => b.id === id), `${c.id} extra ${id}`).toBe(true);
      const ct = film.chapters[i];
      expect(ct.slow).toHaveLength(1);
      expect(ct.film).toBeGreaterThan(ct.anim);
    });
    // About eight to nine minutes in all.
    expect(film.duration).toBeGreaterThan(7 * 60);
    expect(film.duration).toBeLessThan(10 * 60);
    // World History's film is unchanged by the shared clock.
    const h = buildHistoryFilm();
    expect(h.chapters.map((c) => c.id)).toEqual(HISTORY_CHAPTERS.map((c) => c.id));
  });

  it("the 60-second video quotes each chapter's video beat once", () => {
    const plan = storyVideoPlan(film);
    expect(plan.seconds).toBe(60);
    expect(plan.segments).toHaveLength(CHAPTERS.length);
    plan.segments.forEach((s, i) => {
      const b = film.chapters[i].beats.find((x) => x.id === CHAPTERS[i].video)!;
      expect(s.from).toBeLessThanOrEqual(b.anim);
      expect(s.to).toBeGreaterThan(b.anim);
    });
  });
});
