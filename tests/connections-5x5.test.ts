import { describe, expect, it } from "vitest";
import { DIFFICULTY_BANDS_5, generatePuzzle, isUniquelySolvable, playGuesses, validatePuzzle } from "@/lib/connections/generator";
import { solveGrid } from "@/lib/connections/solver";
import { parsePracticeSeed } from "@/lib/connections/pack-seed";
import { connMaxMistakes, guessKey } from "@/lib/connections/types";
import { checkGuesses, practiceConnPuzzle, puzzleView } from "@/lib/server/connections";
import { connectionsView, createConnectionsDuel, duelPuzzle, guessConnections, type ConnectionsDuel } from "@/lib/server/connections-duel";
import { joinDuel, readyDuel, rematchOf } from "@/lib/server/duels";
import type { PvpOutcome } from "@/lib/server/duel-core";
import { PVP_LEAD_MS } from "@/lib/pvp-types";
import { connectionsShareText, connSizeOf } from "@/lib/share";
import { decodeShare, encodeShare } from "@/lib/share/payload";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const DIFFICULTIES = Object.keys(DIFFICULTY_BANDS_5) as (keyof typeof DIFFICULTY_BANDS_5)[];

describe("5×5 generation", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty}: five fair groups of five with exactly one solution`, () => {
      for (let i = 0; i < 6; i++) {
        const p = generatePuzzle(`t5:${difficulty}:${i}`, { size: 5, difficulty });
        expect(p.groups).toHaveLength(5);
        expect(p.groups.every((g) => g.members.length === 5)).toBe(true);
        expect(p.tiles).toHaveLength(25);
        expect(new Set(p.tiles).size).toBe(25);
        // No Pokémon fits two groups' rules (validatePuzzle) ...
        expect(validatePuzzle(p)).toEqual([]);
        // ... and no other way to split the board exists: the one solution is the puzzle's own.
        const solutions = solveGrid(p.tiles);
        expect(solutions).toHaveLength(1);
        expect(solutions[0].map(guessKey).sort()).toEqual(p.groups.map((g) => guessKey(g.members)).sort());
        expect(isUniquelySolvable(p.tiles)).toBe(true);
      }
    });
  }

  it("is deterministic, and leaves 4×4 puzzles untouched", () => {
    expect(generatePuzzle("same", { size: 5 })).toEqual(generatePuzzle("same", { size: 5 }));
    expect(generatePuzzle("same")).toEqual(generatePuzzle("same", { size: 4 }));
    expect(generatePuzzle("same").groups).toHaveLength(4);
  });

  it("uses five different difficulty bands' worth of groups, easiest first", () => {
    const p = generatePuzzle("order", { size: 5, difficulty: "normal" });
    expect(new Set(p.groups.map((g) => g.category)).size).toBe(5);
  });

  it("flags a board with two ways to split it", () => {
    const p = generatePuzzle("amb", { size: 5 });
    // Two tiles swapped between groups: not a fair puzzle any more.
    const groups = p.groups.map((g) => ({ ...g, members: [...g.members] }));
    [groups[0].members[0], groups[1].members[0]] = [groups[1].members[0], groups[0].members[0]];
    expect(validatePuzzle({ groups }).length).toBeGreaterThan(0);
  });

  it("rejects the wrong number of groups or tiles", () => {
    const p = generatePuzzle("shape", { size: 5 });
    expect(validatePuzzle({ groups: p.groups.slice(0, 3) }).length).toBeGreaterThan(0);
    expect(validatePuzzle({ groups: p.groups.map((g) => ({ ...g, members: g.members.slice(0, 4) })) }).length).toBeGreaterThan(0);
  });
});

describe("5×5 validation and mistakes", () => {
  const puzzle = generatePuzzle("play5", { size: 5 });
  const [g0, g1] = puzzle.groups.map((g) => g.members);
  /** Five tiles that aren't a group, and aren't one away: three of one group, two of another. */
  const miss = (n: number) => [g0[n % 5], g0[(n + 1) % 5], g0[(n + 2) % 5], g1[n % 5], g1[(n + 1) % 5]];

  it("allows five mistakes, and the fifth ends the game", () => {
    expect(connMaxMistakes(5)).toBe(5);
    const s = playGuesses(puzzle, [miss(0), miss(1), miss(2), miss(3)]);
    expect(s.mistakes).toBe(4);
    expect(s.over).toBe(false);
    const done = playGuesses(puzzle, [miss(0), miss(1), miss(2), miss(3), miss(4)]);
    expect(done.mistakes).toBe(5);
    expect(done.over).toBe(true);
    expect(done.won).toBe(false);
  });

  it("a 4×4 board still ends on the fourth mistake", () => {
    const p4 = generatePuzzle("play4");
    const [a, b] = p4.groups.map((g) => g.members);
    const bad = (k: number) => [a[k % 4], a[(k + 1) % 4], b[k % 4], b[(k + 1) % 4]];
    expect(playGuesses(p4, [bad(0), bad(1), bad(2)]).over).toBe(false);
    expect(playGuesses(p4, [bad(0), bad(1), bad(2), bad(3)]).over).toBe(true);
  });

  it("wins on the fifth group, one away counts four of five", () => {
    const oneAway = [...g0.slice(0, 4), g1[0]];
    const s = playGuesses(puzzle, [oneAway, ...puzzle.groups.map((g) => g.members)]);
    expect(s.results[0].kind).toBe("one-away");
    expect(s.mistakes).toBe(1);
    expect(s.won).toBe(true);
    expect(s.found).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses a guess of the wrong size, repeated tiles or tiles off the grid", () => {
    expect(() => playGuesses(puzzle, [g0.slice(0, 4)])).toThrow();
    expect(() => playGuesses(puzzle, [[...g0.slice(0, 4), g0[0]]])).toThrow();
    expect(() => playGuesses(puzzle, [[...g0.slice(0, 4), 999_999]])).toThrow();
    const p4 = generatePuzzle("play4");
    expect(() => playGuesses(p4, [[...p4.groups[0].members, p4.groups[1].members[0]]])).toThrow();
  });

  it("the server reveals all five groups, explained, when it's over", () => {
    const res = checkGuesses(puzzle, puzzle.groups.map((g) => g.members));
    expect(res.won).toBe(true);
    expect(res.found).toHaveLength(5);
    expect(res.reveal).toHaveLength(5);
    expect(res.reveal!.map((g) => g.level)).toEqual([0, 1, 2, 3, 4]);
    expect(checkGuesses(puzzle, [miss(0)]).reveal).toBeUndefined();
  });
});

describe("5×5 in Unlimited", () => {
  it("reads the size out of the seed", () => {
    expect(parsePracticeSeed("s5-hard-abcd1234")).toEqual({ size: 5, difficulty: "hard" });
    expect(parsePracticeSeed("s5-abcd1234")).toEqual({ size: 5 });
    expect(parsePracticeSeed("hard-abcd1234")).toEqual({ difficulty: "hard" });
    expect(parsePracticeSeed("s5-kanto-easy-abcd1234")).toEqual({ size: 5, pack: "kanto", difficulty: "easy" });
  });

  it("deals 25 tiles for an s5- seed, 16 otherwise", () => {
    for (const level of ["easy", "normal", "hard"]) {
      const big = practiceConnPuzzle(`s5-${level}-seed1abc`);
      expect(big.groups).toHaveLength(5);
      expect(puzzleView(big, "practice:x").size).toBe(5);
      expect(puzzleView(big, "practice:x").tiles).toHaveLength(25);
    }
    const small = practiceConnPuzzle("hard-seed1abc");
    expect(puzzleView(small, "practice:x").size).toBeUndefined();
    expect(puzzleView(small, "practice:x").tiles).toHaveLength(16);
  });

  it("a pack in a 5×5 seed is ignored (packs are too small for five groups of five)", () => {
    for (const pack of ["kanto-", "gen9-", "competitive-"]) expect(practiceConnPuzzle(`s5-${pack}hard-seed2abc`).groups).toHaveLength(5);
  });
});

describe("5×5 duels", () => {
  const T0 = 1_800_000_000_000;
  const must = (out: PvpOutcome<ConnectionsDuel>): ConnectionsDuel => {
    if (!out.ok) throw new Error(out.error);
    return out.duel;
  };
  function started(size?: 5) {
    const { duel, playerId: red } = createConnectionsDuel("Red", "abcdefgh", T0, "five-seed", { size });
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    const t = T0 + 2000;
    const d = must(readyDuel(must(readyDuel(joined.duel, red, true, t)), joined.playerId, true, t));
    return { d, red, blue: joined.playerId, start: t + PVP_LEAD_MS };
  }

  it("the creator's size reaches the joiner's view, before and during the race", () => {
    const { duel } = createConnectionsDuel("Red", "abcdefgh", T0, "five-seed", { size: 5 });
    expect(duel.size).toBe(5);
    expect(connectionsView(duel, null, T0, 0).size).toBe(5);
    const { d, blue, start } = started(5);
    const view = connectionsView(d, blue, start + 1000, 1);
    expect(view.size).toBe(5);
    expect(view.tiles).toHaveLength(25);
    expect(connectionsView(createConnectionsDuel("Red", "abcdefgh", T0, "x").duel, null, T0, 0).size).toBeUndefined();
  });

  it("deals the 5×5 puzzle and checks guesses of five", () => {
    const { d, red, start } = started(5);
    const puzzle = duelPuzzle(d);
    expect(puzzle.groups).toHaveLength(5);
    const [g0] = puzzle.groups.map((g) => g.members);
    const four = guessConnections(d, red, g0.slice(0, 4), start + 1000);
    expect(four.ok).toBe(false);
    const ok = must(guessConnections(d, red, g0, start + 2000));
    expect(connectionsView(ok, red, start + 2000, 2).mine!.found).toHaveLength(1);
    // The duel's own seed is not the practice one: a 4×4 duel of the same seed is a different puzzle.
    expect(duelPuzzle({ seed: d.seed })).not.toEqual(puzzle);
  });

  it("five mistakes put a trainer out", () => {
    const { d, red, start } = started(5);
    const [g0, g1] = duelPuzzle(d).groups.map((g) => g.members);
    let cur = d;
    for (let i = 0; i < 5; i++) cur = must(guessConnections(cur, red, [g0[i % 5], g0[(i + 1) % 5], g0[(i + 2) % 5], g1[i % 5], g1[(i + 1) % 5]], start + 1000 * (i + 1)));
    const view = connectionsView(cur, red, start + 6000, 3);
    expect(view.boards[0].mistakes).toBe(5);
    expect(view.boards[0].out).toBe(true);
  });

  it("a 4×4 duel still wants four", () => {
    const { d, red, start } = started();
    const g0 = duelPuzzle(d).groups[0].members;
    expect(guessConnections(d, red, [...g0, 1], start + 1000).ok).toBe(false);
    expect(must(guessConnections(d, red, g0, start + 2000)).boards[0].guesses).toHaveLength(1);
  });

  it("a rematch keeps the size; ranked duels are always 4×4", () => {
    const { d } = started(5);
    expect((rematchOf(d, "zzzzzzzz", T0 + 999_000) as ConnectionsDuel).size).toBe(5);
    const four = started().d;
    expect((rematchOf(four, "zzzzzzzz", T0 + 999_000) as ConnectionsDuel).size).toBeUndefined();
    const ranked = createConnectionsDuel("Red", "abcdefgh", T0, "r", { size: 5, queue: "ranked", ranked: { season: "s", ratings: [1000, 1000], games: [0, 0], keys: ["a", "b"] } });
    expect(ranked.duel.size).toBeUndefined();
  });
});

describe("5×5 share", () => {
  const rows5 = ["00004", "00000", "11111", "22222", "33333", "44444"];
  const result = { game: "connections" as const, solved: true, rows: rows5 };

  it("draws five squares per row, red for the fifth group", () => {
    expect(connSizeOf(rows5)).toBe(5);
    const text = connectionsShareText(result);
    expect(text).toContain("PokéConnections Practice 5×5");
    expect(text).toContain("🟨🟨🟨🟨🟥");
    expect(text).toContain("🟥🟥🟥🟥🟥");
    expect(text).toContain("1 mistake");
  });

  it("round-trips through a share link, and 4×4 rows still do", () => {
    expect(decodeShare(encodeShare(result))).toEqual(result);
    const four = { game: "connections" as const, solved: true, rows: ["0011", "0000", "1111", "2222", "3333"] };
    expect(decodeShare(encodeShare(four))).toEqual(four);
    // A fifth-group digit has no place on a 4×4 board.
    expect(decodeShare(encodeShare({ ...four, rows: ["0014", "0000", "1111", "2222", "3333"] }))).toBeNull();
  });

  it("refuses forged 5×5 rows", () => {
    // A fifth-group digit in a four-wide row, mixed widths, too many mistakes, or an unsolved game that ends on a group.
    expect(decodeShare(encodeShare({ ...result, rows: ["00004", "0000"] }))).toBeNull();
    expect(decodeShare(encodeShare({ ...result, solved: true, rows: ["00004", "00041", "00014", "00114", "01114", "11114", "11111"] }))).toBeNull();
    expect(decodeShare(encodeShare({ ...result, solved: true, rows: ["11111", "11111"] }))).toBeNull();
  });
});
