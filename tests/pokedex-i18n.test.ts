import { beforeAll, describe, expect, it, vi } from "vitest";
import { translator, type Namespace, type Tree } from "@/i18n/catalog";
import type { OtherLocale } from "@/i18n/config";

// serverT in the language under test (a page's render enters it with enterLocale; a unit test has no render).
// (vitest compiles each language's messages on import, as the build does.)
const lang = vi.hoisted(() => ({ locale: "es" as string, messages: {} as Record<string, unknown> }));
vi.mock("@/i18n/server", () => ({
  serverT: (ns: Namespace) => translator(ns, lang.locale as OtherLocale, lang.messages[`${lang.locale}/${ns.name}`] as Tree),
  getLocale: () => lang.locale,
}));

const { POKEDEX, getPokemonBySlug } = await import("@/lib/pokemon/pokedex");
const { getDexEntry } = await import("@/lib/pokemon/details");
const { localizeDexEntry, localDexDescription, localDexSummary, localDexTitle } = await import("@/lib/pokemon/dex-entry-local");
const { dexListLocal } = await import("@/lib/pokemon/dex-local");
const { matchesLocalDexQuery } = await import("@/lib/pokemon/dex-search-local");

const LOCALES: OtherLocale[] = ["ja", "es", "fr", "de", "it"];
beforeAll(async () => {
  for (const l of LOCALES)
    for (const ns of ["pokemon-data", "pokemon-page", "pikadoku-page"])
      lang.messages[`${l}/${ns}`] = ((await import(`@/messages/${l}/${ns}.json`)) as { default: unknown }).default;
});
const ENGLISH_WORD = /\b(Level|Use|Trade|holding|knowing|with|at night|during)\b/;
// German writes "Level" too.
const ENGLISH_NOT_LEVEL = /\b(Use|Trade|holding|knowing|with|at night|during)\b/;

describe("species pages in other languages", () => {
  it.each(LOCALES)("%s: names, types, abilities, moves and evolution methods are in the language", (locale) => {
    lang.locale = locale;
    const p = getPokemonBySlug("charizard")!;
    const d = localizeDexEntry(getDexEntry(p), locale);
    expect(d.core.name).toBe(p.names[locale] ?? p.name);
    expect(d.local?.english).toBe("Charizard");
    expect(d.abilities.every((a) => a.label && a.label !== a.name)).toBe(true);
    expect(d.learnset!.moves.filter((m) => m.effect).length).toBeGreaterThan(d.learnset!.moves.length / 2);
    expect(d.entries.length).toBeGreaterThan(0);
    expect(d.forms.map((f) => f.name).join()).not.toMatch(/Mega Charizard/);
    expect(localDexTitle(p, locale)).toContain(d.core.name);
    expect(localDexDescription(p, locale)).toContain(d.core.name);
    expect(localDexSummary(p, locale)).toContain(String(p.bst));
  });

  it.each(LOCALES)("%s: every evolution method is translated", (locale) => {
    lang.locale = locale;
    const left: string[] = [];
    const walk = (n: { conditions: string[]; children: { conditions: string[]; children: never[] }[] }) => {
      for (const c of n.conditions) if ((locale === "de" ? ENGLISH_NOT_LEVEL : ENGLISH_WORD).test(c)) left.push(c);
      n.children.forEach(walk as never);
    };
    for (const p of POKEDEX) {
      const tree = localizeDexEntry(getDexEntry(p), locale).evolutionTree;
      if (tree) walk(tree as never);
    }
    expect(left).toEqual([]);
  });

  it("the Pokédex list's search takes the language's names, English and rōmaji", () => {
    const ja = dexListLocal("ja");
    const pika = { id: 25, name: "ピカチュウ", genus: "ねずみポケモン" };
    for (const q of ["ぴかちゅう", "ピカ", "pikachu", "Pikachu", "ねずみ", "mouse", "25"]) expect(matchesLocalDexQuery(pika, q, ja.search[25])).toBe(true);
    expect(matchesLocalDexQuery(pika, "raichu", ja.search[25])).toBe(false);
    const de = dexListLocal("de");
    expect(matchesLocalDexQuery({ id: 6, name: "Glurak", genus: "Flammen-Pokémon" }, "charizard", de.search[6])).toBe(true);
    expect(de.types.fire).toBe("Feuer");
  });
});
