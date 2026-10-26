import { describe, expect, it } from "vitest";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { allFacts } from "@/lib/pikadoku/categories";
import { editDistance, indexEntries, normalizeName, searchEntries } from "@/lib/pikadoku/search";

// The picker's real list: every species and every playable form.
const entries = [...POKEDEX.map((p) => ({ id: p.id, name: p.name, base: p.id })), ...allFacts().filter((f) => f.form).map((f) => ({ id: f.id, name: f.name, base: f.baseId }))];
const index = indexEntries(entries);
const top = (q: string, n = 1) => searchEntries(index, q, 8).slice(0, n).map((e) => e.name);

describe("picker search", () => {
  it("normalizes accents, punctuation and gender signs", () => {
    expect(normalizeName("Flabébé")).toBe("flabebe");
    expect(normalizeName("Farfetch’d")).toBe("farfetch d");
    expect(normalizeName("Nidoran♀")).toBe("nidoran f");
    expect(normalizeName("Type: Null")).toBe("type null");
  });
  it("finds names however they are typed", () => {
    expect(top("pika")).toEqual(["Pikachu"]);
    expect(top("sirfetchd")[0]).toMatch(/^Sirfetch/);
    expect(top("sirfetch'd")[0]).toMatch(/^Sirfetch/);
    expect(top("mr mime")).toEqual(["Mr. Mime"]);
    expect(top("mrmime")).toEqual(["Mr. Mime"]);
    expect(top("flabebe")).toEqual(["Flabébé"]);
    expect(top("nidoran f")).toEqual(["Nidoran♀"]);
    expect(top("porygonz")).toEqual(["Porygon-Z"]);
    expect(top("type null")).toEqual(["Type: Null"]);
    expect(top("ho oh")).toEqual(["Ho-Oh"]);
  });
  it("forgives a typo or two", () => {
    expect(top("charzard")).toEqual(["Charizard"]);
    expect(top("garchmop")).toEqual(["Garchomp"]); // swapped letters
    expect(top("gengr")).toEqual(["Gengar"]);
    expect(top("blastiose")).toEqual(["Blastoise"]);
    expect(top("xq")).toEqual([]); // too short to guess at
  });
  it("lists forms after their species, and finds them by any word", () => {
    expect(top("raichu", 2)).toEqual(["Raichu", "Alolan Raichu"]);
    expect(top("alolan rai")).toEqual(["Alolan Raichu"]);
    expect(top("mega charizard", 2).sort()).toEqual(["Mega Charizard X", "Mega Charizard Y"]);
  });
  it("finds a species by its dex number", () => {
    expect(top("25")).toEqual(["Pikachu"]);
    expect(top("#445")).toEqual(["Garchomp"]);
  });
  it("is quick over the whole list", () => {
    const t = performance.now();
    for (const q of ["c", "ch", "cha", "char", "chari", "chariz", "charzard", "blastiose", "mr mime"]) searchEntries(index, q);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it("measures edits with a swap as one", () => {
    expect(editDistance("abcd", "abdc")).toBe(1);
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("a", "abcdef", 2)).toBe(3);
  });
});
