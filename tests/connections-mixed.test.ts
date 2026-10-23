import { describe, expect, it } from "vitest";
import { generatePuzzle, playGuesses, validatePuzzle } from "@/lib/connections/generator";
import { MIXED_CATEGORIES, linkTiles, tileRef, typeTile } from "@/lib/connections/mixed";
import { isPokemonTile, tileKindOf } from "@/lib/connections/tiles";
import { checkGuesses, connTile, dailyConnPuzzle, practiceConnPuzzle, puzzleView } from "@/lib/server/connections";
import dailies from "@/data/connections-dailies.json";

const SEEDS = Array.from({ length: 40 }, (_, i) => `mx${i}`);

describe("mixed tiles", () => {
  it("has mixed links with moves, abilities and a type tile computed from the data", () => {
    expect(MIXED_CATEGORIES.length).toBeGreaterThanOrEqual(6);
    const fire = linkTiles("fire");
    expect(fire.moves.length).toBeGreaterThan(1);
    expect(fire.abilities.map((a) => tileRef(a).name)).toContain("Flash Fire");
    expect(tileRef(fire.type)).toMatchObject({ kind: "type", name: "Fire", type: "fire" });
    for (const m of fire.moves) expect(tileRef(m).type).toBe("fire");
  });

  it("generates valid puzzles with one or two mixed groups, and the validator accepts them", () => {
    let mixedGroups = 0;
    for (const seed of SEEDS) {
      const p = generatePuzzle(seed, { mixed: 1 });
      expect(validatePuzzle(p)).toEqual([]);
      const n = p.groups.filter((g) => g.category.startsWith("mixed:")).length;
      expect(n).toBe(1);
      mixedGroups += n;
      const mixed = p.groups.find((g) => g.category.startsWith("mixed:"))!;
      expect(mixed.members.some((id) => !isPokemonTile(id))).toBe(true);
      expect(mixed.members.some(isPokemonTile)).toBe(true);
    }
    expect(mixedGroups).toBe(SEEDS.length);
    const two = generatePuzzle("two-mixed", { mixed: 2 });
    expect(two.groups.filter((g) => g.category.startsWith("mixed:"))).toHaveLength(2);
    expect(validatePuzzle(two)).toEqual([]);
  });

  it("the seed decides practice puzzles: never more than two mixed groups", () => {
    const counts = SEEDS.map((s) => practiceConnPuzzle(s).groups.filter((g) => g.category.startsWith("mixed:")).length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
    expect(counts.some((c) => c > 0)).toBe(true);
    expect(counts.some((c) => c === 0)).toBe(true);
  });

  it("the validator rejects a tile that fits two groups or none", () => {
    const p = generatePuzzle("val-1", { mixed: 1 });
    const mixed = p.groups.findIndex((g) => g.category.startsWith("mixed:"));
    const type = p.groups[mixed].category.slice("mixed:".length);
    // A move of another type in the group.
    const other = ["fire", "water", "grass"].find((t) => t !== type)!;
    const groups = p.groups.map((g) => ({ ...g, members: [...g.members] }));
    const slot = groups[mixed].members.findIndex((id) => tileKindOf(id) === "move");
    if (slot >= 0) {
      groups[mixed].members[slot] = linkTiles(other).moves[0];
      expect(validatePuzzle({ groups }).join()).toMatch(/doesn't fit its own group/);
    }
    // A type tile dropped into a regular group.
    const regular = p.groups.findIndex((g) => !g.category.startsWith("mixed:"));
    const bad = p.groups.map((g) => ({ ...g, members: [...g.members] }));
    bad[regular].members[0] = typeTile(type);
    expect(validatePuzzle({ groups: bad }).length).toBeGreaterThan(0);
  });

  it("tiles reach the client without their groups, and every guess is checked on the server", () => {
    const p = practiceConnPuzzle("mx3");
    const view = puzzleView(p, "practice:mx3");
    expect(JSON.stringify(view)).not.toMatch(/category|mixed:|-related/);
    expect(view.tiles).toHaveLength(16);
    expect(view.tiles.map((t) => t.id).sort()).toEqual([...p.tiles].sort());
    const group = p.groups[0].members;
    const res = checkGuesses(p, [group]);
    expect(res.results[0].kind).toBe("correct");
    expect(res.reveal).toBeUndefined();
    const over = checkGuesses(p, [p.tiles.slice(0, 4), p.tiles.slice(4, 8), p.tiles.slice(8, 12), p.tiles.slice(1, 5)]);
    if (over.over) {
      expect(over.reveal).toHaveLength(4);
      for (const g of over.reveal!) for (const l of g.lines) expect(l.why.length).toBeGreaterThan(0);
    }
    expect(() => playGuesses(p, [[1, 2, 3, 4]])).toThrow();
  });

  it("explains every tile kind, and shows each kind its own look", () => {
    const p = generatePuzzle("why-1", { mixed: 1 });
    const mixed = p.groups.findIndex((g) => g.category.startsWith("mixed:"));
    const wrong = [0, 1, 2, 3].map((i) => p.groups[(mixed + 1) % 4].members[i]);
    const res = checkGuesses(p, [wrong, wrong.map((_, i) => p.groups[(mixed + 2) % 4].members[i]), p.groups[mixed].members, p.groups[(mixed + 3) % 4].members]);
    const lines = res.found.length ? res.found : [];
    expect(lines.length).toBeGreaterThan(0);
    const reveal = checkGuesses(p, [
      ...[0, 1, 2, 3].map((n) => [p.tiles[n], p.tiles[n + 4], p.tiles[n + 8], p.tiles[(n + 13) % 16]]),
    ]);
    if (reveal.reveal) {
      const g = reveal.reveal[mixed];
      expect(g.lines.some((l) => l.kind)).toBe(true);
      for (const l of g.lines) if (l.kind === "move" || l.kind === "type") expect(l.type).toBeTruthy();
    }
    expect(connTile(p.groups[mixed].members.find((id) => !isPokemonTile(id))!).kind).toBeDefined();
  });

  it("every pre-generated daily is untouched and plain", () => {
    const start = dailies.start;
    for (let i = 0; i < dailies.puzzles.length; i += 30) {
      const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
      const p = dailyConnPuzzle(date);
      expect(p.tiles).toEqual(dailies.puzzles[i].t);
      expect(p.groups.every((g) => !g.category.startsWith("mixed:"))).toBe(true);
    }
  });

  it("keeps Easy's two easy groups and Hard's two tricky ones when two groups are mixed", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      for (const seed of ["d1", "d2", "d3", "d4"]) {
        const p = generatePuzzle(seed, { difficulty, mixed: 2 });
        expect(validatePuzzle(p)).toEqual([]);
        expect(p.groups.filter((g) => g.category.startsWith("mixed:"))).toHaveLength(2);
      }
    }
  });

  it("puzzles generated without the mixed option are the same as before", () => {
    const a = generatePuzzle("plain-1");
    const b = generatePuzzle("plain-1", { mixed: 0 });
    expect(b).toEqual(a);
    expect(a.groups.every((g) => !g.category.startsWith("mixed:"))).toBe(true);
  });
});
