import { describe, expect, it } from "vitest";
import { BABY_IDS, compare, dleStage, evaluate, hardModeError, traitsOf, answerFor } from "@/lib/server/pokedle";
import { clueStatus, compareTraits, DLE_PANEL_COLUMNS, panelMisfit, type DleTraits } from "@/lib/dle-compare";
import { getPokemon, POKEDEX } from "@/lib/pokemon/pokedex";
import { DLE_COLUMNS, DLE_HINT_COST, dleScore, type DleColumn } from "@/lib/dle-types";
import { DLE_DUEL_HINT_COST, dleDuelBase } from "@/lib/pvp-types";

const byName = (name: string) => POKEDEX.find((p) => p.name === name)!;
const statuses = (g: DleTraits, a: DleTraits) => DLE_COLUMNS.map((c) => clueStatus(c.key, g, a));

describe("evolution stage", () => {
  it("knows exactly the baby Pokémon, each the first of a family that evolves", () => {
    const names = [...BABY_IDS].map((id) => getPokemon(id)!.name);
    expect(names).toEqual([
      "Pichu", "Cleffa", "Igglybuff", "Togepi", "Tyrogue", "Smoochum", "Elekid", "Magby", "Azurill", "Wynaut",
      "Budew", "Chingling", "Bonsly", "Mime Jr.", "Happiny", "Munchlax", "Riolu", "Mantyke", "Toxel",
    ]);
    for (const id of BABY_IDS) {
      expect(getPokemon(id)!.evolvesFrom).toBeNull();
      expect(POKEDEX.some((p) => p.evolvesFrom === id)).toBe(true);
    }
  });

  it("ignores babies: Pichu is a Baby, Pikachu 1, Raichu 2; Togepi a Baby, Togekiss 2", () => {
    expect(["Pichu", "Pikachu", "Raichu", "Togepi", "Togetic", "Togekiss", "Bulbasaur", "Venusaur", "Budew", "Roselia", "Roserade"].map((n) => dleStage(byName(n)))).toEqual([
      0, 1, 2, 0, 1, 2, 1, 3, 0, 1, 2,
    ]);
    for (const p of POKEDEX) expect(dleStage(p)).toBeGreaterThanOrEqual(BABY_IDS.has(p.id) ? 0 : 1);
  });
});

describe("close clues", () => {
  it("marks gen, height, weight and stage close, keeping the direction", () => {
    const row = compare(byName("Pikachu"), byName("Raichu"));
    expect(row.cells.stage).toEqual({ value: "1", status: "close-higher" });
    expect(row.cells.height!.status).toBe("higher"); // 0.4 m vs 0.8 m: twice as tall, not close
    const g = (gen: number) => ({ ...traitsOf(byName("Pikachu")), gen });
    expect(clueStatus("gen", g(3), g(4))).toBe("close-higher");
    expect(clueStatus("gen", g(3), g(5))).toBe("higher");
    const h = (height: number) => ({ ...traitsOf(byName("Pikachu")), height });
    expect(clueStatus("height", h(10), h(12))).toBe("close-higher");
    expect(clueStatus("height", h(10), h(13))).toBe("higher");
    expect(clueStatus("height", h(2), h(1))).toBe("close-lower"); // 0.1 m apart
    const s = (stage: number) => ({ ...traitsOf(byName("Pikachu")), stage });
    expect(clueStatus("stage", s(0), s(1))).toBe("higher"); // a Baby is never close
    expect(clueStatus("stage", s(3), s(2))).toBe("close-lower");
    expect(clueStatus("stage", s(1), s(3))).toBe("higher");
  });
});

describe("hard mode", () => {
  const puzzle = { id: "practice:hardtest" };
  const answer = answerFor(puzzle);

  const panelStatuses = (g: DleTraits, a: DleTraits) => DLE_PANEL_COLUMNS.map((c) => clueStatus(c, g, a)).join();

  it("accepts a guess exactly when it would have given every earlier guess the same gen and type clues", () => {
    const first = POKEDEX.find((p) => p.id !== answer.id)!;
    const want = compareTraits(traitsOf(first), traitsOf(answer));
    let fits = 0;
    for (const c of POKEDEX.slice(0, 400)) {
      if (c.id === first.id) continue;
      const same = panelStatuses(traitsOf(first), traitsOf(c)) === panelStatuses(traitsOf(first), traitsOf(answer));
      expect(panelMisfit(traitsOf(first), want, traitsOf(c)) === null).toBe(same);
      expect(hardModeError(puzzle, [first.id, c.id]) === null).toBe(same);
      if (same) fits++;
    }
    expect(hardModeError(puzzle, [first.id, answer.id])).toBeNull();
    expect(fits).toBeGreaterThan(0);
  });

  it("never checks height, weight, color or stage, so a turned-down guess gives none of them away", () => {
    // Guesses that fit the first guess's gen and type clues but not all of its clues: hard mode lets them all through.
    const first = POKEDEX.find((p) => p.id !== answer.id)!;
    const sneaky = POKEDEX.filter(
      (c) =>
        c.id !== first.id &&
        c.id !== answer.id &&
        panelStatuses(traitsOf(first), traitsOf(c)) === panelStatuses(traitsOf(first), traitsOf(answer)) &&
        statuses(traitsOf(first), traitsOf(c)).join() !== statuses(traitsOf(first), traitsOf(answer)).join()
    );
    expect(sneaky.length).toBeGreaterThan(0);
    for (const c of sneaky) expect(hardModeError(puzzle, [first.id, c.id])).toBeNull();
  });

  it("names the clue a misfit breaks", () => {
    const first = POKEDEX.find((p) => p.id !== answer.id && p.gen !== answer.gen)!;
    const wrong = POKEDEX.find((p) => p.id !== first.id && p.gen === first.gen)!;
    expect(hardModeError(puzzle, [first.id, wrong.id])).toMatch(/^Hard mode: .+ doesn't fit the Gen clue from /);
  });
});

describe("hints and points", () => {
  it("shows no hint unless asked for, and only after a guess while the puzzle is on", () => {
    const puzzle = { id: "practice:hints" };
    const answer = answerFor(puzzle);
    const miss = POKEDEX.filter((p) => p.id !== answer.id).slice(0, 7).map((p) => p.id);
    expect(evaluate(puzzle, miss).hints).toEqual({ silhouetteUrl: undefined, genus: undefined });
    expect(evaluate(puzzle, [], ["genus", "silhouette"]).hints).toEqual({ silhouetteUrl: undefined, genus: undefined });
    const asked = evaluate(puzzle, miss.slice(0, 1), ["genus"]).hints;
    expect(asked.genus).toBe(`The ${answer.genus}`);
    expect(asked.silhouetteUrl).toBeUndefined();
    expect(evaluate(puzzle, [...miss, answer.id], ["genus"]).hints.genus).toBeUndefined();
  });

  it("scores solo as a duel round does, without the speed bonus", () => {
    expect(DLE_DUEL_HINT_COST).toBe(DLE_HINT_COST);
    for (let n = 1; n <= 8; n++) expect(dleScore(n, true, [])).toBe(dleDuelBase(n));
    expect([dleScore(1, true, []), dleScore(8, true, [])]).toEqual([1000, 300]);
    expect(dleScore(3, true, ["silhouette"])).toBe(dleDuelBase(3) - 300);
    expect(dleScore(8, true, ["genus", "silhouette"])).toBe(0);
    expect(dleScore(5, false, [])).toBe(0);
  });
});

it("compares every column the board shows", () => {
  const cols: DleColumn[] = DLE_COLUMNS.map((c) => c.key);
  expect(Object.keys(compare(byName("Mew"), byName("Mewtwo")).cells).sort()).toEqual([...cols].sort());
});
