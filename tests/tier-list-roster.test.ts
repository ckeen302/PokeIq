import { describe, expect, it } from "vitest";
import { Dex } from "pokemon-showdown";
import POKEDEX from "@/data/pokedex.json";
import DETAILS from "@/data/pokedex-details.json";
import { buildRoster, formName, rosterSources } from "@/lib/tier-list/roster.server";
import { TEMPLATES, getTemplate, templateMons } from "@/lib/tier-list/templates";
import { artUrl } from "@/lib/tier-list/art";
import { ART, CAT, TYPES } from "@/lib/tier-list/types";

const roster = buildRoster();
const keys = new Set(roster.mons.map((m) => m.k));
const byKey = new Map(roster.mons.map((m) => [m.k, m]));
const names = (slug: string) => templateMons(getTemplate(slug)!, roster.mons).map((m) => m.n);

describe("tier list roster", () => {
  it("has every species in the Pokédex, once", () => {
    const dex = (POKEDEX as { id: number }[]).map((p) => p.id);
    const species = roster.mons.filter((m) => !m.f).map((m) => m.d);
    const missing = dex.filter((id) => !species.includes(id));
    expect(missing).toEqual([]);
    expect(new Set(species).size).toBe(species.length);
  });

  it("has every species Showdown's data knows (new Pokémon flow in by themselves)", () => {
    const nums = new Set(Dex.species.all().filter((s) => s.exists && s.num > 0 && !s.forme && s.isNonstandard !== "CAP" && s.isNonstandard !== "Custom").map((s) => s.num));
    const have = new Set(roster.mons.filter((m) => !m.f).map((m) => m.d));
    expect([...nums].filter((n) => !have.has(n))).toEqual([]);
  });

  it("has every form in the site's Pokédex data (Megas, regional forms, Gigantamax…)", () => {
    const arts = new Set(roster.mons.map((m) => m.a));
    const forms = Object.values(DETAILS as Record<string, { forms: { id: number; name: string }[] }>).flatMap((d) => d.forms);
    const missing = forms.filter((f) => !arts.has(String(f.id))).map((f) => f.name);
    // Totem Pokémon are left out on purpose (the same look as the species).
    expect(missing.filter((n) => !/Totem/.test(n))).toEqual([]);
  });

  it("has every form with a picture of its own, Legends: Z-A's Megas and the cosmetic ones included", () => {
    for (const k of ["charizardmegax", "charizardmegay", "clefablemega", "absolmegaz", "raichumegax", "floettemega", "zygardemega", "venusaurgmax", "raichualola", "taurospaldeacombat", "unownb", "unownquestion", "vivillonpolar", "vivillonpokeball", "rotomwash", "arceusfire"]) {
      expect(keys, k).toContain(k);
    }
    expect(roster.mons.filter((m) => m.k.startsWith("unown")).length).toBe(28);
    expect(roster.mons.filter((m) => m.k.startsWith("vivillon")).length).toBe(20);
    expect(roster.mons.length).toBeGreaterThan(1400);
    expect(new Set(roster.mons.map((m) => m.a)).size).toBe(roster.mons.length);
  });

  it("leaves out forms with no picture of their own, and Totems", () => {
    for (const m of roster.mons) expect(m.m & (ART.home | ART.pixel), m.n).toBeTruthy();
    expect([...keys].some((k) => k.includes("totem"))).toBe(false);
    expect(rosterSources().length).toBeGreaterThanOrEqual(roster.mons.length);
  });

  it("names forms the way people write them", () => {
    expect(byKey.get("charizardmegax")!.n).toBe("Mega Charizard X");
    expect(byKey.get("absolmegaz")!.n).toBe("Mega Absol Z");
    expect(byKey.get("raichualola")!.n).toBe("Alolan Raichu");
    expect(byKey.get("laprasgmax")!.n).toBe("Gigantamax Lapras");
    expect(byKey.get("taurospaldeacombat")!.n).toBe("Paldean Tauros (Combat Breed)");
    expect(byKey.get("unownquestion")!.n).toBe("Unown (?)");
    expect(formName("Kyogre", "Primal")).toBe("Primal Kyogre");
  });

  it("builds every template from data", () => {
    expect(names("starters")).toEqual(expect.arrayContaining(["Bulbasaur", "Charmander", "Squirtle", "Sprigatito", "Fuecoco", "Quaxly", "Rowlet"]));
    expect(names("starters").length).toBe(27);
    expect(names("pseudo-legendaries").sort()).toEqual(["Baxcalibur", "Dragapult", "Dragonite", "Garchomp", "Goodra", "Hydreigon", "Kommo-o", "Metagross", "Salamence", "Tyranitar"]);
    expect(names("eeveelutions").length).toBe(8);
    expect(names("fossils")).toEqual(expect.arrayContaining(["Omanyte", "Aerodactyl", "Tyrantrum", "Dracovish"]));
    expect(names("ultra-beasts")).toEqual(expect.arrayContaining(["Nihilego", "Blacephalon", "Naganadel"]));
    expect(names("ultra-beasts")).not.toContain("Necrozma");
    expect(names("paradox")).toEqual(expect.arrayContaining(["Great Tusk", "Iron Valiant", "Walking Wake", "Iron Crown"]));
    expect(names("mythicals")).toEqual(expect.arrayContaining(["Mew", "Pecharunt"]));
    expect(names("legendaries")).toEqual(expect.arrayContaining(["Mewtwo", "Koraidon", "Tapu Koko"]));
    expect(names("megas")).toEqual(expect.arrayContaining(["Mega Charizard X", "Primal Groudon", "Mega Clefable"]));
    expect(names("regional-forms")).toEqual(expect.arrayContaining(["Alolan Vulpix", "Galarian Ponyta", "Hisuian Zorua", "Paldean Wooper"]));
    expect(names("every-pokemon").length).toBe((POKEDEX as unknown[]).length);
    expect(names("every-form").length).toBe(roster.mons.length);
    expect(names("gen-1").length).toBe(151);
    expect(names("legends-z-a")).toEqual(expect.arrayContaining(["Chikorita", "Mega Dragonite", "Zygarde"]));
    expect(names("champions")).toEqual(expect.arrayContaining(["Garchomp", "Mega Charizard Y"]));
    for (const t of TYPES) expect(names(`${t}-type`).length, t).toBeGreaterThan(30);
    for (const t of TEMPLATES) if (t.group !== "custom") expect(names(t.slug).length, t.slug).toBeGreaterThan(4);
    expect(names("custom")).toEqual([]);
  });

  it("flags categories on species and forms", () => {
    expect(byKey.get("mewtwo")!.c & CAT.legendary).toBeTruthy();
    expect(byKey.get("mewtwomegax")!.c & CAT.legendary).toBeTruthy();
    expect(byKey.get("charizardmegax")!.c & CAT.starter).toBe(0);
  });

  it("serves the site's own HOME renders where it has them, PokéAPI's otherwise", () => {
    const pika = byKey.get("pikachu")!;
    expect(artUrl(pika, "hd", false)).toBe("/sizes/art/256/25.webp");
    expect(artUrl(pika, "hd", true)).toMatch(/other\/home\/shiny\/25\.png$/);
    expect(artUrl(pika, "pixel", false)).toMatch(/sprites\/pokemon\/25\.png$/);
    expect(artUrl(pika, "pixel", true)).toMatch(/sprites\/pokemon\/shiny\/25\.png$/);
    expect(artUrl(byKey.get("unownb")!, "pixel", false)).toMatch(/201-b\.png$/);
  });
});
