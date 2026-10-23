import { describe, expect, it } from "vitest";
import { allCategories } from "@/lib/pikadoku/categories";
import { PDK_RULES, categoryHint } from "@/lib/pikadoku/types";

describe("category tooltips", () => {
  it("explain every category, and say what forms do", () => {
    for (const c of allCategories()) {
      const hint = categoryHint(c.id);
      expect(hint.length, c.id).toBeGreaterThan(40);
      expect(hint, c.id).toMatch(/form|Mega|species|Alolan/i);
    }
  });
  it("is specific to the kind of category", () => {
    expect(categoryHint("type:fire")).toContain("Fire");
    expect(categoryHint("type:fire")).toMatch(/Mega Charizard X is Fire and Dragon/);
    expect(categoryHint("region:7")).toMatch(/Alolan Raichu is Alola/);
    expect(categoryHint("region:hisui")).toMatch(/Hisuian forms/);
    expect(categoryHint("form:alola")).toMatch(/Raichu and Alolan Raichu/);
    expect(categoryHint("ability:hidden")).toMatch(/Tough Claws/);
    expect(categoryHint("stat:atk:120")).toMatch(/Mega Evolution's stats/);
    expect(categoryHint("other:paradox")).toMatch(/Great Tusk/);
    expect(categoryHint("other:ultrabeast")).toMatch(/Necrozma is not one/);
  });
  it("states the no-reuse rule and the region rules in the how-to", () => {
    const rules = PDK_RULES.join(" ");
    expect(rules).toMatch(/No reuse: a form and its species are the same Pokémon/);
    expect(rules).toMatch(/Stricter than PokeDoku/);
    expect(rules).toMatch(/Alolan Raichu is from Alola/);
    expect(rules).toMatch(/Mega or Gigantamax form counts for its species' region/);
  });
});
