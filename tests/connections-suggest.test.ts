import { describe, expect, it, vi } from "vitest";
import { CATEGORIES } from "@/lib/connections/categories";
import { factsOf } from "@/lib/connections/facts";
import { findLinks, overlapWarnings, suggestGroup } from "@/lib/server/connections-suggest";

vi.mock("server-only", () => ({}));

describe("the creator's suggestions", () => {
  it("finds computed links from what is typed", () => {
    const links = findLinks("levitate");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].id).toMatch(/levitate/);
    expect(findLinks("fire").some((l) => l.id.startsWith("type:") || l.id.startsWith("pure:"))).toBe(true);
    expect(findLinks("   ")).toEqual([]);
    expect(findLinks("zzzzqqq")).toEqual([]);
  });

  it("offers four Pokémon that fit the link, are unused and are from different families", () => {
    const link = CATEGORIES.find((c) => c.id === "type:fire")!;
    const s = suggestGroup("type:fire", [], [])!;
    expect(s.tiles).toHaveLength(4);
    expect(s.short).toBe(false);
    for (const t of s.tiles) expect(link.test(factsOf(t.id))).toBe(true);
    expect(new Set(s.tiles.map((t) => factsOf(t.id).familyKey)).size).toBe(4);
    // The same seed gives the same four; another seed another four.
    expect(suggestGroup("type:fire", [], [], 0)!.tiles).toEqual(s.tiles);
    expect(suggestGroup("type:fire", [], [], 1)!.tiles).not.toEqual(s.tiles);
  });

  it("doesn't offer a Pokémon that fits another group's link, or one already used", () => {
    const water = CATEGORIES.find((c) => c.id === "type:water")!;
    // Another group of three Water types: every suggestion avoids Water.
    const others = [[7, 60, 72]];
    const fireLink = suggestGroup("type:fire", [], others)!;
    for (const t of fireLink.tiles) expect(water.test(factsOf(t.id))).toBe(false);
    // Asking for a group with two members already gives two more, never a used one.
    const s = suggestGroup("type:fire", [4, 37], others)!;
    expect(s.tiles).toHaveLength(2);
    for (const t of s.tiles) expect([4, 37, ...others.flat()]).not.toContain(t.id);
    expect(suggestGroup("nope:nope", [], [])).toBeNull();
  });

  it("warns live once a group has three that share a link and another group's tile fits it", () => {
    // Squirtle, Psyduck, Poliwag share Water; Vaporeon (Water) in another group fits it too.
    const warnings = overlapWarnings([
      { name: "Starters", members: [7, 54, 60] },
      { name: "Eeveelutions", members: [134, 135] },
    ]);
    expect(warnings.some((w) => /Vaporeon/.test(w) && /also fits/.test(w))).toBe(true);
    expect(overlapWarnings([{ name: "x", members: [7, 54] }, { name: "y", members: [134] }])).toEqual([]);
    expect(overlapWarnings([{ name: "a", members: [1, 2] }, { name: "b", members: [3] }]).join()).toMatch(/evolution family/);
  });
});
