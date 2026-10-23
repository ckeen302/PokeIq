import { describe, expect, it } from "vitest";
import { getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { dexBreadcrumbs, dexDescription, dexSummary, dexTitle, weaknessesOf } from "@/lib/pokemon/dex-seo";

describe("Pokédex entry SEO", () => {
  const charizard = getPokemonBySlug("charizard")!;

  it("builds the title pattern", () => {
    expect(dexTitle(charizard)).toBe("Charizard: Weaknesses, Stats, Abilities & Moves");
  });

  it("derives weaknesses from the type chart", () => {
    const weak = weaknessesOf(charizard);
    expect(weak[0]).toEqual({ type: "Rock", multiplier: 4 });
    expect(weak.map((w) => w.type)).toEqual(expect.arrayContaining(["Water", "Electric"]));
  });

  it("describes types, weaknesses and base stat total", () => {
    const d = dexDescription(charizard);
    expect(d).toContain(`#${charizard.id}`);
    expect(d).toContain("Fire/Flying-type");
    expect(d).toContain(`base stat total of ${charizard.bst}`);
    expect(d).toContain("Weak to Rock");
  });

  it("writes a summary and breadcrumbs", () => {
    expect(dexSummary(charizard)).toContain(`Generation ${charizard.gen}`);
    const items = dexBreadcrumbs(charizard).itemListElement;
    expect(items.map((i) => i.name)).toEqual(["PokéIQ", "Pokédex", "Charizard"]);
  });
});
