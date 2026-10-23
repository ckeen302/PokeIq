import { describe, expect, it } from "vitest";
import { allFacts, categoryById } from "@/lib/pikadoku/categories";
import { PARADOX_IDS, STARTER_IDS, ULTRA_BEAST_IDS } from "@/lib/pikadoku/curated";

const byId = (id: number) => allFacts().find((f) => f.id === id)!;
const has = (cat: string, id: number) => categoryById(cat)!.test(byId(id));

describe("new categories", () => {
  it("derives First Partner lines from data", () => {
    expect(has("other:partner", 1)).toBe(true); // Bulbasaur
    expect(has("other:partner", 3)).toBe(true); // Venusaur
    expect(has("other:partner", 25)).toBe(false);
    expect(has("other:partner", 10034)).toBe(true); // Mega Charizard X follows its species' line
  });
  it("uses vetted Paradox and Ultra Beast lists", () => {
    expect(STARTER_IDS).toHaveLength(27);
    expect(has("other:paradox", 987)).toBe(true); // Flutter Mane
    expect(has("other:paradox", 1023)).toBe(true);
    expect(has("other:paradox", 25)).toBe(false);
    expect(has("other:ultrabeast", 794)).toBe(true); // Buzzwole
    expect(has("other:ultrabeast", 800)).toBe(false); // Necrozma
    const names = (ids: readonly number[]) => ids.map((i) => byId(i).name);
    expect(names(PARADOX_IDS)).toContain("Iron Crown");
    expect(PARADOX_IDS).toHaveLength(20);
    expect(names(ULTRA_BEAST_IDS)).toContain("Blacephalon");
    expect(ULTRA_BEAST_IDS).toHaveLength(11);
  });
  it("keeps Monotype and No evolution line computed from data", () => {
    expect(has("types:single", 25)).toBe(true);
    expect(has("types:single", 6)).toBe(false);
    expect(has("evo:none", 128)).toBe(true); // Tauros
    expect(has("evo:none", 25)).toBe(false);
    expect(categoryById("evo:none")!.label).toMatch(/No evolution line/);
  });
});
