import { describe, expect, it } from "vitest";
import MANIFEST from "@/data/dex-sprites.json";
import { POKEDEX, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { dexSpriteColumns, spriteCode } from "@/lib/pokemon/dex-sprites";
import { LAST_SPRITE_GEN, SPRITE_BASE, SPRITE_SOURCES, spriteColumns } from "@/lib/pokemon/sprites";

const bySlug = (slug: string) => getPokemonBySlug(slug)!;

describe("sprites manifest", () => {
  it("has a row for every species, blank exactly before its debut generation", () => {
    expect(MANIFEST.rows).toHaveLength(POKEDEX.length);
    for (const p of POKEDEX) {
      const code = spriteCode(p.id)!;
      expect(code).toMatch(new RegExp(`^-{${p.gen - 1}}[0-3]{${LAST_SPRITE_GEN - p.gen + 1}}$`));
    }
  });

  it("never records a shiny for a game that has none", () => {
    const noShiny = SPRITE_SOURCES.filter((s) => !s.shiny).map((s) => s.gen);
    for (const code of MANIFEST.rows) for (const g of noShiny) expect(code[g - 1] === "-" || !(Number(code[g - 1]) & 2)).toBe(true);
  });

  it("has nothing outside the National Dex", () => {
    expect(spriteCode(0)).toBeNull();
    expect(spriteCode(POKEDEX.length + 1)).toBeNull();
    expect(spriteCode(1.5)).toBeNull();
    expect(dexSpriteColumns(99999)).toEqual([]);
  });
});

describe("sprite columns", () => {
  it("starts at the species' own generation", () => {
    expect(dexSpriteColumns(bySlug("ivysaur").id).map((c) => c.gen)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(dexSpriteColumns(bySlug("lucario").id).map((c) => c.gen)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(dexSpriteColumns(bySlug("sprigatito").id).map((c) => c.gen)).toEqual([9]);
  });

  it("links only files the manifest lists, with a dash (null) for the rest", () => {
    const ivysaur = dexSpriteColumns(2);
    const gen = (g: number) => ivysaur.find((c) => c.gen === g)!;
    expect(gen(1).normal).toBe(`${SPRITE_BASE}/versions/generation-i/red-blue/transparent/2.png`);
    expect(gen(1).shiny).toBeNull();
    expect(gen(2).shiny).toBe(`${SPRITE_BASE}/versions/generation-ii/crystal/transparent/shiny/2.png`);
    expect(gen(7).normal).toBe(`${SPRITE_BASE}/versions/generation-vii/ultra-sun-ultra-moon/2.gif`);
    expect(gen(8).shiny).toBeNull();
    expect(gen(9).shiny).toBe(`${SPRITE_BASE}/other/home/shiny/2.png`);
  });

  it("reads the codes' bits", () => {
    const cols = spriteColumns(25, "-----0123");
    expect(cols.map((c) => [c.gen, Boolean(c.normal), Boolean(c.shiny)])).toEqual([
      [6, false, false],
      [7, true, false],
      [8, false, false], // Sword & Shield's icons have no shiny, whatever the code says
      [9, true, true],
    ]);
  });
});
