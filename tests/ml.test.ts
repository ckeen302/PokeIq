import { describe, expect, it } from "vitest";
import { coachInsights } from "@/lib/coach";
import { lookalikesOf } from "@/lib/pokemon/lookalikes";
import { POKEDEX, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { Rng } from "@/lib/rng";
import { buildQuestion } from "@/engines";
import { getDexEntry } from "@/lib/pokemon/details";

describe("weak-spot coach", () => {
  it("flags clearly weaker and stronger areas", () => {
    const { weak, strong } = coachInsights({
      "mod:whos-that": [30, 50],
      "gen:1": [18, 20],
      "gen:5": [3, 15],
      "type:ghost": [2, 10],
    });
    expect(weak.map((w) => w.tag)).toEqual(["gen:5", "type:ghost"]);
    expect(strong[0].tag).toBe("gen:1");
    expect(weak[0].href).toBe("/pokedex/study?gen=5");
  });

  it("ignores tiny samples and shrinks toward the mean", () => {
    const { weak } = coachInsights({ "mod:dex": [60, 100], "gen:3": [0, 3] });
    expect(weak).toHaveLength(0);
    const smoothed = coachInsights({ "mod:dex": [60, 100], "gen:3": [0, 5] }).weak[0];
    expect(smoothed.accuracy).toBeGreaterThan(0.2); // not a raw 0%
  });
});

describe("silhouette lookalikes", () => {
  it("has neighbours for every species, sorted by similarity", () => {
    for (const p of POKEDEX) {
      const list = lookalikesOf(p.id);
      expect(list.length, p.name).toBeGreaterThanOrEqual(10);
      expect(list.every((l, i) => i === 0 || l.similarity <= list[i - 1].similarity)).toBe(true);
      expect(list.some((l) => l.pokemon.id === p.id)).toBe(false);
    }
  });

  it("finds intuitive confusions", () => {
    const near = (slug: string) => lookalikesOf(getPokemonBySlug(slug)!.id).slice(0, 8).map((l) => l.pokemon.slug);
    expect(near("gastly")).toEqual(expect.arrayContaining(["koffing", "weezing"]));
    expect(near("charizard")).toEqual(expect.arrayContaining(["aerodactyl", "salamence"]));
  });

  it("hard Who's That questions use lookalike distractors", () => {
    let withLookalike = 0;
    for (let s = 0; s < 50; s++) {
      const q = buildQuestion("whos-that", new Rng(`la-${s}`), { difficulty: "hard", used: new Set() });
      const near = new Set(lookalikesOf(q.media!.pokemonId).slice(0, 6).map((l) => l.pokemon.name));
      if (q.options.some((o) => near.has(o))) withLookalike++;
    }
    expect(withLookalike).toBeGreaterThan(40);
  });

  it("surfaces lookalikes on Pokédex pages, excluding the evolution family", () => {
    const entry = getDexEntry(getPokemonBySlug("charmander")!);
    expect(entry.lookalikes.length).toBeGreaterThan(0);
    expect(entry.lookalikes.map((l) => l.slug)).not.toContain("charmeleon");
  });
});
