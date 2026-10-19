import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/pokedle/dex/route";
import { answerFor, compare, evaluate } from "@/lib/server/pokedle";
import { getPokemon, POKEDEX } from "@/lib/pokemon/pokedex";
import { DLE_COLUMNS, type DleDexRow } from "@/lib/dle-types";
import { DLE_PANEL_COLUMNS } from "@/lib/dle-compare";
import { dexClues, ruledOut } from "@/lib/dle-dex";

const dexRows = async () => (await GET().json()) as DleDexRow[];

describe("the Pokédex beside the Pokédle board", () => {
  it("lists exactly the guessable Pokémon, with only their name, generation and types", async () => {
    const rows = await dexRows();
    expect(rows.map((r) => r[0])).toEqual(POKEDEX.map((p) => p.id));
    const pikachu = getPokemon(25)!;
    for (const row of rows) {
      // Nothing about height, weight, color or stage: those clues are worked out from memory.
      expect(row).toHaveLength(5);
      const [id, name, gen, t1, t2] = row;
      const p = getPokemon(id)!;
      // A guess's own clue values (compared against any answer: Pikachu here) are what the row shows.
      const { cells } = compare(p, pikachu);
      expect(name).toBe(p.name);
      expect(String(gen)).toBe(cells.gen.value);
      expect(t1).toBe(cells.type1.value.toLowerCase());
      expect(t2 ?? "none").toBe(cells.type2.value.toLowerCase());
    }
  });

  it("never sends a Pokémon's height, weight, color or stage", async () => {
    const text = await GET().text();
    const snorlax = getPokemon(143)!;
    // Snorlax's row as sent: its weight (4600 hg), height (21 dm) and color are nowhere in it.
    const row = text.match(/\[143,[^\]]*\]/)![0];
    expect(row).toBe(JSON.stringify([143, "Snorlax", 1, "normal", null]));
    expect(row).not.toContain(String(snorlax.weight));
    expect(text).not.toMatch(/"(black|blue|brown|gray|green|pink|purple|red|white|yellow)"/);
  });

  it("is the same list whatever the puzzle, so it can't point at an answer", async () => {
    const [a, b] = await Promise.all([GET().text(), GET().text()]);
    expect(a).toBe(b);
    expect(GET().headers.get("cache-control")).toMatch(/public/);
  });
});

describe("greying out, like Wordle's keyboard", () => {
  it("reads only a board's generation and type clues", () => {
    const answer = answerFor({ id: "practice:dex-a" });
    const [clue] = dexClues(evaluate({ id: "practice:dex-a" }, [answer.id === 6 ? 9 : 6]).rows);
    expect(Object.keys(clue.statuses).sort()).toEqual([...DLE_PANEL_COLUMNS].sort());
  });

  it("greys out exactly what the gen and type clues rule out, never the answer, and nothing for height, weight, color or stage", async () => {
    const rows = await dexRows();
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const puzzle = { id: `practice:dex-${seed}` };
      const answer = answerFor(puzzle);
      const guesses = POKEDEX.filter((p, i) => p.id !== answer.id && i % 197 === seed.charCodeAt(0) % 197).slice(0, 3).map((p) => p.id);
      const board = evaluate(puzzle, guesses).rows;
      const out = ruledOut(rows, dexClues(board));
      expect(out.has(answer.id)).toBe(false);
      for (const p of POKEDEX) {
        // Were p the answer, would every guess have got the same gen and type clues?
        const fits = board.every((r) => {
          const cells = compare(getPokemon(r.id)!, p).cells;
          return DLE_PANEL_COLUMNS.every((c) => cells[c].status === r.cells[c].status);
        });
        expect(out.has(p.id), `${p.name} vs ${answer.name}`).toBe(!fits);
      }
      // Some Pokémon still in play would have got different height, weight, color or stage clues: those are the player's to cross off.
      const stillIn = POKEDEX.filter((p) => !out.has(p.id) && p.id !== answer.id);
      const hidden = stillIn.filter((p) =>
        board.some((r) => {
          const cells = compare(getPokemon(r.id)!, p).cells;
          return DLE_COLUMNS.some((c) => cells[c.key].status !== r.cells[c.key].status);
        })
      );
      expect(hidden.length).toBeGreaterThan(0);
    }
  });

  it("rules nothing out before the first guess", async () => {
    expect(ruledOut(await dexRows(), []).size).toBe(0);
  });
});
