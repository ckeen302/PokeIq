import { describe, expect, it } from "vitest";
import dailies from "@/data/connections-dailies.json";
import { ALL_CATEGORIES, categoryOf } from "@/lib/connections/categories";
import { factsOf } from "@/lib/connections/facts";
import { bandOf, generatePuzzle, isUniquelySolvable, secondAnswers, validatePuzzle, type Puzzle } from "@/lib/connections/generator";
import { ENGLISH_ONLY, addsAnswers, isEnglishOnly, localizedPuzzle } from "@/lib/connections/localize";
import { OTHER_LOCALES } from "@/i18n/config";

/** Every daily in the file, as the server reads it. */
const FILE = dailies as unknown as { start: string; puzzles: { g: (string | number)[][]; t: number[] }[] };
const DAILIES = FILE.puzzles.map((e, i) => ({
  date: new Date(Date.parse(`${FILE.start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
  puzzle: { groups: e.g.map(([category, ...members]) => ({ category: String(category), members: members.map(Number) })), tiles: e.t } as Puzzle,
}));

describe("English-only categories", () => {
  it("are the name and wordplay families and the food-names list, from the category definitions", () => {
    const families = new Set(ALL_CATEGORIES.filter(isEnglishOnly).map((c) => c.family));
    expect([...families].sort()).toEqual(["lore", "name", "wordplay"]);
    for (const c of ALL_CATEGORIES) if (c.family === "name" || c.family === "wordplay") expect(ENGLISH_ONLY.has(c.id), c.id).toBe(true);
    expect([...ENGLISH_ONLY].filter((id) => id.startsWith("lore:"))).toEqual(["lore:food"]);
    // Gym aces, box art and signature moves are facts about the Pokémon, not their names.
    for (const id of ["lore:ace", "lore:box", "lore:move", "type:fire", "gen:4", "trade"]) expect(ENGLISH_ONLY.has(id), id).toBe(false);
  });
});

describe("every daily in another language", () => {
  const swapped = DAILIES.map(({ date, puzzle }) => ({ date, puzzle, local: localizedPuzzle(puzzle, `daily:${date}`, "fr") }));

  it("English puzzles never change", () => {
    for (const { date, puzzle } of DAILIES) {
      const before = JSON.stringify(puzzle);
      expect(localizedPuzzle(puzzle, `daily:${date}`, "en")).toBe(puzzle);
      expect(JSON.stringify(puzzle)).toBe(before);
    }
  });

  it("has no English-only group left, and every language gets the same puzzle", () => {
    for (const { date, puzzle, local } of swapped) {
      expect(local.groups.filter((g) => ENGLISH_ONLY.has(g.category)).map((g) => g.category), date).toEqual([]);
      for (const l of OTHER_LOCALES) expect(localizedPuzzle(puzzle, `daily:${date}`, l), `${date} ${l}`).toEqual(local);
    }
  });

  it("swaps only the English-only groups, for a fair group of the same colour and difficulty band", () => {
    for (const { date, puzzle, local } of swapped) {
      expect(validatePuzzle(local), date).toEqual([]);
      // No lookalike group or second solution the board didn't already have.
      expect(addsAnswers(new Set(secondAnswers(puzzle, false, isEnglishOnly)), local.groups), date).toBe(false);
      puzzle.groups.forEach((g, level) => {
        const now = local.groups[level];
        if (!ENGLISH_ONLY.has(g.category)) {
          expect(now, date).toEqual(g);
          return;
        }
        expect(Math.abs(bandOf(categoryOf(now.category)) - bandOf(categoryOf(g.category))), `${date} ${g.category} -> ${now.category}`).toBeLessThanOrEqual(1);
        // None of its Pokémon is in a group that stayed.
        const rest = new Set(puzzle.groups.filter((_, i) => i !== level).flatMap((o) => o.members));
        for (const id of now.members) expect(rest.has(id), `${date} ${factsOf(id).name}`).toBe(false);
      });
      // The grid is the new groups' tiles, the kept groups' where they were.
      expect([...local.tiles].sort()).toEqual(local.groups.flatMap((g) => g.members).sort());
      const kept = new Set(puzzle.groups.filter((g) => !ENGLISH_ONLY.has(g.category)).flatMap((g) => g.members));
      puzzle.tiles.forEach((id, i) => {
        if (kept.has(id)) expect(local.tiles[i]).toBe(id);
      });
    }
  });

  it("swap stats", () => {
    const days = swapped.filter(({ puzzle }) => puzzle.groups.some((g) => ENGLISH_ONLY.has(g.category)));
    const perLevel = [0, 0, 0, 0];
    let sameBand = 0;
    let groups = 0;
    for (const { puzzle, local } of days)
      puzzle.groups.forEach((g, level) => {
        if (!ENGLISH_ONLY.has(g.category)) return;
        groups++;
        perLevel[level]++;
        if (bandOf(categoryOf(local.groups[level].category)) === bandOf(categoryOf(g.category))) sameBand++;
      });
    const two = days.filter(({ puzzle }) => puzzle.groups.filter((g) => ENGLISH_ONLY.has(g.category)).length > 1).length;
    console.log(`swapped: ${days.length} of ${swapped.length} days (${two} with two such groups), ${groups} groups (yellow ${perLevel[0]}, green ${perLevel[1]}, blue ${perLevel[2]}, purple ${perLevel[3]}); ${sameBand} in the same difficulty band`);
    expect(groups).toBeGreaterThan(0);
  });
});

describe("other puzzles", () => {
  it("a 5×5 practice board still splits one way after a swap", () => {
    let tried = 0;
    for (let i = 0; i < 40 && tried < 3; i++) {
      const seed = `s5-normal-t${i}`;
      const p = generatePuzzle(`practice:${seed}`, { size: 5 });
      if (!p.groups.some((g) => ENGLISH_ONLY.has(g.category))) continue;
      tried++;
      const local = localizedPuzzle(p, `practice:${seed}`, "ja");
      expect(local.groups.some((g) => ENGLISH_ONLY.has(g.category))).toBe(false);
      expect(validatePuzzle(local)).toEqual([]);
      expect(isUniquelySolvable(local.tiles)).toBe(true);
    }
    expect(tried).toBeGreaterThan(0);
  });

  it("leaves out switched-off categories", () => {
    const { date, puzzle } = DAILIES.find(({ puzzle }) => puzzle.groups.some((g) => ENGLISH_ONLY.has(g.category)))!;
    const first = localizedPuzzle(puzzle, `daily:${date}`, "de");
    const replaced = first.groups.find((g, i) => g.category !== puzzle.groups[i].category)!.category;
    const again = localizedPuzzle(puzzle, `daily:${date}`, "de", { exclude: new Set([replaced]) });
    expect(again.groups.map((g) => g.category)).not.toContain(replaced);
    expect(validatePuzzle(again)).toEqual([]);
  });
});
