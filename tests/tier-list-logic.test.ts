import { describe, expect, it } from "vitest";
import { buildRoster } from "@/lib/tier-list/roster.server";
import { clampPicks, finishingOrder, nextPow2, resolveBracket, roundLabel, seedEntrants, seedPositions } from "@/lib/tier-list/bracket";
import { agreement, blindDraw, emptySlots, isDone, place, placedCount, slotKeys, validSlots } from "@/lib/tier-list/blind";
import { draw, hashSeed, rng, shuffled } from "@/lib/tier-list/rng";
import { decodeShare, encodeShare, makeCodec, packBits, unpackBits } from "@/lib/tier-list/share";
import {
  addRow, commit, historyOf, initialState, moveRow, moveToTier, poolKeys, redo, removeRow, topAdd, topLength, undo, updateRow,
} from "@/lib/tier-list/state";

const mons = buildRoster().mons;
const codec = makeCodec(mons);

describe("seeded draws", () => {
  it("are the same for the same seed and differ for another", () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    expect(draw(items, 10, "abc")).toEqual(draw(items, 10, "abc"));
    expect(draw(items, 10, "abc")).not.toEqual(draw(items, 10, "abd"));
    expect(new Set(draw(items, 50, "x")).size).toBe(50);
    expect(shuffled(items, 7).sort((a, b) => a - b)).toEqual(items);
    expect(hashSeed("pokeiq")).toBe(hashSeed("pokeiq"));
  });

  it("give fixed numbers for a fixed seed (a challenge link replays on every device)", () => {
    const r = rng("k7m2qx");
    const first = [r(), r(), r()];
    const again = rng("k7m2qx");
    expect([again(), again(), again()]).toEqual(first);
    for (const x of first) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThan(1);
  });

  it("draw a blind run from a pool in roster order", () => {
    const pool = poolKeys(initialState("gen-1"), mons);
    const a = blindDraw(pool, 10, "seed1");
    expect(a).toHaveLength(10);
    expect(blindDraw(pool.slice(), 10, "seed1")).toEqual(a);
    expect(blindDraw(pool, 10, "seed2")).not.toEqual(a);
    expect(blindDraw(pool.slice(0, 3), 10, "s")).toHaveLength(3);
  });
});

describe("bracket", () => {
  it("lays seeds out the standard way", () => {
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedPositions(2)).toEqual([1, 2]);
    expect(nextPow2(17)).toBe(32);
  });

  it("plays a full bracket of 8 to a champion, round by round", () => {
    const entrants = ["a", "b", "c", "d", "e", "f", "g", "h"];
    let res = resolveBracket(entrants, []);
    expect(res.rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(res.current).toEqual({ round: 0, index: 0 });
    expect(res.rounds[0][0]).toMatchObject({ a: "a", b: "h" });
    expect(res.totalPicks).toBe(7);
    // Top seeds win everything: a is champion.
    res = resolveBracket(entrants, [0, 0, 0, 0, 0, 0, 0]);
    expect(res.champion).toBe("a");
    expect(res.current).toBeNull();
    expect(res.progress).toEqual([{ done: 4, total: 4 }, { done: 2, total: 2 }, { done: 1, total: 1 }]);
    // The lowest seed wins every match it plays.
    res = resolveBracket(entrants, [1, 0, 0, 0, 0, 0, 0]);
    expect(res.rounds[1][0].a).toBe("h");
    res = resolveBracket(entrants, [1, 0, 0, 0, 0, 0, 0]);
    expect(res.current).toBeNull();
    expect(finishingOrder(resolveBracket(entrants, [0, 0, 0, 0, 0, 0, 0]))[0]).toBe("a");
    expect(finishingOrder(resolveBracket(entrants, [0, 0, 0, 0, 0, 0, 0]))).toHaveLength(8);
  });

  it("gives byes to the top seeds when the size isn't a power of two", () => {
    const entrants = ["a", "b", "c", "d", "e", "f"];
    const res = resolveBracket(entrants, []);
    expect(res.rounds[0].filter((m) => m.bye).map((m) => m.winner)).toEqual(["a", "b"]);
    expect(res.totalPicks).toBe(5);
    expect(res.progress[0]).toEqual({ done: 0, total: 2 });
    const done = resolveBracket(entrants, [0, 0, 0, 0, 1]);
    expect(done.champion).toBe("b");
  });

  it("handles a whole template (every Pokémon)", () => {
    const pool = mons.filter((m) => !m.f);
    const entrants = seedEntrants(pool, 0, "dex", "s");
    expect(entrants).toHaveLength(pool.length);
    const res = resolveBracket(entrants, Array(2000).fill(0));
    expect(res.champion).toBe("bulbasaur");
    expect(res.totalPicks).toBe(pool.length - 1);
    expect(clampPicks(entrants, Array(5000).fill(1))).toHaveLength(pool.length - 1);
  });

  it("seeds at random, by dex, by base stat total or by hand", () => {
    const pool = mons.filter((m) => !m.f && m.g === 1);
    expect(seedEntrants(pool, 16, "random", "x")).toEqual(seedEntrants(pool, 16, "random", "x"));
    expect(seedEntrants(pool, 16, "random", "x")).toHaveLength(16);
    const bst = seedEntrants(pool, 0, "bst", "x");
    expect(bst[0]).toBe("mewtwo");
    expect(seedEntrants(pool, 0, "dex", "x")[0]).toBe("bulbasaur");
    const manual = seedEntrants(pool, 0, "manual", "x", ["pikachu", "mew"]);
    expect(manual.slice(0, 3)).toEqual(["pikachu", "mew", "bulbasaur"]);
    // A smaller bracket draws its entrants, then the seeding orders them.
    const drawn = seedEntrants(pool, 8, "bst", "y");
    const b = new Map(pool.map((m) => [m.k, m.b]));
    expect(drawn.map((k) => b.get(k)!)).toEqual([...drawn.map((k) => b.get(k)!)].sort((x, y) => y - x));
  });

  it("names rounds from the end", () => {
    expect(roundLabel(3, 4)).toEqual({ kind: "final", n: 2 });
    expect(roundLabel(2, 4)).toEqual({ kind: "semi", n: 4 });
    expect(roundLabel(0, 5)).toEqual({ kind: "round", n: 32 });
  });
});

describe("blind ranking", () => {
  it("places each Pokémon for good", () => {
    let s = emptySlots(5);
    s = place(s, 2);
    expect(s).toEqual([-1, -1, 0, -1, -1]);
    expect(place(s, 2)).toBe(s);
    s = place(place(place(place(s, 0), 4), 1), 3);
    expect(isDone(s)).toBe(true);
    expect(placedCount(s)).toBe(5);
    expect(place(s, 0)).toBe(s);
    expect(slotKeys(s, ["a", "b", "c", "d", "e"])).toEqual(["b", "d", "a", "e", "c"]);
    expect(validSlots(s, 5)).toBe(true);
    expect(validSlots([0, 0, -1, -1, -1], 5)).toBe(false);
    expect(validSlots([2, -1, -1, -1, -1], 5)).toBe(false);
    expect(agreement(s, s)).toBe(1);
  });
});

describe("share links", () => {
  it("round-trip a tier list exactly", () => {
    let s = initialState("starters");
    s = { ...s, art: "pixel", shiny: true, title: "My starters", added: ["charizardmegax"], removed: ["chikorita"] };
    s = moveToTier(s, ["charmander", "piplup"], "t0");
    s = moveToTier(s, ["bulbasaur"], "t1");
    s = updateRow(s, "t5", { label: "Nope", color: "#123456" });
    s = moveToTier(s, ["charizardmegax"], "t5");
    const back = decodeShare(encodeShare(s, codec), codec)!;
    expect(back.template).toBe("starters");
    expect(back.mode).toBe("tier");
    expect(back.art).toBe("pixel");
    expect(back.shiny).toBe(true);
    expect(back.title).toBe("My starters");
    expect(back.added).toEqual(["charizardmegax"]);
    expect(back.removed).toEqual(["chikorita"]);
    expect(back.tier.rows.map((r) => [r.label, r.color, r.items])).toEqual(s.tier.rows.map((r) => [r.label, r.color, r.items]));
  });

  it("round-trip a bracket, a top list and a blind run with a friend's", () => {
    let s = initialState("gen-1", "abc123");
    s = { ...s, mode: "bracket", bracket: { size: 32, seeding: "manual", seed: "abc123", manual: ["pikachu", "mew"], picks: [0, 1, 1, 0, 1, 0, 0, 1, 1], started: true } };
    expect(decodeShare(encodeShare(s, codec), codec)!.bracket).toEqual(s.bracket);
    s = topLength({ ...s, mode: "top" }, 5);
    s = topAdd(topAdd(s, "mew"), "pikachu", 0);
    s = { ...s, top: { ...s.top, captions: { mew: "The original" } } };
    expect(decodeShare(encodeShare(s, codec), codec)!.top).toEqual(s.top);
    s = { ...s, mode: "blind", blind: { length: 5, seed: "zz9", source: "random", slots: [3, 0, 4, 1, 2], name: "Ash", vs: { name: "Gary", slots: [0, 1, 2, 3, 4] } } };
    expect(decodeShare(encodeShare(s, codec), codec)!.blind).toEqual(s.blind);
  });

  it("stay short for a full Every Pokémon tier list", () => {
    let s = initialState("every-pokemon");
    const pool = poolKeys(s, mons);
    s = moveToTier(s, pool.slice(0, 500), "t0");
    s = moveToTier(s, pool.slice(500), "t3");
    const link = encodeShare(s, codec);
    expect(link.length).toBeLessThan(6000);
    expect(decodeShare(link, codec)!.tier.rows[3].items).toHaveLength(pool.length - 500);
  });

  it("refuse links they didn't write", () => {
    expect(decodeShare("nonsense", codec)).toBeNull();
    expect(decodeShare("", codec)).toBeNull();
    expect(decodeShare(null, codec)).toBeNull();
  });

  it("pack bracket picks", () => {
    const bits = Array.from({ length: 77 }, (_, i) => (i * 7) % 3 === 0 ? 1 : 0);
    expect(unpackBits(packBits(bits))).toEqual(bits);
    expect(unpackBits(packBits([]))).toEqual([]);
    expect(unpackBits("9.A")).toBeNull();
  });
});

describe("editing and history", () => {
  it("moves tiles between tiers and back, keeping order", () => {
    let s = initialState("starters");
    s = moveToTier(s, ["a", "b", "c"], "t0");
    s = moveToTier(s, ["c"], "t0", 0);
    expect(s.tier.rows[0].items).toEqual(["c", "a", "b"]);
    s = moveToTier(s, ["c"], "t0", 3);
    expect(s.tier.rows[0].items).toEqual(["a", "b", "c"]);
    s = moveToTier(s, ["a"], "t1");
    expect(s.tier.rows[1].items).toEqual(["a"]);
    s = moveToTier(s, ["a", "b"], null);
    expect(s.tier.rows.flatMap((r) => r.items)).toEqual(["c"]);
  });

  it("adds, removes and reorders rows", () => {
    let s = initialState("starters");
    s = addRow(s, "t0");
    expect(s.tier.rows).toHaveLength(7);
    expect(s.tier.rows[1].label).toBe("");
    s = moveRow(s, "t0", 1);
    expect(s.tier.rows[1].id).toBe("t0");
    s = removeRow(s, "t0");
    expect(s.tier.rows.find((r) => r.id === "t0")).toBeUndefined();
  });

  it("undoes and redoes", () => {
    const a = initialState("starters");
    let h = historyOf(a);
    const b = moveToTier(a, ["bulbasaur"], "t0");
    h = commit(h, b);
    expect(undo(h).present).toBe(a);
    expect(redo(undo(h)).present).toBe(b);
    expect(commit(h, h.present)).toBe(h);
  });

  it("keeps a top list within its length", () => {
    let s = topLength(initialState("starters"), 3);
    for (const k of ["a", "b", "c", "d"]) s = topAdd(s, k);
    expect(s.top.items).toEqual(["a", "b", "c"]);
    s = topAdd(s, "c", 0);
    expect(s.top.items).toEqual(["c", "a", "b"]);
  });
});
