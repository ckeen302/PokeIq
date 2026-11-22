import { describe, expect, it } from "vitest";
import { normalizeName, suggest, type NameEntry } from "@/components/pokedle/search";
import { normalizeName as pikaNormalize } from "@/lib/pikadoku/search";
import { foldLetters } from "@/lib/names/fold";

describe("name folding in every language", () => {
  it("folds English names exactly as before", () => {
    // The old folding: NFD, accents off, lower case, ♀/♂ as f/m, then a-z and digits only.
    const old = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/♀/g, "f").replace(/♂/g, "m").replace(/[^a-z0-9]/g, "");
    for (const n of ["Farfetch'd", "Flabébé", "Mr. Mime", "Nidoran♀", "Nidoran♂", "Type: Null", "Ho-Oh", "Porygon-Z", "Sirfetch’d", "Jangmo-o", "Mime Jr.", "Kommo-o", "Tapu Koko", "Great Tusk"]) {
      expect(normalizeName(n)).toBe(old(n));
    }
    expect(pikaNormalize("Mr. Mime")).toBe("mr mime");
    expect(pikaNormalize("Nidoran♀")).toBe("nidoran f");
  });

  it("keeps kana and accented Latin letters as letters", () => {
    expect(foldLetters("ピカチュウ")).toBe("ぴかちゅう");
    expect(normalizeName("ピカチュウ")).toBe(normalizeName("ぴかちゅう"));
    expect(normalizeName("Évoli")).toBe("evoli");
    expect(normalizeName("Bisasam")).toBe("bisasam");
    expect(pikaNormalize("ミュウツー")).toBe("みゅうつー");
  });
});

describe("Pokédle's suggestions in another language", () => {
  const ja: NameEntry[] = [
    [25, "ピカチュウ", 1, ["Pikachu", "pikachuu"]],
    [26, "ライチュウ", 1, ["Raichu", "raichuu"]],
    [150, "ミュウツー", 1, ["Mewtwo", "Myuutsuu", "myuutsuu"]],
  ];
  const fr: NameEntry[] = [
    [133, "Évoli", 1, ["Eevee"]],
    [1, "Bulbizarre", 1, ["Bulbasaur"]],
  ];
  const ids = (r: { entries: NameEntry[] }) => r.entries.map((e) => e[0]);

  it("finds Japanese names from katakana, hiragana, rōmaji or English", () => {
    expect(ids(suggest(ja, "ピカ", new Set()))).toEqual([25]);
    expect(ids(suggest(ja, "ぴかちゅう", new Set()))).toEqual([25]);
    expect(ids(suggest(ja, "pikachuu", new Set()))).toEqual([25]);
    expect(ids(suggest(ja, "Pikachu", new Set()))).toEqual([25]);
    expect(ids(suggest(ja, "mewtwo", new Set()))).toEqual([150]);
    expect(ids(suggest(ja, "ちゅう", new Set()))).toEqual([25, 26]);
  });

  it("finds French names with or without accents, and the English name", () => {
    expect(ids(suggest(fr, "evoli", new Set()))).toEqual([133]);
    expect(ids(suggest(fr, "Évoli", new Set()))).toEqual([133]);
    expect(ids(suggest(fr, "eevee", new Set()))).toEqual([133]);
    expect(ids(suggest(fr, "bulbizare", new Set()))).toEqual([1]);
  });

  it("says a name was already guessed in either language", () => {
    expect(suggest(fr, "eevee", new Set([133])).alreadyGuessed?.[0]).toBe(133);
  });
});
