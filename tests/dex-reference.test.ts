import { describe, expect, it } from "vitest";
import { Dex } from "@pkmn/dex";
import details from "@/data/pokedex-details.json";
import pokedex from "@/data/pokedex.json";
import { natureRows } from "@/lib/dex/natures";
import { speciesNames } from "@/lib/dex/species-names";
import { TYPES, effectiveness } from "@/lib/pokemon/type-matrix";

describe("natures", () => {
  const rows = natureRows();
  const by = (n: string) => rows.find((r) => r.name === n)!;
  it("has all 25, five of them neutral", () => {
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => !r.plus)).toHaveLength(5);
  });
  it("maps stats and flavors", () => {
    expect(by("Adamant")).toMatchObject({ plus: "atk", minus: "spa", likes: "Spicy", dislikes: "Dry" });
    expect(by("Timid")).toMatchObject({ plus: "spe", minus: "atk", likes: "Sweet", dislikes: "Spicy" });
    expect(by("Hardy")).toMatchObject({ plus: null, likes: null, dislikes: null });
  });
});

describe("species names", () => {
  it("has Pikachu's names", () => {
    const n = Object.fromEntries(speciesNames(25).map((x) => [x.lang, x.name]));
    expect(n.ja).toBe("ピカチュウ");
    expect(n.ko).toBe("피카츄");
    expect(n["zh-hans"]).toBe("皮卡丘");
  });
  it("covers every species in every language", () => {
    const ids = [...new Set((pokedex as { id: number }[]).map((p) => p.id))];
    for (const id of ids) expect(speciesNames(id), `species ${id}`).toHaveLength(9);
  });
});

describe("type chart", () => {
  it("is 18 types and spot-checks hold", () => {
    expect(TYPES).toHaveLength(18);
    expect(effectiveness("fairy", ["dragon"])).toBe(2);
    expect(effectiveness("ground", ["flying"])).toBe(0);
    expect(effectiveness("steel", ["fairy"])).toBe(2);
  });
  it("agrees with @pkmn/dex everywhere", () => {
    for (const a of TYPES) for (const d of TYPES) {
      const dexMult = { 0: 1, 1: 2, 2: 0.5, 3: 0 }[Dex.types.get(d).damageTaken[Dex.types.get(a).name] as 0 | 1 | 2 | 3];
      expect(effectiveness(a, [d]), `${a}→${d}`).toBe(dexMult);
    }
  });
});

describe("form switcher data", () => {
  it("every form's types and base stats match @pkmn/dex", () => {
    const alias: Record<string, string> = {
      "tauros-paldea-combat-breed": "Tauros-Paldea-Combat",
      "tauros-paldea-blaze-breed": "Tauros-Paldea-Blaze",
      "tauros-paldea-aqua-breed": "Tauros-Paldea-Aqua",
      "darmanitan-galar-standard": "Darmanitan-Galar",
      "zygarde-10-power-construct": "Zygarde-10%",
      "indeedee-female": "Indeedee-F",
      "basculegion-female": "Basculegion-F",
      "oinkologne-female": "Oinkologne-F",
    };
    let checked = 0;
    for (const r of Object.values(details) as { forms: { slug: string; name: string; types: string[]; stats: Record<string, number> }[] }[]) {
      for (const f of r.forms) {
        if (/gmax/.test(f.slug)) continue;
        const bySlug = Dex.species.get(alias[f.slug] ?? f.slug);
        const s = bySlug.exists ? bySlug : Dex.species.get(f.name.replace(/\s+/g, ""));
        expect(s.exists, f.slug).toBe(true);
        expect(s.baseStats, f.slug).toMatchObject({ hp: f.stats.hp, atk: f.stats.atk, def: f.stats.def, spa: f.stats.spa, spd: f.stats.spd, spe: f.stats.spe });
        expect(s.types.map((t) => t.toLowerCase()).sort(), f.slug).toEqual([...f.types].sort());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});
