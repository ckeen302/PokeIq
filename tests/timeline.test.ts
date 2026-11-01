import { describe, expect, it } from "vitest";
import raw from "@/data/pokemon-timeline.json";
import dexData from "@/data/pokedex.json";
import startersData from "@/data/quiz/games/starters.json";
import boxData from "@/data/quiz/games/box-art.json";
import { compareEntries, deriveSpecies, generationAt, type BoxRow, type DexRow, type StarterRow } from "@/lib/timeline/derive";
import { LANES, dateRows, firstDate, formatDate, isValidDate, yearFrac, type TimelineRaw } from "@/lib/timeline/types";
import { TIMELINE, speciesOfGen } from "@/lib/timeline/data";

const ENTRIES = raw as unknown as TimelineRaw[];
const DEX = dexData as unknown as DexRow[];
const DEX_IDS = new Set(DEX.map((p) => p.id));
const LANE_IDS = new Set(LANES.map((l) => l.id));
const TODAY = new Date().toISOString().slice(0, 10);

describe("pokemon-timeline.json", () => {
  it("has a valid schema for every entry", () => {
    const ids = new Set<string>();
    for (const e of ENTRIES) {
      expect(e.id, "id").toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(LANE_IDS.has(e.lane), `${e.id} lane`).toBe(true);
      expect(e.title.trim().length, `${e.id} title`).toBeGreaterThan(2);
      expect(e.platform.trim().length, `${e.id} platform`).toBeGreaterThan(1);
      expect(Number.isInteger(e.generation) && e.generation >= 1 && e.generation <= 9, `${e.id} generation`).toBe(true);
      expect(e.region === null || typeof e.region === "string", `${e.id} region`).toBe(true);
      for (const k of ["date_jp", "date_na", "date_eu"] as const) expect(e[k] === null || typeof e[k] === "string", `${e.id} ${k}`).toBe(true);
    }
  });

  it("gives every entry at least two sources, the first being `source`", () => {
    for (const e of ENTRIES) {
      expect(e.sources.length, `${e.id} needs two sources`).toBeGreaterThanOrEqual(2);
      expect(new Set(e.sources).size, `${e.id} repeats a source`).toBe(e.sources.length);
      expect(e.source).toBe(e.sources[0]);
      for (const s of e.sources) expect(s, `${e.id} source`).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//);
    }
  });

  it("has real, released dates on every entry", () => {
    for (const e of ENTRIES) {
      const ds = [e.date_jp, e.date_na, e.date_eu].filter((d): d is string => d !== null);
      expect(ds.length, `${e.id} has no date`).toBeGreaterThan(0);
      for (const d of ds) {
        expect(isValidDate(d), `${e.id}: ${d}`).toBe(true);
        expect(d >= "1996-02-27", `${e.id}: ${d} predates Pokémon`).toBe(true);
        expect(d <= TODAY, `${e.id}: ${d} is in the future`).toBe(true);
      }
      if (e.worldwide) expect(e.date_jp, `${e.id} worldwide needs a date`).toBeTruthy();
      expect(dateRows({ ...e, worldwide: !!e.worldwide }).length).toBeGreaterThan(0);
      expect(formatDate(ds[0])).toMatch(/\d{4}$/);
    }
  });

  it("is in chronological order", () => {
    for (let i = 1; i < ENTRIES.length; i++) {
      expect(compareEntries(ENTRIES[i - 1], ENTRIES[i]), `${ENTRIES[i - 1].id} before ${ENTRIES[i].id}`).toBeLessThan(0);
      expect(yearFrac(firstDate(ENTRIES[i - 1]))).toBeLessThanOrEqual(yearFrac(firstDate(ENTRIES[i])));
    }
  });

  it("only names species that exist in the Pokédex", () => {
    for (const e of ENTRIES) for (const id of [...(e.starters ?? []), ...(e.legendaries ?? [])]) expect(DEX_IDS.has(id), `${e.id}: species ${id}`).toBe(true);
    const legendary = new Set(DEX.filter((p) => p.legendary || p.mythical).map((p) => p.id));
    for (const e of ENTRIES) for (const id of e.legendaries ?? []) expect(legendary.has(id), `${e.id}: ${id} isn't legendary`).toBe(true);
  });

  it("takes starters and box legendaries from the repo's own tables (scripts/timeline-data.ts)", () => {
    for (const e of ENTRIES) {
      const d = deriveSpecies(e, DEX, startersData as StarterRow[], boxData as BoxRow[]);
      expect(e.starters, `${e.id} starters`).toEqual(d.starters);
      expect(e.legendaries, `${e.id} legendaries`).toEqual(d.legendaries);
    }
    const rb = ENTRIES.find((e) => e.id === "red-green")!;
    expect(rb.starters).toEqual([1, 4, 7]);
  });

  it("covers every generation's opener, mainline anime season and anime film", () => {
    const openers = ENTRIES.filter((e) => e.lane === "games" && e.kind === "opener");
    expect(openers.map((e) => e.generation)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const seasons = ENTRIES.filter((e) => e.lane === "anime").map((e) => e.season);
    expect(seasons).toEqual(seasons.map((_, i) => i + 1));
    const films = ENTRIES.filter((e) => e.lane === "movies" && e.film).map((e) => e.film);
    expect(films).toEqual(films.map((_, i) => i + 1));
    // Every mainline game is a games-lane entry, including Legends.
    for (const id of ["legends-arceus", "legends-z-a", "scarlet-violet", "teal-mask", "indigo-disk", "mega-dimension"]) expect(ENTRIES.some((e) => e.id === id && e.lane === "games"), id).toBe(true);
  });

  it("puts non-game entries in the generation era of their date", () => {
    const openers = ENTRIES.filter((e) => e.lane === "games" && e.kind === "opener").map((e) => ({ generation: e.generation, t: yearFrac(firstDate(e)) }));
    for (const e of ENTRIES.filter((x) => x.lane !== "games")) expect(e.generation, e.id).toBe(generationAt(yearFrac(firstDate(e)), openers));
  });
});

describe("timeline page data", () => {
  it("resolves species and generation lists from the Pokédex", () => {
    expect(TIMELINE).toHaveLength(ENTRIES.length);
    const rb = TIMELINE.find((e) => e.id === "red-green")!;
    expect(rb.starters.map((s) => s.slug)).toEqual(["bulbasaur", "charmander", "squirtle"]);
    expect(rb.introduces).toBe(1);
    expect(rb.era).toBe("gb");
    expect(TIMELINE.find((e) => e.id === "firered-leafgreen-switch")!.era).toBe("switch");
    expect(speciesOfGen(1)[0].slug).toBe("bulbasaur");
    expect(speciesOfGen(1).at(-1)!.slug).toBe("mew");
    for (const e of TIMELINE) if (e.regionHref) expect(e.regionHref).toMatch(/^\/pokedex\/places\?region=/);
  });
});
