import { describe, expect, it } from "vitest";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import {
  ALL,
  FORM_ENTRIES,
  METRICS,
  MIN_VARIANT_ROWS,
  SPECIES_ENTRIES,
  allRankingPages,
  countingNote,
  entriesFor,
  explorerHref,
  feet,
  getMetric,
  isBuiltPage,
  kg,
  lbs,
  leaderSentence,
  metres,
  parseScope,
  rankEntries,
  ranking,
  rankingFacts,
  rankingFaq,
  rankingHeading,
  rankingPath,
  rankingTitle,
  scopeSegment,
  speciesEntry,
  variantScopes,
  type RankEntry,
} from "@/lib/dex/rankings";

const m = (slug: string) => getMetric(slug)!;

function fake(id: number, over: Partial<RankEntry> = {}): RankEntry {
  return {
    key: `p${id}`,
    species: id,
    slug: `p${id}`,
    name: `P${id}`,
    speciesName: null,
    form: null,
    art: id,
    types: ["normal"],
    gen: 1,
    stats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 },
    bst: 300,
    height: 10,
    weight: 100,
    ...over,
  };
}

describe("rankEntries", () => {
  it("orders by the metric in its direction", () => {
    const rows = [fake(1, { weight: 50 }), fake(2, { weight: 300 }), fake(3, { weight: 120 })];
    expect(rankEntries(rows, m("heaviest")).map((r) => r.entry.species)).toEqual([2, 3, 1]);
    expect(rankEntries(rows, m("lightest")).map((r) => r.entry.species)).toEqual([1, 3, 2]);
  });

  it("gives ties the same rank and skips the next (1, 1, 3), in dex order", () => {
    const rows = [fake(9, { bst: 600 }), fake(4, { bst: 600 }), fake(7, { bst: 500 }), fake(2, { bst: 700 })];
    const r = rankEntries(rows, m("strongest"));
    expect(r.map((x) => [x.entry.species, x.rank, x.tied])).toEqual([
      [2, 1, false],
      [4, 2, true],
      [9, 2, true],
      [7, 4, false],
    ]);
  });

  it("puts a species before its own form on a tie", () => {
    const base = fake(5, { stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 90 } });
    const form = fake(5, { key: "p5-mega", form: "mega", art: 10050, stats: { ...base.stats } });
    expect(rankEntries([form, base], m("fastest")).map((x) => x.entry.key)).toEqual(["p5", "p5-mega"]);
  });

  it("ranks the real data: the heaviest pair ties at 999.9 kg", () => {
    const r = ranking(m("heaviest"));
    expect(r).toHaveLength(POKEDEX.length);
    const top = r.filter((x) => x.rank === 1).map((x) => x.entry.name).sort();
    expect(top).toEqual(["Celesteela", "Cosmoem"]);
    expect(r[0].value).toBe(9999);
    for (let i = 1; i < r.length; i++) expect(r[i].value).toBeLessThanOrEqual(r[i - 1].value);
  });

  it("matches each species' own numbers", () => {
    const r = ranking(m("fastest"));
    for (const x of r.slice(0, 50)) {
      const p = POKEDEX.find((q) => q.slug === x.entry.slug)!;
      expect(x.value).toBe(p.stats.spe);
    }
  });
});

describe("units", () => {
  it("shows metric and imperial", () => {
    expect(kg(9999)).toBe("999.9 kg");
    expect(lbs(9999)).toBe("2,204.4 lbs");
    expect(kg(1)).toBe("0.1 kg");
    expect(lbs(1)).toBe("0.2 lbs");
    expect(metres(145)).toBe("14.5 m");
    expect(feet(145)).toBe("47′07″");
    expect(feet(7)).toBe("2′04″");
    expect(feet(1)).toBe("0′04″");
  });

  it("puts both units in the leader sentence for size lists", () => {
    expect(leaderSentence(m("heaviest"), ALL)).toContain("999.9 kg (2,204.4 lbs)");
    expect(leaderSentence(m("tallest"), ALL)).toMatch(/ m \(\d+′\d\d″\)/);
  });
});

describe("variant pages", () => {
  it("filters type lists to that type, default forms only", () => {
    const fire = entriesFor({ kind: "type", type: "fire" });
    expect(fire.length).toBeGreaterThanOrEqual(MIN_VARIANT_ROWS);
    expect(fire.every((e) => e.types.includes("fire") && e.form === null)).toBe(true);
    expect(fire).toHaveLength(POKEDEX.filter((p) => p.types.includes("fire")).length);
    const r = ranking(m("fastest"), { kind: "type", type: "fire" });
    expect(r.every((x) => x.entry.types.includes("fire"))).toBe(true);
  });

  it("filters generation lists to that generation", () => {
    const g1 = entriesFor({ kind: "gen", gen: 1 });
    expect(g1).toHaveLength(151);
    expect(g1.every((e) => e.gen === 1 && e.form === null)).toBe(true);
  });

  it("adds forms only to the forms list, and leaves Gigantamax out", () => {
    const all = entriesFor({ kind: "forms" });
    expect(all).toHaveLength(SPECIES_ENTRIES.length + FORM_ENTRIES.length);
    expect(FORM_ENTRIES.some((e) => e.name === "Mega Rayquaza")).toBe(true);
    expect(all.some((e) => /gmax|eternamax/.test(e.key))).toBe(false);
    expect(entriesFor(ALL).every((e) => e.form === null)).toBe(true);
    const top = ranking(m("strongest"), { kind: "forms" });
    expect(top[0].value).toBe(780);
    expect(top[0].entry.bst).toBe(Object.values(top[0].entry.stats).reduce((a, b) => a + b, 0));
  });

  it("builds only allowed combinations with enough Pokémon", () => {
    expect(variantScopes(m("slowest")).map(scopeSegment)).toEqual(["all-forms"]);
    expect(isBuiltPage("lightest", { kind: "type", type: "fire" })).toBe(false);
    expect(isBuiltPage("fastest", { kind: "type", type: "fire" })).toBe(true);
    expect(isBuiltPage("highest-defense", { kind: "gen", gen: 1 })).toBe(false);
    expect(isBuiltPage("nope", ALL)).toBe(false);
    for (const p of allRankingPages()) expect(entriesFor(p.scope).length).toBeGreaterThanOrEqual(MIN_VARIANT_ROWS);
  });

  it("gives every page a unique path, title, heading and description", () => {
    const pages = allRankingPages();
    const uniq = (xs: string[]) => new Set(xs).size === xs.length;
    expect(uniq(pages.map((p) => p.path))).toBe(true);
    expect(uniq(pages.map((p) => rankingTitle(p.metric, p.scope)))).toBe(true);
    expect(uniq(pages.map((p) => `${rankingHeading(p.metric, p.scope)}|${p.metric.dir}`))).toBe(true);
    for (const p of pages) expect(rankingTitle(p.metric, p.scope)).not.toMatch(/Olympics/i);
  });

  it("keeps row ids and entry slugs to [a-z0-9-] (the table's attributes are unquoted)", () => {
    for (const e of [...SPECIES_ENTRIES, ...FORM_ENTRIES]) {
      expect(e.key).toMatch(/^[a-z0-9-]+$/);
      expect(e.slug).toMatch(/^[a-z0-9-]+$/);
    }
    for (const p of allRankingPages()) expect(p.path).toMatch(/^[a-z0-9/-]+$/);
  });

  it("round-trips URL segments", () => {
    expect(parseScope("fire")).toEqual({ kind: "type", type: "fire" });
    expect(parseScope("gen-9")).toEqual({ kind: "gen", gen: 9 });
    expect(parseScope("all-forms")).toEqual({ kind: "forms" });
    expect(parseScope("gen-10")).toBeNull();
    expect(parseScope("banana")).toBeNull();
    expect(rankingPath("heaviest", { kind: "gen", gen: 1 })).toBe("/pokedex/rankings/heaviest/gen-1");
  });
});

describe("copy and links", () => {
  it("names the leader of a type list", () => {
    const s = { kind: "type", type: "fire" } as const;
    const top = ranking(m("fastest"), s)[0].entry.name;
    expect(rankingHeading(m("fastest"), s)).toBe("Fastest Fire-type Pokémon");
    expect(leaderSentence(m("fastest"), s)).toContain(top);
  });

  it("states what's counted", () => {
    expect(countingNote(m("heaviest"), ALL)).toMatch(/default form/);
    expect(countingNote(m("heaviest"), { kind: "forms" })).toMatch(/Mega Evolutions/);
    expect(countingNote(m("fastest"), { kind: "gen", gen: 1 })).toMatch(/Generation 1 \(Kanto\)/);
  });

  it("answers its questions from the list", () => {
    const faq = rankingFaq(m("fastest"), ALL);
    expect(faq[0].a).toContain(ranking(m("fastest"))[0].entry.name);
    expect(faq.length).toBeGreaterThanOrEqual(2);
  });

  it("deep-links to the sorted Pokédex", () => {
    expect(explorerHref(m("heaviest"), { kind: "type", type: "fire" })).toBe("/pokedex?sort=weight&type=fire");
    expect(explorerHref(m("lightest"), { kind: "gen", gen: 2 })).toBe("/pokedex?sort=weight&gen=2&dir=asc");
  });

  it("gives every metric a slug and a sort the Pokédex understands", () => {
    const sorts = ["bst", "hp", "atk", "def", "spa", "spd", "spe", "height", "weight"];
    for (const x of METRICS.filter((x) => x.key !== "bulk")) expect(sorts).toContain(x.key);
    expect(explorerHref(m("bulkiest"), ALL)).toBeNull();
  });
});

describe("bulk and non-legendary lists", () => {
  it("ranks HP + Defense + Special Defense", () => {
    const top = ranking(m("bulkiest"))[0];
    expect(top.value).toBe(top.entry.stats.hp + top.entry.stats.def + top.entry.stats.spd);
  });

  it("leaves legendaries and mythicals out of the core scope", () => {
    const core = { kind: "core" } as const;
    expect(isBuiltPage("strongest", core)).toBe(true);
    expect(isBuiltPage("heaviest", core)).toBe(false);
    const names = new Set(POKEDEX.filter((p) => p.legendary || p.mythical).map((p) => p.slug));
    expect(names.size).toBeGreaterThan(0);
    for (const r of ranking(m("strongest"), core)) expect(names.has(r.entry.slug)).toBe(false);
    expect(parseScope(scopeSegment(core)!)).toEqual(core);
    expect(rankingHeading(m("strongest"), core)).toBe("Strongest non-legendary Pokémon");
  });
});

describe("rankingFacts", () => {
  it("lists real placings that link to the row", () => {
    const facts = rankingFacts("regieleki");
    expect(facts[0]).toEqual({ text: "#1 fastest Pokémon", href: "/pokedex/rankings/fastest#regieleki", rank: 1 });
    for (const f of facts) {
      const [path, key] = f.href.split("#");
      const [, , , metric, variant] = path.split("/");
      const scope = variant ? parseScope(variant)! : ALL;
      expect(ranking(m(metric), scope).find((r) => r.entry.key === key)?.rank).toBe(f.rank);
    }
  });

  it("stays empty for a Pokémon that tops nothing", () => {
    expect(rankingFacts("pidgey")).toEqual([]);
    expect(rankingFacts("not-a-pokemon")).toEqual([]);
  });

  it("speciesEntry copies the snapshot", () => {
    const p = POKEDEX[0];
    expect(speciesEntry(p)).toMatchObject({ species: p.id, bst: p.bst, weight: p.weight, form: null });
  });
});
