import { describe, expect, it } from "vitest";
import movesData from "@/data/moves.json";
import detailsData from "@/data/pokedex-details.json";
import itemsData from "@/data/items.json";
import { buildAbilities, buildMoves, moveSlugs, slugify, versionGroupLabel, versionLabel, type RawDexDetails, type RawMove } from "@/lib/dex/build";
import { buildItem, genFromName, groupRarity, isMainline, keepItem, type ItemRecord, type RawItem } from "@/lib/dex/items-build";

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Will-O-Wisp")).toBe("will-o-wisp");
    expect(slugify("U-turn")).toBe("u-turn");
    expect(slugify("King's Shield")).toBe("kings-shield");
    expect(slugify("Solar Power")).toBe("solar-power");
    expect(slugify("Flabébé")).toBe("flabebe");
  });
});

describe("buildMoves", () => {
  const raw = (name: string): RawMove => ({ name, type: "normal", cls: "physical", power: 40, accuracy: 100, pp: 35, priority: 0, gen: 1, effect: "x" });
  const details: Record<string, RawDexDetails> = {
    "1": { abilities: [], learnset: { game: "G", moves: [[1, "L", 5], [1, "M", 0, "TM01"], [2, "E", 0]] } },
    "2": { abilities: [], learnset: { game: "G", moves: [[1, "L", 0]] } },
    "3": { abilities: [], learnset: null },
  };
  const moves = buildMoves({ "1": raw("Pound"), "2": raw("Karate Chop") }, details);

  it("sorts by name and keeps slugs", () => {
    expect(moves.map((m) => m.slug)).toEqual(["karate-chop", "pound"]);
  });
  it("collects learners with their methods", () => {
    const pound = moves.find((m) => m.slug === "pound")!;
    expect(pound.learners).toEqual([
      { id: 1, how: ["Lv. 5", "TM01"] },
      { id: 2, how: ["Evolution"] },
    ]);
    expect(moves.find((m) => m.slug === "karate-chop")!.learners).toEqual([{ id: 1, how: ["Egg"] }]);
  });
  it("disambiguates colliding slugs", () => {
    const slugs = moveSlugs({ "1": { name: "Foo Bar" }, "2": { name: "Foo-Bar" } });
    expect(slugs.get(1)).toBe("foo-bar");
    expect(slugs.get(2)).toBe("foo-bar-2");
  });
  it("real data: unique slugs and plausible learners", () => {
    const real = buildMoves(movesData as unknown as Record<string, RawMove>, detailsData as unknown as Record<string, RawDexDetails>);
    expect(real.length).toBe(Object.keys(movesData).length);
    expect(new Set(real.map((m) => m.slug)).size).toBe(real.length);
    expect(real.find((m) => m.slug === "flamethrower")!.learners.some((l) => l.id === 6)).toBe(true);
  });
});

describe("buildAbilities", () => {
  const details: Record<string, RawDexDetails> = {
    "6": { abilities: [{ name: "Blaze", hidden: false, effect: "e1" }, { name: "Solar Power", hidden: true, effect: "e2" }], learnset: null },
    "4": { abilities: [{ name: "Blaze", hidden: false, effect: "e1" }, { name: "Blaze", hidden: false, effect: "e1" }], learnset: null },
  };
  const abilities = buildAbilities(details);
  it("groups holders per ability, deduped and sorted", () => {
    expect(abilities.map((a) => a.slug)).toEqual(["blaze", "solar-power"]);
    expect(abilities[0].holders).toEqual([{ id: 4, hidden: false }, { id: 6, hidden: false }]);
    expect(abilities[1].holders).toEqual([{ id: 6, hidden: true }]);
  });
  it("real data: every ability has holders and an effect", () => {
    const real = buildAbilities(detailsData as unknown as Record<string, RawDexDetails>);
    expect(real.length).toBeGreaterThan(250);
    expect(real.every((a) => a.holders.length > 0)).toBe(true);
    expect(real.find((a) => a.slug === "blaze")!.holders.some((h) => h.id === 6)).toBe(true);
  });
});

describe("item builders", () => {
  it("parses generation names", () => {
    expect(genFromName("generation-iv")).toBe(4);
    expect(genFromName("generation-ix")).toBe(9);
    expect(genFromName("nope")).toBeNull();
  });

  it("groups rarity by percentage, highest first", () => {
    expect(
      groupRarity([
        { rarity: 5, version: { name: "sun" } },
        { rarity: 100, version: { name: "ruby" } },
        { rarity: 5, version: { name: "moon" } },
        { rarity: 5, version: { name: "moon" } },
      ])
    ).toEqual([[100, ["ruby"]], [5, ["sun", "moon"]]]);
  });

  const raw: RawItem = {
    name: "leftovers",
    category: { name: "held-items" },
    names: [{ name: "Leftovers", language: { name: "en" } }],
    effect_entries: [{ short_effect: "Restores  HP\neach turn.", effect: "long", language: { name: "en" } }],
    game_indices: [{ generation: { name: "generation-ii" } }, { generation: { name: "generation-iii" } }, { generation: { name: "generation-ii" } }],
    held_by_pokemon: [
      { pokemon: { name: "snorlax" }, version_details: [{ rarity: 100, version: { name: "ruby" } }] },
      { pokemon: { name: "snorlax-gmax" }, version_details: [{ rarity: 100, version: { name: "ruby" } }] },
    ],
    machines: [],
  };

  it("builds a compact record", () => {
    const rec = buildItem(raw, [], new Set(["snorlax"]));
    expect(rec).toMatchObject({ slug: "leftovers", name: "Leftovers", category: "Held Items", effect: "Restores HP each turn.", gens: [2, 3] });
    expect(rec.held).toEqual([["snorlax", [[100, ["ruby"]]]]]);
  });

  it("maps machines to generations and drops non-mainline version groups", () => {
    const rec = buildItem(
      { ...raw, name: "tm01", machines: [] },
      [
        { id: 1, version_group: { name: "sword-shield" }, move: { name: "mega-punch" } },
        { id: 2, version_group: { name: "colosseum" }, move: { name: "x" } },
        { id: 3, version_group: { name: "red-blue" }, move: { name: "mega-punch" } },
      ],
      new Set()
    );
    expect(rec.machines).toEqual([[1, "red-blue", "mega-punch"], [8, "sword-shield", "mega-punch"]]);
  });

  it("filters mainline and kept items", () => {
    expect(isMainline(raw)).toBe(true);
    expect(isMainline({ name: "x", game_indices: [] })).toBe(false);
    const rec = buildItem(raw, [], new Set());
    expect(keepItem(rec)).toBe(true);
    expect(keepItem({ ...rec, effect: "" })).toBe(false);
    expect(keepItem({ ...rec, category: "Unused" })).toBe(false);
  });

  it("labels versions", () => {
    expect(versionLabel("heartgold")).toBe("HeartGold");
    expect(versionLabel("black-2")).toBe("Black 2");
    expect(versionGroupLabel("sword-shield")).toBe("Sword / Shield");
  });
});

describe("items.json", () => {
  const items = itemsData as unknown as ItemRecord[];
  it("has unique slugs and descriptions", () => {
    expect(new Set(items.map((i) => i.slug)).size).toBe(items.length);
    expect(items.every((i) => i.effect && i.gens.length > 0)).toBe(true);
  });
  it("Leftovers has holders and TMs teach moves", () => {
    expect(items.find((i) => i.slug === "leftovers")!.held.length).toBeGreaterThan(0);
    expect(items.find((i) => i.slug === "tm01")!.machines.length).toBeGreaterThan(5);
  });
});
