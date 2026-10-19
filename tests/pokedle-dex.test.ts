import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/pokedle/dex/route";
import { compare } from "@/lib/server/pokedle";
import { formatHeight, formatWeight, getPokemon, POKEDEX } from "@/lib/pokemon/pokedex";
import type { DleDexRow } from "@/lib/dle-types";

describe("the Pokédex beside the Pokédle board", () => {
  it("lists exactly the guessable Pokémon, with the values the board's clues show", async () => {
    const rows = (await GET().json()) as DleDexRow[];
    expect(rows.map((r) => r[0])).toEqual(POKEDEX.map((p) => p.id));
    const pikachu = getPokemon(25)!;
    for (const [id, name, gen, t1, t2, height, weight, color, stage] of rows) {
      const p = getPokemon(id)!;
      // A guess's own clue values (compared against any answer: Pikachu here) are what the row shows.
      const { cells } = compare(p, pikachu);
      expect(name).toBe(p.name);
      expect(String(gen)).toBe(cells.gen.value);
      expect(t1).toBe(cells.type1.value.toLowerCase());
      expect(t2 ?? "none").toBe(cells.type2.value.toLowerCase());
      expect(formatHeight(height)).toBe(cells.height.value);
      expect(formatWeight(weight)).toBe(cells.weight.value);
      expect(color).toBe(cells.color.value.toLowerCase());
      expect(String(stage)).toBe(cells.stage.value);
    }
  });

  it("is the same list whatever the puzzle, so it can't point at an answer", async () => {
    const [a, b] = await Promise.all([GET().text(), GET().text()]);
    expect(a).toBe(b);
    expect(GET().headers.get("cache-control")).toMatch(/public/);
  });
});
