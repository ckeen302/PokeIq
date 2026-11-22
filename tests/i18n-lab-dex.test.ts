import { describe, expect, it } from "vitest";
import { translator, type Tree } from "@/i18n/catalog";
import type { OtherLocale } from "@/i18n/config";
import pokemonData from "@/messages/pokemon-data";
import sizesNames from "@/messages/sizes-names";
import { normalizeName } from "@/components/pokedle/search";
import { labDetails, labRows } from "@/lib/lab-dex/data";
import { labDetailsIn, labLocal, labRowsIn } from "@/lib/lab-dex/local";
import { searchSequence } from "@/lib/lab-dex/sequence";
import { fromRow } from "@/lib/lab-dex/types";

const LOCALES: OtherLocale[] = ["ja", "es", "fr", "de", "it"];
const load = async <T extends Tree>(ns: { name: string; en: T }, l: OtherLocale) =>
  translator(ns as never, l, (await import(`@/messages/${l}/${ns.name}.json`)).default as Tree) as never;

describe("the Professor's Lab in other languages", () => {
  it("keeps English rows as they were: no extra fields", () => {
    for (const r of labRows()) expect(r.length).toBe(23);
    expect(fromRow(labRows()[0]).english).toBeUndefined();
  });

  it("names every Pokémon in the language, with its English name and other names for the search", async () => {
    const ja = labRowsIn("ja", await load(sizesNames, "ja"));
    const es = labRowsIn("es", await load(sizesNames, "es"));
    const zard = (rows: typeof ja) => fromRow(rows.find((r) => r[0] === 6)!);
    expect(zard(ja).name).toBe("リザードン");
    expect(zard(ja).english).toBe("Charizard");
    expect(zard(ja).alt?.split(" ")).toContain("charizard");
    expect(zard(ja).genus).not.toBe(zard(es).genus);
    expect(ja.length).toBe(labRows().length);
    // Forms by the games' patterns ("Mega Charizard X" → メガリザードンX).
    const megaX = ja.map(fromRow).find((m) => m.english === "Mega Charizard X");
    expect(megaX?.name).toContain("リザードン");
    expect(megaX?.name).not.toBe("Mega Charizard X");
  });

  it("finds a Pokémon by its name in any script and by its English name", async () => {
    const all = labRowsIn("ja", await load(sizesNames, "ja")).map(fromRow);
    const seq = all.map((_, i) => i);
    const first = (q: string) => all[seq[searchSequence(all, seq, q, 1, normalizeName)[0]]]?.id;
    expect(first("リザードン")).toBe(6);
    expect(first("りざーどん")).toBe(6);
    expect(first("Charizard")).toBe(6);
  });

  it("sends every type's name", () => {
    for (const l of LOCALES) expect(Object.keys(labLocal(l).types)).toHaveLength(18);
    expect(labLocal("de").types.fire).toBe("Feuer");
  });

  it("gives the details in the language: entry, abilities and evolution methods", async () => {
    for (const l of LOCALES) {
      const d = labDetailsIn(25, l, await load(pokemonData, l))!;
      const en = labDetails(25)!;
      expect(d.entry?.text).toBeTruthy();
      expect(d.entry?.text).not.toBe(en.entry?.text);
      expect(d.abilities.map((a) => a.hidden)).toEqual(en.abilities.map((a) => a.hidden));
      expect(d.abilities[0].name).not.toBe(en.abilities[0].name);
      const pichu = d.evolution!;
      expect(pichu.id).toBe(172);
      if (l === "ja") expect(pichu.name).toBe("ピチュー");
      const raichu = pichu.children[0].children[0];
      expect(raichu.conditions[0]).not.toBe(en.evolution!.children[0].children[0].conditions[0]);
    }
  });

  it("leaves out an entry the language's games don't have rather than showing English", async () => {
    // Sprigatito (Gen 9): no Pokédex texts in the data for other languages.
    const d = labDetailsIn(906, "es", await load(pokemonData, "es"));
    expect(d?.entry).toBeNull();
  });
});
