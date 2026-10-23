import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import dailies from "@/data/connections-dailies.json";
import { CATEGORIES, categoryOf } from "@/lib/connections/categories";
import { BOX_LEGENDARIES, FOOD_NAMES, GYM_ACES, SIGNATURE_MOVES, resolveEntries, signatureMoveIds } from "@/lib/connections/curated";
import { FACTS, type Facts } from "@/lib/connections/facts";
import { validatePuzzle } from "@/lib/connections/generator";
import { dailyConnPuzzle, explainGroup } from "@/lib/server/connections";

const byName = (name: string): Facts => {
  const f = FACTS.find((x) => x.name === name);
  if (!f) throw new Error(name);
  return f;
};
const fits = (category: string, name: string) => categoryOf(category).test(byName(name));
const NEW = (id: string) => id.startsWith("wordplay:") || id.startsWith("lore:");

describe("name wordplay", () => {
  it("finds colours, body parts and words in names", () => {
    expect(["Loudred", "Goldeen", "Golduck", "Roselia", "Vileplume", "Crustle"].every((n) => fits("wordplay:colour", n))).toBe(true);
    expect(fits("wordplay:colour", "Pikachu")).toBe(false);
    expect(categoryOf("wordplay:colour").why(byName("Loudred"))).toBe("Loud[red]");
    expect(categoryOf("wordplay:body").why(byName("Charmander"))).toBe("Ch[arm]ander");
    expect(categoryOf("wordplay:body").why(byName("Politoed"))).toBe("Poli[toe]d");
    expect(["Cubone", "Rhyhorn", "Chinchou", "Nosepass", "Toedscool", "Clawitzer"].every((n) => fits("wordplay:body", n))).toBe(true);
    expect(fits("wordplay:body", "Pikachu")).toBe(false);
    expect(categoryOf("wordplay:word").why(byName("Slowpoke"))).toBe("“slow” + “poke”");
    expect(["Slowpoke", "Starmie", "Beartic", "Bellsprout"].every((n) => fits("wordplay:word", n))).toBe(true);
    expect(fits("wordplay:word", "Rattata")).toBe(false); // "rat" is only in the guard
    expect(categoryOf("wordplay:word").guard!(byName("Rattata"))).toBe(true);
  });

  it("rhymes by the last three letters", () => {
    const rhyme = CATEGORIES.filter((c) => c.id.startsWith("wordplay:rhyme:"));
    expect(rhyme.length).toBeGreaterThan(0);
    for (const c of rhyme) {
      const ending = c.id.split(":")[2];
      const members = FACTS.filter((f) => c.test(f));
      expect(ending.length).toBeGreaterThanOrEqual(3);
      expect(members.every((f) => f.name.toLowerCase().endsWith(ending))).toBe(true);
      expect(new Set(members.filter((f) => f.pooled).map((f) => f.familyKey)).size).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("hand-checked lists", () => {
  it("resolves every entry to a Pokémon", () => {
    for (const list of [GYM_ACES, BOX_LEGENDARIES, FOOD_NAMES]) expect(resolveEntries(list).size).toBe(list.length);
  });

  it("spot-checks the facts", () => {
    expect(categoryOf("lore:ace").why(byName("Miltank"))).toContain("Whitney");
    expect(categoryOf("lore:ace").why(byName("Starmie"))).toContain("Misty");
    expect(fits("lore:ace", "Pikachu")).toBe(false);
    expect(categoryOf("lore:box").why(byName("Lugia"))).toContain("Silver");
    expect(categoryOf("lore:box").why(byName("Koraidon"))).toBe("Scarlet");
    expect(fits("lore:box", "Mewtwo")).toBe(false); // never a main-game cover
    expect(fits("lore:food", "Applin")).toBe(true);
    expect(categoryOf("lore:food").why(byName("Fidough"))).toBe("dough");
    expect(fits("lore:food", "Bulbasaur")).toBe(false);
  });

  it("keeps each list big enough to make a group", () => {
    for (const id of ["lore:ace", "lore:box", "lore:food", "lore:move", "wordplay:colour", "wordplay:body", "wordplay:word"]) {
      expect(CATEGORIES.some((c) => c.id === id), id).toBe(true);
    }
  });

  it("signature moves: exactly one evolution family learns each", () => {
    const ids = signatureMoveIds();
    expect(ids.size).toBe(SIGNATURE_MOVES.length);
    for (const [move, name] of ids) {
      const families = new Set(FACTS.filter((f) => f.learnable.has(move)).map((f) => f.familyKey));
      expect(families.size, name).toBe(1);
    }
    expect(categoryOf("lore:move").why(byName("Lugia"))).toBe("the only one to learn Aeroblast");
    expect(fits("lore:move", "Dialga")).toBe(true);
    expect(fits("lore:move", "Pikachu")).toBe(false);
  });
});

describe("in the dailies", () => {
  it("leaves every daily up to tomorrow exactly as it was", () => {
    const frozen = createHash("sha256").update(`${JSON.stringify(dailies.puzzles.slice(0, 3))}\n`).digest("hex");
    expect(frozen).toBe("edf23e35baa41362890ceae9d6496c7fdec7062cffcdf5f5f1743d9308d45378");
  });

  it("uses them only as blue or purple groups, every tile fitting one group", () => {
    let used = 0;
    dailies.puzzles.forEach((entry, day) => {
      const puzzle = dailyConnPuzzle(new Date(Date.parse("2026-10-22T00:00:00Z") + day * 86_400_000).toISOString().slice(0, 10));
      expect(validatePuzzle(puzzle), `day ${day + 1}`).toEqual([]);
      puzzle.groups.forEach((g, level) => {
        if (!NEW(g.category)) return;
        used++;
        expect(level, `${g.category} on day ${day + 1}`).toBeGreaterThanOrEqual(2);
        const lines = explainGroup(puzzle, level as 0 | 1 | 2 | 3).lines;
        expect(lines).toHaveLength(4);
        expect(lines.every((l) => l.why.length > 0)).toBe(true);
      });
      expect(entry.g).toHaveLength(4);
    });
    expect(used).toBeGreaterThan(50);
  });
});
