import { describe, expect, it } from "vitest";
import { allFacts, baseOf, categoryById } from "@/lib/pikadoku/categories";
import { matchCells, softLockSafe } from "@/lib/pikadoku/solve";
import { newTtt, playTtt } from "@/lib/pikadoku/tictactoe";
import { checkGuess, dailyGrid, isDexId, replayGuesses } from "@/lib/server/pikadoku";

const byId = (id: number) => allFacts().find((f) => f.id === id)!;
const has = (cat: string, id: number) => categoryById(cat)!.test(byId(id));
const MEGA_X = 10034;
const MEGA_Y = 10035;

describe("forms as separate picks", () => {
  it("includes regional forms, Megas, Gigantamax and notable forms with their own data", () => {
    const names = (kind: string) => allFacts().filter((f) => f.form === kind).map((f) => f.name);
    expect(names("regional")).toContain("Alolan Raichu");
    expect(names("mega")).toContain("Mega Charizard X");
    expect(names("gmax")).toContain("Gigantamax Charizard");
    expect(names("special")).toContain("Partner Pikachu");
    expect(allFacts().some((f) => f.name.toLowerCase().includes("totem"))).toBe(false);
    expect(isDexId(MEGA_X)).toBe(true);
  });

  it("gives a form its own types, and a Mega its species' region", () => {
    expect(has("type:dragon", MEGA_X)).toBe(true);
    expect(has("type:dragon", 6)).toBe(false);
    expect(has("type:flying", MEGA_X)).toBe(false);
    expect(has("type:flying", MEGA_Y)).toBe(true);
    expect(has("region:1", MEGA_X)).toBe(true); // Kanto, the species' region
    expect(has("stat:atk:120", MEGA_X)).toBe(true); // its own stats (130)
    expect(has("stat:atk:120", 6)).toBe(false);
  });

  it("counts a regional form for the region it debuted in", () => {
    const alolan = allFacts().find((f) => f.name === "Alolan Raichu")!;
    expect(alolan.baseId).toBe(26);
    expect(categoryById("region:7")!.test(alolan)).toBe(true);
    expect(categoryById("region:1")!.test(alolan)).toBe(false);
    expect(categoryById("region:1")!.test(byId(26))).toBe(true);
    expect(categoryById("region:hisui")!.test(allFacts().find((f) => f.name === "Hisuian Growlithe")!)).toBe(true);
    expect(alolan.types).toContain("psychic");
  });

  it("never lets a form and its species both be used", () => {
    expect(baseOf(MEGA_X)).toBe(6);
    expect(baseOf(MEGA_Y)).toBe(6);
    expect(baseOf(25)).toBe(25);
    expect(matchCells([{ cell: 0, options: [6, MEGA_X] }, { cell: 1, options: [MEGA_Y, 6] }])).toBeNull();
    expect(matchCells([{ cell: 0, options: [6, MEGA_X] }, { cell: 1, options: [MEGA_Y, 6, 9] }])).not.toBeNull();
    const answers = [[6, MEGA_X], [MEGA_Y], [], [], [], [], [], [], []];
    expect(softLockSafe(answers, new Map(), 0, 6)).toBe(false); // cell 1 would be left with only a form of Charizard
  });

  it("rejects the second of a form and its species in a replay and a check", () => {
    const g = dailyGrid("2026-10-22", "easy");
    const a = 0;
    const b = 1;
    const x = g.answers[a][0];
    const twin = baseOf(x) === x ? g.answers[a].find((i) => baseOf(i) === x && i !== x) : x;
    // A pick used in one cell can't be used again in another, whether as itself or as its form.
    const r = checkGuess(g, [{ cell: a, id: x }], { cell: b, id: x }, { pp: 9, guard: false });
    expect(r.ok).toBe(false);
    expect(() => replayGuesses(g, [{ cell: a, id: x }, { cell: b, id: x }], { pp: 9 })).toThrow();
    expect(twin === undefined || typeof twin === "number").toBe(true);
    // And the form-aware check, on a grid made to have both: Charizard and a Mega in two cells.
    const fake = { rows: [], cols: [], answers: [[6, MEGA_X], [MEGA_X, 6], ...Array(7).fill([1])] } as never;
    expect(checkGuess(fake, [{ cell: 0, id: 6 }], { cell: 1, id: MEGA_X }, { pp: 9, guard: false }).ok).toBe(false);
    expect(() => replayGuesses(fake, [{ cell: 0, id: MEGA_X }, { cell: 1, id: 6 }], { pp: 9 })).toThrow();
  });
});

describe("Tic Tac Toe no-reuse", () => {
  it("treats a form and its species as one Pokémon", () => {
    const first = playTtt(newTtt(), 0, 6, true, baseOf).state;
    expect(playTtt(first, 1, MEGA_X, true, baseOf).outcome).toBe("illegal");
    expect(playTtt(first, 1, 9, true, baseOf).outcome).toBe("claimed");
  });
});
