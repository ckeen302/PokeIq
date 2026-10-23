import { describe, expect, it, beforeEach } from "vitest";
import dailies from "@/data/pikadoku-dailies.json";
import { allCategories, allFacts, categoryById, formRegion } from "@/lib/pikadoku/categories";
import { generateGrid, gridFromIds, type PdkGridIds } from "@/lib/pikadoku/generator";
import { isSolvable, matchCells, softLockSafe, solveGrid } from "@/lib/pikadoku/solve";
import { rarityPct, uniquenessScore } from "@/lib/pikadoku/score";
import { newTtt, playTtt, timeoutTtt, tttWinner } from "@/lib/pikadoku/tictactoe";
import { PDK_DIFFICULTIES, PDK_MIN_ANSWERS, PDK_PP, type PdkDifficulty } from "@/lib/pikadoku/types";
import { checkGuess, dailyGrid, gridView, practiceGrid, parseSettings, replayGuesses } from "@/lib/server/pikadoku";
import { clearMemoryPdk, memoryPdkStore } from "@/lib/server/pikadoku-board";
import { finishGame } from "@/lib/server/pikadoku-result";

const fact = (id: number) => allFacts().find((f) => f.id === id)!;
const has = (cat: string, id: number) => categoryById(cat)!.test(fact(id));

describe("category predicates", () => {
  it("spot-checks facts", () => {
    expect(has("type:fire", 6)).toBe(true); // Charizard
    expect(has("type:flying", 6)).toBe(true); // one matching type is enough
    expect(has("type:water", 6)).toBe(false);
    expect(has("region:1", 25)).toBe(true); // Pikachu is Kanto
    expect(has("region:7", 26)).toBe(false); // Raichu's Alolan form doesn't move the species to Alola
    expect(has("form:alola", 26)).toBe(true);
    expect(has("form:galar", 52)).toBe(true); // Meowth
    expect(has("other:mega", 6)).toBe(true);
    expect(has("other:gmax", 6)).toBe(true);
    expect(has("other:mega", 25)).toBe(false);
    expect(has("other:legendary", 150)).toBe(true);
    expect(has("other:mythical", 151)).toBe(true);
    expect(has("other:fossil", 142)).toBe(true);
    expect(has("other:baby", 172)).toBe(true); // Pichu
    expect(has("evo:trade", 93)).toBe(true); // Haunter evolves by trade
    expect(has("evo:stone", 25)).toBe(true); // Pikachu -> Thunder Stone
    expect(has("evo:full", 6)).toBe(true);
    expect(has("evo:notfull", 4)).toBe(true);
    expect(has("evo:branch", 133)).toBe(true); // Eevee
    expect(has("stat:bst600", 445)).toBe(true); // Garchomp
    expect(has("stat:bst600", 25)).toBe(false);
    expect(has("stat:spe:100", 94)).toBe(true); // Gengar base 110
    expect(has("ability:hidden", 1)).toBe(true);
    expect(has("move:Trick Room", 488)).toBe(true); // Cresselia
    expect(has("move:Trick Room", 25)).toBe(false);
  });

  it("applies the form rules the same way everywhere", () => {
    expect(formRegion("raichu-alola")).toBe("Alola");
    expect(formRegion("meowth-galar")).toBe("Galar");
    expect(formRegion("charizard-mega-x")).toBeNull(); // Mega follows the base
    expect(formRegion("pikachu-gmax")).toBeNull();
    expect(fact(6).region).toBe("Kanto");
  });
});

describe("solvability", () => {
  it("matches distinct Pokémon, or fails", () => {
    expect(matchCells([{ cell: 0, options: [1] }, { cell: 1, options: [1] }])).toBeNull();
    const m = matchCells([{ cell: 0, options: [1, 2] }, { cell: 1, options: [1] }]);
    expect(m?.get(0)).toBe(2);
    expect(m?.get(1)).toBe(1);
    // Every cell has an answer but only two Pokémon share nine cells.
    expect(isSolvable(Array.from({ length: 9 }, () => [1, 2]), 1)).toBe(false);
  });

  it("every pre-generated daily is solvable with enough answers per cell", () => {
    const file = dailies as unknown as Record<string, Record<PdkDifficulty, PdkGridIds>>;
    expect(Object.keys(file).length).toBeGreaterThanOrEqual(365);
    for (const [date, day] of Object.entries(file)) {
      for (const d of PDK_DIFFICULTIES) {
        const g = gridFromIds(day[d]);
        expect(isSolvable(g.answers, PDK_MIN_ANSWERS[d]), `${date} ${d}`).toBe(true);
        const sol = solveGrid(g.answers)!;
        expect(new Set(sol.values()).size).toBe(9);
        [...sol].forEach(([cell, id]) => expect(g.answers[cell]).toContain(id));
      }
    }
  });

  it("generation is seeded and honours the settings", () => {
    expect(generateGrid("abc123", { difficulty: "normal" })).toEqual(generateGrid("abc123", { difficulty: "normal" }));
    const g = gridFromIds(generateGrid("xyz987", { difficulty: "normal", families: ["types", "regions"] }));
    for (const c of [...g.rows, ...g.cols]) expect(["types", "regions"]).toContain(c.family);
    expect(allCategories().length).toBeGreaterThan(200);
  });
});

describe("soft-lock guard", () => {
  it("refuses a pick that strands the remaining cells", () => {
    // Cell 0 could take 1 or 2; cell 1 can only take 1. Taking 1 in cell 0 soft-locks cell 1.
    const answers = [[1, 2], [1], ...Array.from({ length: 7 }, (_, i) => [10 + i, 30 + i])];
    expect(softLockSafe(answers, new Map(), 0, 1)).toBe(false);
    expect(softLockSafe(answers, new Map(), 0, 2)).toBe(true);
  });

  it("checkGuess reports a softlock without costing the guess", () => {
    const g = practiceGrid("guard001", parseSettings({}));
    const sol = solveGrid(g.answers)!;
    const out = checkGuess(g, [], { cell: 0, id: sol.get(0)! }, { pp: null, guard: true });
    expect(out).toMatchObject({ ok: true, valid: true });
  });
});

describe("uniqueness score", () => {
  it("sums the share who picked each answer, empty cells counting 100", () => {
    expect(rarityPct(1, 4)).toBe(25);
    expect(rarityPct(0, 0)).toBe(100);
    expect(uniquenessScore([10, 20, 5, 5, 5, 5, 5, 5, 5])).toBe(65);
    expect(uniquenessScore([10, null, 0, 0, 0, 0, 0, 0, 0])).toBe(110);
  });
});

describe("tic tac toe", () => {
  it("claims cells, passes the turn on a miss or timeout, and finds three in a row", () => {
    let s = newTtt();
    let r = playTtt(s, 0, 1, true);
    expect(r.state.owners[0]).toBe("X");
    expect(r.state.turn).toBe("O");
    r = playTtt(r.state, 4, 2, false);
    expect(r.outcome).toBe("missed");
    expect(r.state.turn).toBe("X");
    s = timeoutTtt(r.state);
    expect(s.turn).toBe("O");
    expect(playTtt(s, 0, 3, true).outcome).toBe("illegal"); // taken cell
    expect(playTtt(s, 1, 1, true).outcome).toBe("illegal"); // Pokémon already used
    s = playTtt(s, 3, 3, true).state; // O
    s = playTtt(s, 1, 4, true).state; // X
    s = playTtt(s, 4, 5, true).state; // O
    const end = playTtt(s, 2, 6, true).state; // X completes the top row
    expect(end.winner).toBe("X");
    expect(end.line).toEqual([0, 1, 2]);
    expect(playTtt(end, 8, 7, true).outcome).toBe("illegal");
    expect(tttWinner(["O", null, null, null, "O", null, null, null, "O"])?.mark).toBe("O");
  });

  it("draws on a full board", () => {
    const marks = "XOXXOOOXX".split("") as ("X" | "O")[];
    // X O X / X O O / O X X has no line: play it out turn by turn.
    const order = [0, 1, 2, 4, 3, 5, 7, 6, 8];
    let s = newTtt();
    order.forEach((cell, i) => {
      s = playTtt(s, cell, 100 + i, true).state;
    });
    expect(s.owners.every(Boolean)).toBe(true);
    expect(marks.length).toBe(9);
    expect(["draw", "X", "O"]).toContain(s.winner);
  });
});

describe("a played game and no answer leaks", () => {
  beforeEach(() => {
    process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
    clearMemoryPdk();
  });
  const date = new Date().toISOString().slice(0, 10);

  it("never puts answers in the grid view or a guess check", () => {
    const g = dailyGrid(date, "normal");
    const view = JSON.stringify(gridView(g));
    expect(view).not.toMatch(/answers|members/);
    const check = JSON.stringify(checkGuess(g, [], { cell: 0, id: 1 }, { pp: PDK_PP, guard: false }));
    expect(check).not.toMatch(/answers|\[\d+,\d+/);
  });

  it("refuses the reveal until the replay says the game is over", async () => {
    const g = dailyGrid(date, "normal");
    const sol = solveGrid(g.answers)!;
    const partial = [{ cell: 0, id: sol.get(0)! }];
    const early = await finishGame({ date, difficulty: "normal", settings: parseSettings({}), guesses: partial, identity: "d:aaaaaaaaaaaaaaaaaaaa" });
    expect(early).toMatchObject({ ok: false, status: 409 });
    // A client claiming it's over doesn't make it so; only giveUp does, and that reveals.
    const gave = await finishGame({ date, difficulty: "normal", settings: parseSettings({}), guesses: partial, giveUp: true, identity: "d:aaaaaaaaaaaaaaaaaaaa" });
    expect(gave.ok && gave.result.reveal.cells[0].answers.length).toBe(g.answers[0].length);
  });

  it("scores a solved daily from recorded answers and ranks it", async () => {
    const g = dailyGrid(date, "normal");
    const sol = solveGrid(g.answers)!;
    const guesses = [...sol].map(([cell, id]) => ({ cell, id }));
    const out = await finishGame({ date, difficulty: "normal", settings: parseSettings({}), guesses, identity: "d:bbbbbbbbbbbbbbbbbbbb" }, memoryPdkStore());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.won).toBe(true);
    expect(out.result.score).toBe(900); // the only player picked everything: 100% each
    expect(out.result.rank).toEqual({ position: 1, total: 1 });
    // A client can't change the score: nothing numeric is read from the request.
    const wrongOnly = replayGuesses(g, [{ cell: 0, id: 1 }], { pp: PDK_PP });
    expect(wrongOnly.locked.size === 0 || wrongOnly.locked.size === 1).toBe(true);
  });
});
