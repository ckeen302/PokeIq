import { describe, expect, it } from "vitest";
import raw from "@/data/pokemon-timeline.json";
import dexData from "@/data/pokedex.json";
import startersData from "@/data/quiz/games/starters.json";
import boxData from "@/data/quiz/games/box-art.json";
import { compareEntries, deriveSpecies, generationAt, type BoxRow, type DexRow, type StarterRow } from "@/lib/timeline/derive";
import { LANES, dateRows, firstDate, formatDate, isValidDate, yearFrac, type TimelineRaw } from "@/lib/timeline/types";
import { TIMELINE, speciesOfGen } from "@/lib/timeline/data";
import setNames from "@/lib/tcg/set-names.json";
import tcgFixture from "@/lib/tcg/fixture.json";
import { isCompact } from "@/lib/timeline/types";

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
      if (e.featured !== undefined) expect(e.featured, `${e.id} featured`).toBe(true);
      if (e.set !== undefined) expect(e.lane, `${e.id}: only TCG entries name a set`).toBe("tcg");
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

/** The repo's own English set list (PokemonTCG/pokemon-tcg-data, the data behind /pokedex/tcg). */
const SETS = (setNames as unknown as { sets: Record<string, [string, string]> }).sets;
/** Promos, McDonald's and POP packs, trainer kits, the starter set, energies and sub-galleries: not on the timeline. */
const MINOR = /^(pop\d|mcd\d)/;
const NOT_A_SET = new Set(["basep", "np", "dpp", "hsp", "bwp", "xyp", "smp", "swshp", "svp", "tk1a", "tk1b", "tk2a", "tk2b", "bp", "ru1", "fut20", "sve", "si1", "xy0", "sma", "swsh45sv", "cel25c", "swsh9tg", "swsh10tg", "swsh11tg", "swsh12tg", "swsh12pt5gg", "me55c"]);
/** The date the timeline shows for a set: pokemontcg.io gives most 2003–2009 sets as the 1st of their month, kept to the month. */
const setDate = (d: string) => {
  const [y, m, day] = d.split("/");
  return day === "01" && Number(y) >= 2003 && Number(y) <= 2009 ? `${y}-${m}` : `${y}-${m}-${day}`;
};

describe("timeline TCG lane", () => {
  const tcg = ENTRIES.filter((e) => e.lane === "tcg");
  const bySet = new Map(tcg.filter((e) => e.set).map((e) => [e.set!, e]));

  it("names only sets that exist in the repo's TCG set data, once each", () => {
    const seen = new Set<string>();
    for (const e of tcg.filter((x) => x.set)) {
      expect(SETS[e.set!], `${e.id}: no set ${e.set}`).toBeDefined();
      expect(seen.has(e.set!), `${e.set} twice`).toBe(false);
      seen.add(e.set!);
    }
  });

  it("dates every set from that data, as its North American release", () => {
    for (const e of tcg.filter((x) => x.set)) {
      expect(e.date_na, e.id).toBe(setDate(SETS[e.set!][1]));
      expect(e.date_jp, e.id).toBeNull();
      expect(e.sources, e.id).toContain(`https://api.pokemontcg.io/v2/sets/${e.set}`);
    }
  });

  it("agrees with the captured API fixture the TCG pages run on in tests", () => {
    for (const s of (tcgFixture as unknown as { sets: { id: string; releaseDate: string }[] }).sets) {
      const e = bySet.get(s.id);
      if (e) expect(e.date_na, s.id).toBe(setDate(s.releaseDate));
    }
  });

  it("has every main English expansion and special set, and no promos or minor products", () => {
    for (const id of Object.keys(SETS)) {
      const minor = MINOR.test(id) || NOT_A_SET.has(id);
      expect(bySet.has(id), `${id} (${SETS[id][0]})${minor ? " is a minor product" : " is missing"}`).toBe(!minor);
    }
    for (const id of ["base1", "base2", "base3", "neo1", "ex1", "dp1", "hgss1", "bw1", "xy1", "sm1", "swsh1", "swsh7", "sv3pt5", "sv1", "sv8pt5", "sm115", "swsh45", "cel25", "swsh12pt5"]) expect(bySet.has(id), id).toBe(true);
  });

  it("keeps the era entries and the Japanese debut, and features the landmark sets", () => {
    for (const id of ["tcg-japan", "tcg-base", "tcg-neo", "tcg-bw", "tcg-xy", "tcg-sm", "tcg-swsh", "tcg-sv", "tcg-me"]) expect(tcg.some((e) => e.id === id), id).toBe(true);
    for (const id of ["base1", "base2", "base3", "neo1", "ex1", "dp1", "hgss1", "bw1", "xy1", "sm1", "swsh1", "swsh7", "sv3pt5", "sv1", "sv8pt5"]) expect(bySet.get(id)?.featured, `${id} featured`).toBe(true);
    // Featured cards stay rare enough to stand out.
    expect(tcg.filter((e) => e.featured).length).toBeLessThan(25);
  });

  it("links each set to its page on /pokedex/tcg, and draws only the non-featured ones compact", () => {
    for (const e of TIMELINE.filter((x) => x.lane === "tcg")) {
      const raw = ENTRIES.find((r) => r.id === e.id)!;
      expect(e.setHref, e.id).toBe(raw.set ? `/pokedex/tcg/${raw.set}` : null);
      expect(isCompact(e), e.id).toBe(!raw.featured);
    }
    for (const e of TIMELINE.filter((x) => x.lane !== "tcg")) {
      expect(e.setHref, e.id).toBeNull();
      expect(isCompact(e), e.id).toBe(false);
    }
  });
});

describe("timeline spin-offs and milestones", () => {
  it("has the well-known spin-offs and milestones", () => {
    for (const id of ["pinball", "puzzle-league", "puzzle-challenge", "ranger", "rumble", "pokken", "cafe-mix", "masters", "smile", "sleep", "tcg-live", "new-pokemon-snap", "detective-pikachu-game", "quest", "shuffle", "picross", "pokepark", "hey-you-pikachu"]) expect(ENTRIES.find((e) => e.id === id)?.lane, id).toBe("spinoffs");
    for (const id of ["first-vgc-worlds", "pokemon-center-tokyo", "go-fest-2017", "target-card-pause"]) expect(ENTRIES.find((e) => e.id === id)?.lane, id).toBe("events");
  });
  it("cites two different sites for every added spin-off and milestone", () => {
    const added = ["hey-you-pikachu", "tcg-game-boy", "pinball", "puzzle-challenge", "puzzle-league", "stadium-2", "xd", "ranger", "mystery-dungeon-explorers", "rumble", "pokepark", "conquest", "shuffle", "pokken", "picross", "detective-pikachu-game", "quest", "masters", "smile", "cafe-mix", "tcg-live", "detective-pikachu-returns", "pokemon-center-tokyo", "pokemon-center-new-york", "first-vgc-worlds", "pikachu-outbreak", "go-fest-2017", "target-card-pause"];
    for (const id of added) {
      const e = ENTRIES.find((x) => x.id === id)!;
      expect(e, id).toBeDefined();
      const hosts = new Set(e.sources.map((u) => new URL(u).hostname.replace(/^(www|en|ja)\./, "")));
      expect(hosts.size, `${e.id}: ${e.sources.join(" ")}`).toBeGreaterThanOrEqual(2);
    }
  });
});
