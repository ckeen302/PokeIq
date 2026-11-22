import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { translator, type Tree } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import neaCats from "@/messages/nea-cats";
import neaGame from "@/messages/nea-game";
import ja from "@/messages/ja/nea-cats.json";
import es from "@/messages/es/nea-cats.json";
import fr from "@/messages/fr/nea-cats.json";
import de from "@/messages/de/nea-cats.json";
import it_ from "@/messages/it/nea-cats.json";
import jaGame from "@/messages/ja/nea-game.json";
import { NEA_CATEGORIES } from "@/lib/name-em-all/categories";
import { neaTargets } from "@/lib/name-em-all/targets";
import { categoryText, localOutsiders, localTargets } from "@/lib/name-em-all/localize";
import { buildMatcher, matchName } from "@/lib/name-em-all/match";
import { neaShareText } from "@/lib/name-em-all/share";
import { groupSlots } from "@/components/name-em-all/parts";
import { outsiderMap } from "@/components/name-em-all/use-name-input";
import { normalizeName } from "@/lib/name-em-all/match";

const FILES: Record<Exclude<Locale, "en">, Tree> = { ja, es, fr, de, it: it_ };
const cats = (l: Locale) => translator(neaCats, l, l === "en" ? undefined : FILES[l]);

/** The slot a typed name names, as that slot's English name. */
function named(locale: Locale, category: string, typed: string): string | undefined {
  const t = cats(locale);
  const targets = localTargets(category, t)!;
  const slot = matchName(buildMatcher(targets), typed);
  return slot === undefined ? undefined : neaTargets(category)![slot].name;
}

describe("Name 'em All in English is unchanged", () => {
  it("gives every category exactly its old label, heading, title and description", () => {
    const t = cats("en");
    for (const c of NEA_CATEGORIES) expect(categoryText(c, t), c.id).toEqual({ label: c.label, h1: c.h1, title: c.title, description: c.description });
  });

  it("keeps English slots, outsiders, grid labels and share text as they were", () => {
    expect(localTargets("gen-1", cats("en"))).toBe(neaTargets("gen-1"));
    expect(localOutsiders("gen-1", cats("en"))[0]).toBe("Chikorita");
    expect(groupSlots(neaTargets("all")!).map((g) => g.label).slice(0, 2)).toEqual(["Gen 1 · Kanto", "Gen 2 · Johto"]);
    expect(neaShareText({ label: "Gen 1", named: 151, total: 151, ms: 372_000, mode: "regular", daily: "2026-03-01" })).toBe("Name 'em All Daily 2026-03-01 · Gen 1 · 151/151 in 6:12 🏆");
    expect(neaShareText({ label: "Fire", named: 1, total: 85, ms: 60_000, mode: "dex" })).toBe("Name 'em All · Fire · Dex order · 1/85 in 1:00");
  });

  it("folds English typing as before and kana as letters", () => {
    expect(normalizeName("Ｍｒ．Ｍｉｍｅ")).toBe("mrmime");
    expect(normalizeName("ピカチュウ")).toBe(normalizeName("ぴかちゅう"));
  });
});

describe("Name 'em All in other languages", () => {
  it("names categories with the language's official type and region names", () => {
    const gen5 = NEA_CATEGORIES.find((c) => c.id === "gen-5")!;
    const fire = NEA_CATEGORIES.find((c) => c.id === "type-fire")!;
    const unova = NEA_CATEGORIES.find((c) => c.id === "unova-dex")!;
    expect(categoryText(fire, cats("ja")).label).toBe("ほのおタイプ");
    expect(categoryText(fire, cats("de")).h1).toBe("Nenne alle Pokémon vom Typ Feuer");
    expect(categoryText(gen5, cats("es")).title).toContain("Teselia");
    expect(categoryText(unova, cats("fr")).label).toBe("Pokédex d’Unys");
    expect(categoryText(unova, cats("it")).label).toBe("Pokédex di Unima");
  });

  it("shows the language's names on the board", () => {
    expect(localTargets("gen-1", cats("ja"))![0].name).toBe("フシギダネ");
    expect(localTargets("gen-1", cats("fr"))![0].name).toBe("Bulbizarre");
    expect(localTargets("mega-evolutions", cats("de"))!.find((t) => t.id === 10034)?.name).toBe("Mega-Glurak X");
    expect(localTargets("regional-forms", cats("es"))!.find((t) => t.name.startsWith("Vulpix"))?.name).toBe("Vulpix de Alola");
  });

  it("accepts Japanese in katakana, hiragana, rōmaji and English", () => {
    for (const typed of ["フシギダネ", "ふしぎだね", "Fushigidane", "Bulbasaur", "bulbasaur"]) expect(named("ja", "gen-1", typed), typed).toBe("Bulbasaur");
    expect(named("ja", "gen-1", "ピカチュウ")).toBe("Pikachu");
    expect(named("ja", "gen-1", "pikachuu")).toBe("Pikachu");
    expect(named("ja", "gen-1", "ニドラン♀")).toBe("Nidoran♀");
    expect(named("ja", "gen-1", "nidoran female")).toBe("Nidoran♀");
  });

  it("accepts the language's name and the English one, accents or not", () => {
    expect(named("fr", "gen-1", "Bulbizarre")).toBe("Bulbasaur");
    expect(named("fr", "gen-1", "Bulbasaur")).toBe("Bulbasaur");
    expect(named("fr", "gen-6", "Flabebe")).toBe("Flabébé");
    expect(named("de", "gen-1", "Glurak")).toBe("Charizard");
    expect(named("de", "gen-1", "Charizard")).toBe("Charizard");
    expect(named("es", "gen-1", "Mr. Mime")).toBe("Mr. Mime");
  });

  it("accepts forms the ways the page tells players to type them", () => {
    expect(named("fr", "mega-evolutions", "Méga-Florizarre")).toBe("Mega Venusaur");
    expect(named("fr", "mega-evolutions", "Florizarre")).toBe("Mega Venusaur");
    expect(named("fr", "mega-evolutions", "Mega Venusaur")).toBe("Mega Venusaur");
    expect(named("ja", "mega-evolutions", "メガリザードンX")).toBe("Mega Charizard X");
    expect(named("ja", "mega-evolutions", "リザードンY")).toBe("Mega Charizard Y");
    expect(named("ja", "mega-evolutions", "フシギバナ")).toBe("Mega Venusaur");
    expect(named("ja", "gigantamax", "キョダイマックスカビゴン")).toBe("Gigantamax Snorlax");
    expect(named("ja", "gigantamax", "カビゴン")).toBe("Gigantamax Snorlax");
    expect(named("de", "gigantamax", "Gigadynamax-Relaxo")).toBe("Gigantamax Snorlax");
    expect(named("de", "gigantamax", "Gmax Relaxo")).toBe("Gigantamax Snorlax");
    expect(named("fr", "gigantamax", "Ronflex Gigamax")).toBe("Gigantamax Snorlax");
    expect(named("es", "regional-forms", "Vulpix de Alola")).toBe("Alolan Vulpix");
    expect(named("es", "regional-forms", "Vulpix Alola")).toBe("Alolan Vulpix");
    expect(named("fr", "regional-forms", "Goupix d'Alola")).toBe("Alolan Vulpix");
    expect(named("de", "regional-forms", "Alola-Vulpix")).toBe("Alolan Vulpix");
    expect(named("it", "regional-forms", "Vulpix di Alola")).toBe("Alolan Vulpix");
    expect(named("ja", "regional-forms", "アローラロコン")).toBe("Alolan Vulpix");
    expect(named("ja", "regional-forms", "ロコン（アローラのすがた）")).toBe("Alolan Vulpix");
    expect(named("ja", "regional-forms", "arorarokon")).toBe("Alolan Vulpix");
  });

  it("lets every slot be named by its own name in every language", () => {
    for (const l of ["ja", "es", "fr", "de", "it"] as const) {
      for (const c of NEA_CATEGORIES) {
        const targets = localTargets(c.id, cats(l))!;
        const m = buildMatcher(targets);
        targets.forEach((x, slot) => expect(matchName(m, x.name), `${l} ${c.id} ${x.name}`).toBe(slot));
      }
    }
  });

  it("says which species are outside a category by their name there", () => {
    const map = outsiderMap(localOutsiders("gen-1", cats("ja")));
    expect(map.get(normalizeName("Chikorita"))).toBe("チコリータ");
    expect(map.get(normalizeName("ちこりーた"))).toBe("チコリータ");
  });

  it("labels the grid and the share text in the language", () => {
    const t = translator(neaGame, "ja", jaGame);
    expect(groupSlots(neaTargets("all")!, t)[0].label).toBe("第1世代・カントー");
    expect(neaShareText({ label: "第1世代", named: 151, total: 151, ms: 372_000, mode: "chaos" }, t)).toBe("ポケモン全部言えるかな？ · 第1世代 · カオス · 151/151（6:12） 🏆");
  });
});

describe("Name 'em All's routes and board in another language", () => {
  it("the targets route serves a live language's names, and the result route its reasons", async () => {
    vi.stubEnv("LIVE_LOCALES", "ja,fr");
    vi.resetModules();
    const route = await import("@/app/api/name-em-all/targets/[category]/[lang]/route");
    expect(route.generateStaticParams({ params: {} }).length).toBe(NEA_CATEGORIES.length * 2);
    const res = await route.GET(new Request("http://localhost/api/name-em-all/targets/gen-1/ja"), { params: Promise.resolve({ category: "gen-1", lang: "ja" }) });
    const data = (await res.json()) as { targets: { name: string; aliases?: string[] }[]; label: string; h1: string };
    expect(data.label).toBe("第1世代");
    expect(data.targets[0]).toMatchObject({ name: "フシギダネ" });
    expect(data.targets[0].aliases).toContain("Bulbasaur");
    const none = await route.GET(new Request("http://localhost/x"), { params: Promise.resolve({ category: "gen-1", lang: "de" }) });
    expect(none.status).toBe(404);

    const result = await import("@/app/api/name-em-all/result/route");
    const headers = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": "10.99.0.1" };
    const post = (q: string) => result.POST(new NextRequest(`http://localhost:3000/api/name-em-all/result${q}`, { method: "POST", headers, body: JSON.stringify({ claim: "x" }) }));
    expect(((await (await post("?lang=fr")).json()) as { reason: string }).reason).toBe("Connecte-toi pour garder ton record sur ton profil.");
    expect(((await (await post("")).json()) as { reason: string }).reason).toBe("Sign in to keep your best on your profile.");
    vi.unstubAllEnvs();
  });

  it("the setup renders in English as before, and in French with its messages", async () => {
    vi.resetModules();
    const { NameEmAll } = await import("@/components/name-em-all/NameEmAll");
    const props = { category: { id: "gen-1", label: "Gen 1" }, targets: neaTargets("gen-1")!, outsiders: [] };
    const en = renderToStaticMarkup(createElement(NameEmAll, props)).replace(/<!-- -->/g, "");
    expect(en).toContain("Personal bests: Regular mode, no hints, no pausing. The standard time is 13:00.");
    expect(en).toContain(">13 minutes (standard)</option>");
    expect(en).toContain(">1 minute</option>");
    expect(en).toContain("Any order you like.");

    vi.stubEnv("LIVE_LOCALES", "fr");
    vi.resetModules();
    const { LocaleProvider } = await import("@/i18n/locale-context");
    const { MessagesProvider } = await import("@/i18n/client");
    const { NameEmAll: Fr } = await import("@/components/name-em-all/NameEmAll");
    const messages = { "nea-game": (await import("@/messages/fr/nea-game.json")).default };
    const el = (type: unknown, p: object, child: ReactNode) => createElement(type as never, p as never, child);
    const fr = renderToStaticMarkup(el(LocaleProvider, { locale: "fr" }, el(MessagesProvider, { messages }, createElement(Fr, props)))).replace(/<!-- -->/g, "");
    expect(fr).toContain("Le temps standard est de 13:00.");
    expect(fr).toContain(">13 minutes (standard)</option>");
    expect(fr).toContain("Ordre du Pokédex");
    vi.unstubAllEnvs();
  });
});
