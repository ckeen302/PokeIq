import { describe, expect, it } from "vitest";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { editDistance, normalizeName, suggest, type NameEntry } from "@/components/pokedle/search";

const NAMES: NameEntry[] = POKEDEX.map((p) => [p.id, p.name, p.gen]);
const none = new Set<number>();
const names = (q: string, exclude: ReadonlySet<number> = none) => suggest(NAMES, q, exclude).entries.map((e) => e[1]);

describe("the guess box's suggestions", () => {
  it("puts the exact name first, then names starting with it", () => {
    expect(names("Mew")[0]).toBe("Mew");
    expect(names("mew").slice(0, 2)).toEqual(["Mew", "Mewtwo"]);
    expect(names("pika")[0]).toBe("Pikachu");
    expect(names("char").slice(0, 3)).toEqual(["Charmander", "Charmeleon", "Charizard"]);
  });

  it("ignores accents, punctuation and case", () => {
    expect(names("flabebe")[0]).toBe("Flabébé");
    expect(names("farfetchd")[0]).toBe(POKEDEX.find((p) => p.id === 83)!.name);
    expect(names("mr mime")).toContain("Mr. Mime");
    expect(names("ho-oh")[0]).toBe("Ho-Oh");
    expect(names("type null")[0]).toBe("Type: Null");
    expect(names("nidoran")).toEqual(expect.arrayContaining(["Nidoran♀", "Nidoran♂"]));
  });

  it("finds a later word of a name", () => {
    expect(names("mime").slice(0, 3)).toEqual(expect.arrayContaining(["Mr. Mime", "Mime Jr."]));
    expect(names("koko")[0]).toBe("Tapu Koko");
  });

  it("forgives a typo or two", () => {
    expect(names("charzard")[0]).toBe("Charizard");
    expect(names("pikahcu")[0]).toBe("Pikachu");
    expect(names("gengr")[0]).toBe("Gengar");
    expect(names("garchomb")[0]).toBe("Garchomp");
    expect(names("lucarion")[0]).toBe("Lucario");
    // Short queries stay strict: no noise.
    expect(names("xq")).toEqual([]);
  });

  it("leaves out what's been guessed, and says so when that's the only match", () => {
    const pikachu = POKEDEX.find((p) => p.name === "Pikachu")!.id;
    expect(names("pikachu", new Set([pikachu]))).not.toContain("Pikachu");
    expect(suggest(NAMES, "Pikachu", new Set([pikachu])).alreadyGuessed?.[1]).toBe("Pikachu");
    expect(suggest(NAMES, "zzzz", none)).toEqual({ entries: [] });
  });

  it("returns at most seven, and is fast enough for every keystroke", () => {
    expect(names("a").length).toBe(7);
    const start = performance.now();
    for (const q of ["c", "ch", "cha", "char", "chari", "chariz", "charizd", "xyzzyq"]) suggest(NAMES, q, none);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("measures typos as edits, swaps included", () => {
    expect(editDistance("abc", "abc", 2)).toBe(0);
    expect(editDistance("abc", "acb", 2)).toBe(1);
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("a", "abcdef", 2)).toBe(3);
    expect(normalizeName("Farfetch'd")).toBe("farfetchd");
  });
});
