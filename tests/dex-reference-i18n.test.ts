import { describe, expect, it } from "vitest";
import { ABILITIES, ITEMS, MOVES } from "@/lib/dex/data";
import { dexLocal, itemCategory } from "@/lib/dex/local";
import { NOT_LETTER, foldLetters } from "@/lib/names/fold";
import { translator } from "@/i18n/catalog";
import dexRef from "@/messages/dex-ref";
import ids from "@/data/dex-text-ids.json";
import frRef from "@/messages/fr/dex-ref.json";

describe("Moves / Abilities / Items in other languages", () => {
  it("leaves English exactly as the records have it", async () => {
    const L = await dexLocal("en");
    expect(L.move("Flamethrower")).toBe("Flamethrower");
    expect(L.type("fire")).toBe("Fire");
    expect(L.versionGroup("red-blue")).toBe("Red / Blue");
    expect(L.version("omega-ruby")).toBe("Omega Ruby");
    expect(L.moveText(1)).toBeUndefined();
    expect(L.aliases("Pound", "Pound")).toEqual([]);
    expect(itemCategory(translator(dexRef, "en", undefined), "Stat Boosts")).toBe("Stat Boosts");
  });

  it("gives official names, game texts and titles in the page's language", async () => {
    const fr = await dexLocal("fr");
    expect(fr.move("Flamethrower")).toBe("Lance-Flammes");
    expect(fr.ability("Overgrow")).toBe("Engrais");
    expect(fr.item("Master Ball")).toBe("Master Ball");
    expect(fr.type("psychic")).toBe("Psy");
    expect(fr.versionGroup("x-y")).toBe("X / Y");
    expect(fr.versionGroup("the-teal-mask")).toBe("Le Masque Turquoise");
    expect(fr.moveText(MOVES.find((m) => m.slug === "flamethrower")!.id)).toMatch(/flammes/);
    expect(fr.abilityText("overgrow")).toMatch(/Plante/);
    expect(fr.itemText("master-ball")).toBeTruthy();
    expect(fr.aliases("Lance-Flammes", "Flamethrower")).toEqual(["Flamethrower"]);
    expect(itemCategory(translator(dexRef, "fr", frRef), "Stat Boosts")).toBe("Hausse de stats");

    const ja = await dexLocal("ja");
    expect(ja.move("Thunderbolt")).toBe("１０まんボルト");
    expect(ja.aliases("１０まんボルト", "Thunderbolt")).toEqual(["Thunderbolt", "10まんボルト", "10manboruto"]);
    expect(ja.aliases("ハイドロポンプ", "Hydro Pump")).toEqual(["Hydro Pump", "haidoroponpu"]);
    expect(ja.versionGroup("red-blue")).toBe("赤 / 青");
  });

  it("knows the PokéAPI number of every ability and item", () => {
    for (const a of ABILITIES) expect(ids.abilities, a.slug).toHaveProperty([a.slug]);
    for (const i of ITEMS) expect(ids.items, i.slug).toHaveProperty([i.slug]);
  });

  it("names every item category in the messages", () => {
    const keys = Object.keys(dexRef.en.categories);
    for (const c of new Set(ITEMS.map((i) => i.category))) expect(keys).toContain(c.toLowerCase().replace(/[^a-z0-9]/g, ""));
  });

  it("searches English names and effects exactly as before", () => {
    const old = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const now = (s: string) => foldLetters(s).replace(NOT_LETTER, "");
    for (const s of [...MOVES.map((m) => m.name), ...ABILITIES.flatMap((a) => [a.name, a.effect]), ...ITEMS.map((i) => i.name)]) expect(now(s), s).toBe(old(s));
  });
});
