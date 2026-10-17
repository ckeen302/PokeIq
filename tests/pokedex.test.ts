import { describe, expect, it } from "vitest";
import { POKEDEX, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { getDexEntry } from "@/lib/pokemon/details";
import { catchChance, statRange } from "@/lib/pokemon/stat-calc";
import type { EvolutionNode } from "@/lib/pokemon/dex-types";

const flatten = (n: EvolutionNode): EvolutionNode[] => [n, ...n.children.flatMap(flatten)];

describe("Pokédex details", () => {
  it("builds a complete entry for every species", () => {
    for (const p of POKEDEX) {
      const d = getDexEntry(p);
      expect(d.learnset?.moves.length, `${p.name} learnset`).toBeGreaterThan(0);
      expect(d.abilities.length, `${p.name} abilities`).toBeGreaterThan(0);
      expect(d.entries.length, `${p.name} entries`).toBeGreaterThan(0);
      expect(d.defenses).toHaveLength(18);
      if (d.evolutionTree) expect(flatten(d.evolutionTree).map((n) => n.id)).toContain(p.id);
    }
  });

  it("has Eevee's eight evolutions with their methods", () => {
    const tree = getDexEntry(getPokemonBySlug("eevee")!).evolutionTree!;
    expect(tree.children).toHaveLength(8);
    const vaporeon = tree.children.find((c) => c.slug === "vaporeon")!;
    expect(vaporeon.conditions).toContain("Use Water Stone");
  });

  it("exposes alternate forms with their own typing", () => {
    const forms = getDexEntry(getPokemonBySlug("charizard")!).forms;
    const megaX = forms.find((f) => f.name === "Mega Charizard X")!;
    expect(megaX.types).toEqual(["fire", "dragon"]);
  });

  it("normalizes shouty Gen 1–5 Pokédex text", () => {
    const text = getDexEntry(getPokemonBySlug("charizard")!).entries.map((e) => e.text).join(" ");
    expect(text).not.toMatch(/CHARIZARD|POKéMON/);
  });
});

describe("stat formulas", () => {
  it("matches known level-100 ranges", () => {
    expect(statRange("spe", 102, 100)).toEqual([188, 333]); // Garchomp
    expect(statRange("hp", 255, 100)).toEqual([620, 714]); // Blissey
    expect(statRange("hp", 1, 100, true)).toEqual([1, 1]); // Shedinja
    expect(statRange("atk", 100, 50)).toEqual([94, 167]);
  });

  it("computes Poké Ball catch chance at full HP", () => {
    expect(catchChance(255)).toBeCloseTo(1 / 3, 3);
    expect(catchChance(3)).toBeCloseTo(0.0039, 3);
  });
});
