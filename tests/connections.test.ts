import { describe, expect, it, beforeEach } from "vitest";
import dailies from "@/data/connections-dailies.json";
import { CATEGORIES, categoryOf } from "@/lib/connections/categories";
import { factsOf, type Facts } from "@/lib/connections/facts";
import { generatePuzzle, herringsOf, playGuesses, validatePuzzle, type Puzzle } from "@/lib/connections/generator";
import { CONN_LAUNCH_DATE, connNumber, isCurrentConnDate, isPlayableConnDate } from "@/lib/connections/types";
import { checkGuesses, dailyConnPuzzle, practiceConnPuzzle, puzzleView } from "@/lib/server/connections";
import { clearMemoryConnResults, memoryConnStore, recordConnResult } from "@/lib/server/connections-results";
import { connectionsShareText, decodeShare, describeShare, encodeShare, type ConnectionsShareResult } from "@/lib/share";
import { normalizeProgress, mergeProgress } from "@/lib/progress-merge";

const byName = (name: string): Facts => {
  for (let id = 1; id <= 1025; id++) if (factsOf(id).name === name) return factsOf(id);
  throw new Error(name);
};
const fits = (category: string, name: string) => categoryOf(category).test(byName(name));
const why = (category: string, name: string) => categoryOf(category).why(byName(name));
const ids = (...names: string[]) => names.map((n) => byName(n).id);

/** A hand-made fair puzzle: Pure Fire, Legendary, Trade evolutions, Starts with B. */
const FAIR: Puzzle = {
  groups: [
    { category: "pure:fire", members: ids("Arcanine", "Magmar", "Torkoal", "Simisear") },
    { category: "legendary", members: ids("Mewtwo", "Lugia", "Groudon", "Dialga") },
    { category: "trade", members: ids("Gengar", "Machamp", "Golem", "Steelix") },
    { category: "letter:b", members: ids("Bulbasaur", "Bidoof", "Bonsly", "Buneary") },
  ],
  tiles: [],
};
FAIR.tiles = FAIR.groups.flatMap((g) => g.members);

describe("category predicates (spot-checked against known facts)", () => {
  it("types", () => {
    expect(fits("type:fire", "Charizard")).toBe(true);
    expect(fits("pure:fire", "Charizard")).toBe(false);
    expect(fits("pure:fire", "Arcanine")).toBe(true);
    expect(fits("dual:fire/flying", "Charizard")).toBe(true);
    expect(categoryOf("pure:fire").lure!(byName("Charizard"))).toMatch(/also Flying/);
  });

  it("abilities, hidden ones included", () => {
    expect(fits("ability:levitate", "Bronzong")).toBe(true);
    expect(why("ability:levitate", "Bronzong")).toBe("Ability Levitate");
    expect(fits("ability:levitate", "Gengar")).toBe(false); // Cursed Body since Gen 7
    expect(fits("hidden:moxie", "Salamence")).toBe(true);
    expect(fits("hidden:moxie", "Krookodile")).toBe(false); // Moxie is a regular Ability there
    expect(categoryOf("hidden:moxie").guard!(byName("Krookodile"))).toBe(true);
  });

  it("evolution methods, base forms only", () => {
    expect(fits("trade", "Gengar")).toBe(true);
    expect(why("trade", "Gengar")).toBe("evolves from Haunter by trade");
    expect(why("trade", "Steelix")).toBe("evolves from Onix by trade holding Metal Coat");
    expect(fits("stone:thunder-stone", "Raichu")).toBe(true);
    expect(why("stone", "Glaceon")).toBe("evolves from Eevee with an Ice Stone");
    // Alolan Sandslash takes an Ice Stone; Sandslash levels up.
    expect(fits("stone", "Sandslash")).toBe(false);
    expect(fits("friendship", "Crobat")).toBe(true);
    expect(fits("friendship", "Persian")).toBe(false); // Alolan Persian's method
    expect(fits("baby", "Pichu")).toBe(true);
    expect(fits("baby", "Pikachu")).toBe(false);
    expect(fits("no-evo", "Tauros")).toBe(true);
  });

  it("moves learnt by level-up in Scarlet & Violet", () => {
    expect(fits("move:609", "Pikachu")).toBe(true); // Nuzzle
    expect(fits("move:609", "Bulbasaur")).toBe(false);
  });

  it("origins, stats, size, colour, forms, breeding and names", () => {
    expect(fits("gen:4", "Garchomp")).toBe(true);
    expect(fits("legendary", "Mewtwo")).toBe(true);
    expect(fits("legendary", "Mew")).toBe(false);
    expect(fits("mythical", "Mew")).toBe(true);
    expect(fits("bst:600", "Garchomp")).toBe(true);
    expect(fits("top:spe", "Ninjask")).toBe(true);
    expect(fits("top:atk", "Ninjask")).toBe(false);
    expect(fits("body:heavy", "Snorlax")).toBe(true);
    expect(why("body:heavy", "Snorlax")).toBe("weighs 460 kg");
    expect(fits("colour:yellow", "Pikachu")).toBe(true);
    expect(fits("form:alola", "Vulpix")).toBe(true);
    expect(fits("form:galar", "Vulpix")).toBe(false);
    expect(fits("form:mega", "Charizard")).toBe(true);
    expect(fits("form:gmax", "Charizard")).toBe(true);
    expect(fits("egg:monster", "Snorlax")).toBe(true);
    expect(fits("gender:female", "Chansey")).toBe(true);
    expect(fits("gender:male", "Tauros")).toBe(true);
    expect(fits("gender:none", "Magnemite")).toBe(true);
    expect(fits("ends:ite", "Dragonite")).toBe(true);
    expect(fits("name:short", "Muk")).toBe(true);
    expect(fits("name:symbol", "Mr. Mime")).toBe(true);
    expect(fits("letter:b", "Bulbasaur")).toBe(true);
  });

  it("only usable categories are offered, all with unique ids", () => {
    expect(CATEGORIES.length).toBeGreaterThan(100);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
  });
});

describe("the uniqueness validator", () => {
  it("passes a fair puzzle", () => {
    expect(validatePuzzle(FAIR)).toEqual([]);
  });

  it("rejects a tile that fits two groups", () => {
    const bad = structuredClone(FAIR);
    // Blacephalon starts with B and is Fire/Ghost, not pure Fire: fine.
    bad.groups[3].members[0] = byName("Blacephalon").id;
    expect(validatePuzzle({ groups: bad.groups })).toEqual([]);
    // Braixen is pure Fire AND starts with B.
    bad.groups[3].members[0] = byName("Braixen").id;
    expect(validatePuzzle({ groups: bad.groups }).join()).toMatch(/Braixen fits 2 groups/);
    // The grid must be the groups' sixteen.
    expect(validatePuzzle({ groups: FAIR.groups, tiles: FAIR.tiles.slice(1) }).join()).toMatch(/grid/);
  });

  it("rejects a tile in the wrong group, a duplicate, a second family member and a guard breach", () => {
    const wrong = structuredClone(FAIR);
    wrong.groups[0].members[0] = byName("Gengar").id;
    expect(validatePuzzle(wrong).join()).toMatch(/Gengar/);
    const family = structuredClone(FAIR);
    family.groups[0].members[0] = byName("Growlithe").id; // Arcanine's family
    family.groups[0].members[1] = byName("Arcanine").id;
    expect(validatePuzzle(family).join()).toMatch(/one evolution family/);
    const guarded: Puzzle = {
      groups: [
        { category: "hidden:moxie", members: ids("Salamence", "Heracross", "Honchkrow", "Pyroar") },
        ...FAIR.groups.slice(1, 3),
        { category: "letter:k", members: ids("Krookodile", "Kakuna", "Kirlia", "Klefki") },
      ],
      tiles: [],
    };
    expect(validatePuzzle(guarded).join()).toMatch(/Krookodile is too close/);
  });

  it("every pre-generated daily passes, with four groups and sixteen tiles", () => {
    expect(dailies.puzzles.length).toBeGreaterThanOrEqual(365);
    for (let i = 0; i < dailies.puzzles.length; i++) {
      const date = new Date(Date.parse(`${CONN_LAUNCH_DATE}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
      const p = dailyConnPuzzle(date);
      expect(validatePuzzle(p), date).toEqual([]);
    }
  });

  it("generates the same puzzle from the same seed, and valid ones from any", () => {
    expect(generatePuzzle("practice:abc")).toEqual(generatePuzzle("practice:abc"));
    for (const seed of ["a1", "b2", "c3", "d4", "e5"]) expect(validatePuzzle(practiceConnPuzzle(seed))).toEqual([]);
    // Past the file: generated from the date.
    expect(validatePuzzle(dailyConnPuzzle("2030-01-01"))).toEqual([]);
  });

  it("finds red herrings: a dual Fire type beside Pure Fire", () => {
    const p = structuredClone(FAIR);
    p.groups[1].members[0] = byName("Ho-Oh").id; // Fire/Flying Legendary
    expect(validatePuzzle({ groups: p.groups })).toEqual([]);
    expect(herringsOf(p, 0).map((h) => factsOf(h.id).name)).toContain("Ho-Oh");
  });
});

describe("the guess checker", () => {
  const [y, g, b, p] = FAIR.groups.map((x) => x.members);

  it("right, one away, wrong", () => {
    const s = playGuesses(FAIR, [y, [g[0], g[1], g[2], b[0]], [g[0], g[1], b[0], b[1]]]);
    expect(s.results.map((r) => r.kind)).toEqual(["correct", "one-away", "wrong"]);
    expect(s.results[0].level).toBe(0);
    expect(s.mistakes).toBe(2);
    expect(s.over).toBe(false);
  });

  it("a repeat costs nothing, in any order", () => {
    const wrong = [g[0], g[1], b[0], b[1]];
    const s = playGuesses(FAIR, [wrong, [...wrong].reverse()]);
    expect(s.results.map((r) => r.kind)).toEqual(["wrong", "repeat"]);
    expect(s.mistakes).toBe(1);
  });

  it("four mistakes lose, four groups win", () => {
    const miss = (i: number) => [y[i], g[i], b[i], p[i]];
    const lost = playGuesses(FAIR, [miss(0), miss(1), miss(2), miss(3)]);
    expect(lost).toMatchObject({ over: true, won: false, mistakes: 4 });
    const won = playGuesses(FAIR, [p, [y[0], y[1], g[0], b[0]], b, g, y]);
    expect(won).toMatchObject({ over: true, won: true, mistakes: 1, found: [3, 2, 1, 0] });
  });

  it("refuses a malformed guess", () => {
    expect(() => playGuesses(FAIR, [[y[0], y[1], y[2]]])).toThrow();
    expect(() => playGuesses(FAIR, [[y[0], y[0], y[1], y[2]]])).toThrow();
    expect(() => playGuesses(FAIR, [[y[0], y[1], y[2], 9999]])).toThrow();
  });

  it("the server reveals groups only as found, and everything at the end", () => {
    const view = puzzleView(FAIR, "practice:x");
    expect(JSON.stringify(view)).not.toMatch(/label|category|Legendary/);
    const mid = checkGuesses(FAIR, [y]);
    expect(mid.found).toHaveLength(1);
    expect(mid.reveal).toBeUndefined();
    const end = checkGuesses(FAIR, [y, g, b, p]);
    expect(end.reveal).toHaveLength(4);
    expect(end.reveal![2].lines[0]).toMatchObject({ name: "Gengar", why: "evolves from Haunter by trade" });
  });
});

describe("daily calendar and stats", () => {
  beforeEach(() => clearMemoryConnResults());

  it("numbers dailies from launch and accepts only playable dates", () => {
    expect(connNumber(CONN_LAUNCH_DATE)).toBe(1);
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(isPlayableConnDate("2026-10-30", now)).toBe(true);
    expect(isPlayableConnDate("2026-10-21", now)).toBe(false);
    expect(isPlayableConnDate("2026-11-03", now)).toBe(false);
    expect(isCurrentConnDate("2026-10-30", now)).toBe(false);
    expect(isCurrentConnDate("2026-11-02", now)).toBe(true);
  });

  it("records a replayed daily once per trainer and adds up solves and perfects", async () => {
    const date = "2026-10-25";
    const now = Date.parse(`${date}T12:00:00Z`);
    const puzzle = dailyConnPuzzle(date);
    const [y, g, b, p] = puzzle.groups.map((x) => x.members);
    const store = memoryConnStore();
    expect(await recordConnResult({ date, identity: "d:one", guesses: [y] }, store, now)).toMatchObject({ ok: false, status: 409 });
    expect(await recordConnResult({ date, identity: "d:one", guesses: [y, g, b, p] }, store, now)).toMatchObject({ ok: true, summary: { players: 1, solved: 1, perfect: 1 } });
    // The first result is kept.
    expect(await recordConnResult({ date, identity: "d:one", guesses: [[y[0], g[0], b[0], p[0]], y, g, b, p] }, store, now)).toMatchObject({ ok: true, summary: { players: 1, solved: 1, perfect: 1 } });
    expect(await recordConnResult({ date, identity: "d:two", guesses: [[y[0], g[0], b[0], p[0]], y, g, b, p] }, store, now)).toMatchObject({ ok: true, summary: { players: 2, solved: 2, perfect: 1 } });
    // Without a store (no table yet): the game goes on, no stats.
    expect(await recordConnResult({ date, identity: "d:three", guesses: [y, g, b, p] }, null, now)).toMatchObject({ ok: true, summary: null });
    expect(await recordConnResult({ date: "2026-10-01", identity: "d:x", guesses: [y] }, store, now)).toMatchObject({ ok: false, status: 400 });
  });

  it("syncs Connections results with the rest of the progress", () => {
    const base = normalizeProgress({ v: 1 })!;
    const local = normalizeProgress({ ...base, conn: { last: "2026-10-23", streak: 2, best: 2, results: { "2026-10-23": { guesses: [[1, 2, 3, 4]], solved: true, over: true, mistakes: 0, ms: 61000 } } } })!;
    const remote = normalizeProgress({ ...base, conn: { last: "2026-10-22", streak: 1, best: 3, results: { "2026-10-22": { guesses: [[5, 6, 7, "x"]], solved: false, over: true, mistakes: 9 } } } })!;
    expect(remote.conn!.results["2026-10-22"]).toEqual({ guesses: [], solved: false, over: true, mistakes: 4 });
    const merged = mergeProgress(local, remote);
    expect(merged.conn).toMatchObject({ last: "2026-10-23", streak: 2, best: 3 });
    expect(Object.keys(merged.conn!.results).sort()).toEqual(["2026-10-22", "2026-10-23"]);
  });
});

describe("the share payload", () => {
  const solved: ConnectionsShareResult = { game: "connections", daily: 12, solved: true, rows: ["0000", "1121", "1111", "2222", "3333"], seconds: 134, streak: 5 };

  it("round-trips through /s/ and never names a Pokémon or a group", () => {
    const raw = encodeShare(solved);
    expect(raw).toBe("con.n12.w1.k5.e134.r0000-1121-1111-2222-3333");
    expect(decodeShare(raw)).toEqual(solved);
    const text = connectionsShareText(solved, "https://pokeiq.vercel.app/s/" + raw);
    expect(text).toBe(["PokéIQ PokéConnections #12 1 mistake 🔥5 ⏱2:14", "🟨🟨🟨🟨", "🟩🟩🟦🟩", "🟩🟩🟩🟩", "🟦🟦🟦🟦", "🟪🟪🟪🟪", `https://pokeiq.vercel.app/s/${raw}`].join("\n"));
    const view = describeShare(decodeShare(raw)!);
    expect(view).toMatchObject({ game: "PokéConnections", headline: "Solved", playHref: "/connections" });
    expect(view.tiles[1]).toEqual(["conn-green", "conn-green", "conn-blue", "conn-green"]);
  });

  it("keeps a loss and a practice game", () => {
    const lost: ConnectionsShareResult = { game: "connections", solved: false, rows: ["0123", "0000", "1230", "3210", "1302"] };
    expect(decodeShare(encodeShare(lost))).toEqual(lost);
    expect(describeShare(lost).headline).toBe("1/4");
  });

  it("rejects games that can't happen", () => {
    expect(decodeShare("con.w1.r0000-1111-2222")).toBeNull(); // solved with three groups
    expect(decodeShare("con.w1.r0000-0000-1111-2222-3333")).toBeNull(); // a group found twice
    expect(decodeShare("con.w0.r0123-0123-0123")).toBeNull(); // lost with three mistakes
    expect(decodeShare("con.w1.r0000-1111-2222-3333-0123")).toBeNull(); // went on after winning
    expect(decodeShare("con.w1.r0000-1111-2222-3334")).toBeNull();
    expect(decodeShare("con.w1.r00001-1111-2222-3333")).toBeNull();
  });
});

describe("Unlimited's difficulty", () => {
  const difficulties = (p: Puzzle) => p.groups.map((g) => categoryOf(g.category).difficulty);
  const seeds = ["u1", "u2", "u3", "u4", "u5", "u6"];

  it("easy has no tricky group, hard no easy one, and both stay fair", () => {
    for (const s of seeds) {
      const easy = practiceConnPuzzle(`easy-${s}abcd`);
      const hard = practiceConnPuzzle(`hard-${s}abcd`);
      expect(validatePuzzle(easy)).toEqual([]);
      expect(validatePuzzle(hard)).toEqual([]);
      expect(Math.max(...difficulties(easy))).toBeLessThan(3.15);
      expect(difficulties(easy).filter((d) => d < 1.75).length).toBeGreaterThanOrEqual(2);
      expect(Math.min(...difficulties(hard))).toBeGreaterThanOrEqual(1.75);
      expect(difficulties(hard).filter((d) => d >= 3.15).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("rides in the seed: the same seed is the same puzzle, and a plain seed is normal", () => {
    expect(practiceConnPuzzle("hard-zzzz1234")).toEqual(generatePuzzle("practice:hard-zzzz1234", { difficulty: "hard", mixed: "seed" }));
    expect(practiceConnPuzzle("normal-zzzz1234")).toEqual(generatePuzzle("practice:normal-zzzz1234", { mixed: "seed" }));
    expect(practiceConnPuzzle("zzzz1234")).toEqual(generatePuzzle("practice:zzzz1234", { mixed: "seed" }));
  });
});
