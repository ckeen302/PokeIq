import { describe, expect, it } from "vitest";
import { Rng } from "@/lib/rng";
import { buildQuestion } from "@/engines";
import { DIFFICULTIES, MODULES, type Question } from "@/engines/types";
import { questionSchema } from "@/engines/validate";
import { censorEntry, foldText, leaksName } from "@/engines/modules/dex";
import { abilityImmunities } from "@/engines/modules/types";
import { POKEDEX, getPokemon, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { defensiveProfile, effectiveness, type PokemonType } from "@/lib/pokemon/type-matrix";

const SEEDS = 60;

function run(mod: (typeof MODULES)[number], difficulty: (typeof DIFFICULTIES)[number], seed: string, gens?: number[]) {
  const rng = new Rng(seed);
  const used = new Set<number>();
  return Array.from({ length: 10 }, () => buildQuestion(mod, rng, { difficulty, gens, used }));
}

describe("question engines", () => {
  for (const mod of MODULES) {
    for (const difficulty of DIFFICULTIES) {
      it(`${mod}/${difficulty}: every question passes the contract`, () => {
        for (let s = 0; s < SEEDS; s++) {
          for (const q of run(mod, difficulty, `${mod}-${difficulty}-${s}`)) {
            const parsed = questionSchema.safeParse(q);
            expect(parsed.success, `${q.itemKey}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
          }
        }
      });
    }
  }

  it("is deterministic: same seed, same quiz", () => {
    expect(run("mixed", "hard", "same")).toEqual(run("mixed", "hard", "same"));
  });

  it("respects generation filters", () => {
    for (let s = 0; s < 20; s++) {
      for (const q of run("whos-that", "hard", `gen1-${s}`, [1])) {
        expect(getPokemon(q.media!.pokemonId)!.gen).toBe(1);
      }
    }
  });

  it("never repeats a target Pokémon within a run", () => {
    for (let s = 0; s < 20; s++) {
      const ids = run("whos-that", "medium", `norepeat-${s}`).map((q) => q.media!.pokemonId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("type-effectiveness answers agree with the matrix", () => {
    let checked = 0;
    for (let s = 0; s < 200; s++) {
      for (const q of run("types", "medium", `eff-${s}`)) {
        const m = q.itemKey.match(/^types:eff:(\w+)>([\w/]+)/);
        if (!m) continue;
        const expected = effectiveness(m[1] as PokemonType, m[2].split("/") as PokemonType[]);
        const label = expected === 0 ? "0× (immune)" : expected === 0.25 ? "¼×" : expected === 0.5 ? "½×" : `${expected}×`;
        expect(q.answer).toBe(label);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("higher-or-lower answers are the true winner", () => {
    for (let s = 0; s < 100; s++) {
      for (const q of run("higher-lower", "hard", `hl-${s}`) as Question[]) {
        const [a, b] = q.cards!.map((c) => getPokemon(c.pokemonId)!);
        expect(q.options).toContain(q.answer);
        expect([a.name, b.name]).toContain(q.answer);
      }
    }
  });
});

describe("dex censoring", () => {
  it("redacts the whole evolution family", () => {
    const pikachu = getPokemon(25)!;
    const out = censorEntry("When Pikachu evolves into RAICHU, unlike Pichu…", pikachu);
    expect(out).not.toMatch(/pikachu|raichu|pichu/i);
  });

  it("redacts names with symbols, accents and punctuation", () => {
    const nidoranF = getPokemonBySlug("nidoran-f")!;
    expect(censorEntry("The tip of a female Nidoran’s horn is rounded.", nidoranF)).not.toMatch(/nidoran/i);
    expect(censorEntry("Nidoran♀ and NIDORINA live together.", nidoranF)).not.toMatch(/nido/i);
    const flabebe = getPokemonBySlug("flabebe")!;
    expect(censorEntry("Flabébé wears a crown. A Flabebe is tiny.", flabebe)).not.toMatch(/flab/i);
    const farfetchd = getPokemonBySlug("farfetchd")!;
    expect(censorEntry("Farfetch'd and Farfetch’d carry leeks.", farfetchd)).not.toMatch(/farfetch/i);
    // Words merely containing a name are left alone.
    expect(censorEntry("It looks just like a pinecone.", getPokemonBySlug("pineco")!)).toContain("pinecone");
  });

  it("never serves an entry that still names its Pokémon", () => {
    for (const p of POKEDEX) {
      for (const text of p.flavor) expect(leaksName(censorEntry(text, p), p), `${p.name}: ${text}`).toBe(false);
    }
  });

  it("never offers two species that share the shown entry", () => {
    // The six Ultra Beasts share one entry text.
    for (let s = 0; s < 150; s++) {
      for (const q of run("dex", (["easy", "medium", "hard"] as const)[s % 3], `ub-${s}`, [7])) {
        if (!q.itemKey.startsWith("dex:entry:")) continue;
        expect(q.detail).not.toMatch(/alien to this world/i);
        const shown = foldText(q.detail!.replace(/^“|”( — .*)?$/g, ""));
        const pattern = new RegExp("^" + shown.split("▇▇▇").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+") + "$");
        const owners = q.options.filter((name) => POKEDEX.find((p) => p.name === name)!.flavor.some((f) => pattern.test(foldText(f))));
        expect(owners, q.detail).toEqual([q.answer]);
      }
    }
  });
});

describe("type questions and abilities", () => {
  it("never let an ability make a second option correct", () => {
    for (let s = 0; s < 120; s++) {
      for (const difficulty of DIFFICULTIES) {
        for (const q of run("types", difficulty, `ability-${difficulty}-${s}`)) {
          const target = getPokemon(q.media!.pokemonId)!;
          expect(target.abilities.some((a) => a.name === "wonder-guard") && !q.itemKey.startsWith("types:typing")).toBe(false);
          const immune = abilityImmunities(target);
          if (q.itemKey.startsWith("types:eff:")) {
            const attacker = q.itemKey.slice("types:eff:".length).split(">")[0] as PokemonType;
            expect(immune.has(attacker), q.prompt).toBe(false);
          }
          if (q.itemKey.startsWith("types:immune:")) {
            const profile = defensiveProfile(target.types);
            for (const option of q.options.filter((o) => o !== q.answer)) {
              const t = option.toLowerCase() as PokemonType;
              expect(immune.has(t), `${q.prompt} offers ${option}`).toBe(false);
              expect(profile.get(t)).not.toBe(0);
            }
          }
          // An answer the Pokémon's ability cancels would be wrong in-game.
          if (q.itemKey.startsWith("types:4x:")) expect(immune.has(q.answer.toLowerCase() as PokemonType)).toBe(false);
        }
      }
    }
  });
});

describe("long endless runs", () => {
  it("never runs dry on a single small generation", () => {
    for (const mod of ["whos-that", "higher-lower", "types", "dex"] as const) {
      const rng = new Rng(`endless-${mod}`);
      const used = new Set<number>();
      for (let i = 0; i < 250; i++) {
        const q = buildQuestion(mod, rng, { difficulty: "hard", gens: [6], used });
        expect(questionSchema.safeParse(q).success).toBe(true);
      }
    }
  });
});
