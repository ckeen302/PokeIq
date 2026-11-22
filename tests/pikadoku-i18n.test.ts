import { describe, expect, it } from "vitest";
import { translator } from "@/i18n/catalog";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { allFacts } from "@/lib/pikadoku/categories";
import { PDK_CATALOG } from "@/lib/pikadoku/catalog";
import { categoryHint } from "@/lib/pikadoku/hints";
import { categoryLabel, formName, pikadokuLocal } from "@/lib/pikadoku/local";
import { localNoBoard, noBoardMessage } from "@/lib/pikadoku/no-board";
import { indexEntries, localizeEntries, searchEntries, type SearchEntry } from "@/lib/pikadoku/search";
import { WEEK_THEMES, themeFor } from "@/lib/pikadoku/weekly";
import { WEEK_THEME_IDS, themeIdFor } from "@/lib/pikadoku/weeks";
import { challengeLabel } from "@/lib/pikadoku/challenge";
import board from "@/messages/pikadoku-board";
import page from "@/messages/pikadoku-page";
import pikadoku from "@/messages/pikadoku";
import jaBoard from "@/messages/ja/pikadoku-board.json";
import frBoard from "@/messages/fr/pikadoku-board.json";
import dePikadoku from "@/messages/de/pikadoku.json";
import esPikadoku from "@/messages/es/pikadoku.json";
import type { Locale } from "@/i18n/config";
import type { Tree } from "@/i18n/catalog";

// The picker's real list, as /api/pikadoku/dex sends it: every species and every playable form, in English.
const english: SearchEntry[] = [...POKEDEX.map((p) => ({ id: p.id, name: p.name, base: p.id })), ...allFacts().filter((f) => f.form).map((f) => ({ id: f.id, name: f.name, base: f.baseId }))];

async function searcher(locale: Locale) {
  const local = await pikadokuLocal(locale);
  const entries = localizeEntries(english, local?.names);
  const index = indexEntries(entries);
  return {
    local,
    name: (id: number) => entries.find((e) => e.id === id)?.name,
    first: (q: string) => searchEntries(index, q, 8)[0]?.id,
    ids: (q: string) => searchEntries(index, q, 8).map((e) => e.id),
  };
}

describe("Pikadoku's picker in other languages", () => {
  it("sends nothing on English pages, and English search is unchanged", async () => {
    expect(pikadokuLocal("en")).toBeUndefined();
    expect(localizeEntries(english, undefined)).toBe(english);
    const en = await searcher("en");
    expect(en.first("charizard")).toBe(6);
    expect(en.first("alolan raichu")).toBe(10100);
  });

  it("finds Spanish names, forms in Spanish and the English names", async () => {
    const es = await searcher("es");
    expect(es.name(10100)).toBe("Raichu de Alola");
    expect(es.name(10034)).toBe("Mega-Charizard X");
    expect(es.name(10199)).toBe("Pikachu Gigamax");
    expect(es.first("raichu de alola")).toBe(10100);
    expect(es.first("alolan raichu")).toBe(10100);
    expect(es.ids("raichu").slice(0, 2)).toEqual([26, 10100]);
    expect(es.first("colmilargo")).toBe(984);
    expect(es.first("great tusk")).toBe(984);
  });

  it("finds French names with or without accents, and the English names", async () => {
    const fr = await searcher("fr");
    expect(fr.name(6)).toBe("Dracaufeu");
    expect(fr.name(10100)).toBe("Raichu d’Alola");
    expect(fr.first("dracaufeu")).toBe(6);
    expect(fr.first("charizard")).toBe(6);
    expect(fr.first("evoli")).toBe(133);
    expect(fr.first("Évoli")).toBe(133);
    expect(fr.first("eevee")).toBe(133);
    expect(fr.first("draucafeu")).toBe(6); // a typo
    expect(fr.ids("mega dracaufeu").sort()).toEqual([10034, 10035]);
    expect(fr.first("mega charizard y")).toBe(10035);
  });

  it("finds Japanese names from katakana, hiragana, rōmaji or English", async () => {
    const ja = await searcher("ja");
    expect(ja.name(25)).toBe("ピカチュウ");
    expect(ja.name(10100)).toBe("ライチュウ（アローラのすがた）");
    expect(ja.name(10034)).toBe("メガリザードンX");
    expect(ja.first("ピカチュウ")).toBe(25);
    expect(ja.first("ぴかちゅう")).toBe(25);
    expect(ja.first("pikachuu")).toBe(25);
    expect(ja.first("Pikachu")).toBe(25);
    expect(ja.first("lizardon")).toBe(6);
    expect(ja.first("charizard")).toBe(6);
    expect(ja.ids("らいちゅう").slice(0, 2)).toEqual([26, 10100]);
    expect(ja.first("alolan raichu")).toBe(10100);
  });

  it("names every form in German and Italian too", async () => {
    const de = await searcher("de");
    expect(de.name(10100)).toBe("Alola-Raichu");
    expect(de.name(10034)).toBe("Mega-Glurak X");
    expect(de.first("glurak")).toBe(6);
    const it = await searcher("it");
    expect(it.name(10100)).toBe("Raichu di Alola");
    expect(it.name(10229)).toBe("Growlithe di Hisui");
  });

  it("builds the English form names exactly from the slugs (the same rules as the other languages)", () => {
    const t = translator(page, "en", undefined);
    const bySpecies = new Map(POKEDEX.map((p) => [p.id, p]));
    for (const f of allFacts().filter((x) => x.form)) {
      const sp = bySpecies.get(f.baseId)!;
      expect(formName(f.slug!, sp.slug, sp.name, t), f.slug).toBe(f.name);
    }
  });
});

describe("Pikadoku's category labels in other languages", () => {
  it("uses the official type, move, ability and region names", async () => {
    const fr = (await pikadokuLocal("fr"))!.labels;
    expect(fr["type:fire"]).toBe("Feu");
    expect(fr["move:Thunderbolt"]).toBe("Tonnerre");
    expect(fr["ability:blaze"]).toBe("Brasier");
    expect(fr["region:5"]).toBe("Unys");
    expect(fr["form:alola"]).toBe("Forme d’Alola");
    const ja = (await pikadokuLocal("ja"))!.labels;
    expect(ja["type:fire"]).toBe("ほのお");
    expect(ja["move:Thunderbolt"]).toBe("１０まんボルト");
    expect(ja["other:legendary"]).toBe("伝説のポケモン");
    expect((await pikadokuLocal("es"))!.labels["region:5"]).toBe("Teselia");
    expect((await pikadokuLocal("de"))!.labels["evo:stone"]).toBe("Entwicklung per Stein");
  });

  it("labels every category in every language, and in Japanese none is left in English", async () => {
    for (const locale of ["ja", "es", "fr", "de", "it"] as const) {
      const { labels } = (await pikadokuLocal(locale))!;
      for (const c of PDK_CATALOG) expect(labels[c.id], `${locale} ${c.id}`).toBeTruthy();
    }
    const ja = (await pikadokuLocal("ja"))!.labels;
    for (const c of PDK_CATALOG) if (c.id !== "other:ou") expect(ja[c.id], c.id).not.toBe(c.label);
  });

  it("keeps the English labels in English (the catalog's)", () => {
    const t = translator(page, "en", undefined);
    for (const c of PDK_CATALOG) {
      if (/^(type|move):/.test(c.id) || (c.id.startsWith("ability:") && c.id !== "ability:hidden")) continue;
      expect(categoryLabel(c.id, "?", t, { types: {}, moves: {}, abilities: {} }), c.id).toBe(c.label);
    }
  });

  it("explains each category in the page's language", () => {
    const ja = translator(board, "ja", jaBoard as unknown as Tree);
    expect(categoryHint("type:fire", ja, "ほのお")).toMatch(/^ほのおタイプ/);
    expect(categoryHint("other:mega", ja)).toContain("メガリザードンX");
    const fr = translator(board, "fr", frBoard as unknown as Tree);
    expect(categoryHint("other:mega", fr)).toContain("Méga-Dracaufeu X");
    expect(categoryHint("type:fire")).toBe(categoryHint("type:fire", translator(board, "en", undefined), "Fire"));
  });
});

describe("Pikadoku's other text in other languages", () => {
  it("says why a board can't be dealt in the page's language", () => {
    const de = translator(pikadoku, "de", dePikadoku as unknown as Tree);
    const opts = { allowSingle: false, band: "hard" as const };
    expect(localNoBoard(noBoardMessage("none", opts), opts, de)).toBe(
      "Zu diesen Einstellungen passt kein Raster. Um sie zu erweitern: mehr Kategorien wählen, Schwierigkeit Normal probieren oder Felder mit nur einer Antwort erlauben."
    );
    expect(localNoBoard(noBoardMessage("few", opts), opts, de)).toMatch(/^Diese Kategorien allein/);
    const en = translator(pikadoku, "en", undefined);
    expect(localNoBoard("Server text.", opts, en)).toBe("Server text.");
  });

  it("counts guesses in the page's language", () => {
    const es = translator(pikadoku, "es", esPikadoku as unknown as Tree);
    expect(challengeLabel({ solved: 9, guesses: 1 }, es)).toBe("9/9 en 1 intento");
    expect(challengeLabel({ solved: 7, guesses: 12 }, es)).toBe("7/9 en 12 intentos");
  });

  it("knows each week's theme on the client, as the server picks it", () => {
    expect(WEEK_THEMES.map((t) => t.id)).toEqual([...WEEK_THEME_IDS]);
    for (const monday of ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]) expect(themeIdFor(monday)).toBe(themeFor(monday).id);
    expect(WEEK_THEMES[0].name).toBe("Kanto week");
  });
});
