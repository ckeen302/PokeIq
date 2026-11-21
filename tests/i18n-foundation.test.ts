import { afterEach, describe, expect, it, vi } from "vitest";

/** The i18n modules read LIVE_LOCALES when they load: each test loads them fresh under its own value. */
async function load(live: string, preview = false) {
  vi.resetModules();
  vi.stubEnv("LIVE_LOCALES", live);
  vi.stubEnv("I18N_PREVIEW", preview ? "1" : "");
  const [config, paths, routes, metadata, seo] = await Promise.all([
    import("@/i18n/config"),
    import("@/i18n/paths"),
    import("@/i18n/routes"),
    import("@/i18n/metadata"),
    import("@/lib/seo"),
  ]);
  return { ...config, ...paths, ...routes, ...metadata, ...seo };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("English only (LIVE_LOCALES empty, today's production)", () => {
  it("has no other language and no prefixes", async () => {
    const m = await load("");
    expect(m.LIVE_OTHER_LOCALES).toEqual([]);
    expect(m.HAS_OTHER_LOCALES).toBe(false);
    expect(m.splitLocale("/es/pokedle")).toEqual({ locale: "en", path: "/es/pokedle" });
    expect(m.isPageLive("/pokedle", "es")).toBe(false);
  });

  it("emits no hreflang: page metadata is exactly what it was", async () => {
    const m = await load("", true);
    const meta = m.pageMetadata({ title: "Pokédle", description: "d", path: "/pokedle" });
    expect(meta.alternates).toEqual({ canonical: "/pokedle" });
    expect(m.pageAlternates("/pokedle")).toBeNull();
    expect(m.languageAlternates("/")).toBeUndefined();
  });
});

describe("with Spanish and Japanese live", () => {
  it("splits and builds language paths", async () => {
    const m = await load("es,ja,xx");
    expect(m.LIVE_OTHER_LOCALES).toEqual(["ja", "es"]);
    expect(m.splitLocale("/es/pokedle")).toEqual({ locale: "es", path: "/pokedle" });
    expect(m.splitLocale("/es")).toEqual({ locale: "es", path: "/" });
    expect(m.splitLocale("/fr/pokedle")).toEqual({ locale: "en", path: "/fr/pokedle" }); // not live: not a prefix
    expect(m.splitLocale("/espeon")).toEqual({ locale: "en", path: "/espeon" });
    expect(m.localizePath("/", "es")).toBe("/es");
    expect(m.localizePath("/?x=1", "es")).toBe("/es?x=1");
    expect(m.localizePath("/pokemon/pikachu#moves", "ja")).toBe("/ja/pokemon/pikachu#moves");
    expect(m.localizePath("https://x.test/a", "ja")).toBe("https://x.test/a");
    expect(m.localizePath("/pokedle", "en")).toBe("/pokedle");
  });

  it("serves only translated pages (or everything in local preview)", async () => {
    const m = await load("es");
    expect(m.isPageLive("/admin", "es")).toBe(false);
    expect(m.isPageLive("/pokedle", "fr")).toBe(false);
    const p = await load("es", true);
    expect(p.isPageLive("/pokemon/pikachu?x=1", "es")).toBe(true);
    expect(p.isPageLive("/pokemon/pikachu", "fr")).toBe(false); // preview never makes a language live
  });

  it("gives every language the same reciprocal hreflang set, with itself and x-default (English)", async () => {
    const m = await load("es,ja", true);
    const set = m.pageAlternates("/pokemon/pikachu");
    expect(set).toEqual({ en: "/pokemon/pikachu", ja: "/ja/pokemon/pikachu", es: "/es/pokemon/pikachu", "x-default": "/pokemon/pikachu" });
    expect(Object.keys(set!).every((c) => ["en", "es", "fr", "de", "it", "ja", "x-default"].includes(c))).toBe(true);
    expect(m.pageAlternates("/")).toEqual({ en: "/", ja: "/ja", es: "/es", "x-default": "/" });
  });

  it("points a page's metadata at its own language: canonical self, og:locale, hreflang", async () => {
    const m = await load("es", true);
    const en = m.pageMetadata({ title: "Pokédle", description: "d", path: "/pokedle" });
    expect(en.alternates?.languages).toEqual({ en: "/pokedle", es: "/es/pokedle", "x-default": "/pokedle" });
    const es = m.localizeMetadata(en, "es");
    expect(es.alternates?.canonical).toBe("/es/pokedle");
    expect(es.alternates?.languages).toEqual(en.alternates?.languages);
    expect(es.openGraph).toMatchObject({ locale: "es_ES", url: "/es/pokedle" });
  });

  it("never lists alternates on a noindex page", async () => {
    const m = await load("es", true);
    const meta = m.pageMetadata({ title: "t", description: "d", path: "/x", noindex: true });
    expect(meta.alternates?.languages).toBeUndefined();
    expect(m.localizeMetadata(meta, "es").alternates?.languages).toBeUndefined();
  });
});

describe("messages", () => {
  it("formats ICU plurals and falls back to English", async () => {
    vi.resetModules();
    const { translator, defineNamespace } = await import("@/i18n/catalog");
    const compile = (await import("icu-minify/compile")).default;
    const ns = defineNamespace("t", { wins: compile("{n, plural, one {# win} other {# wins}}"), hi: "Hi" } as never);
    const en = translator(ns, "en", undefined) as unknown as (k: string, v?: object) => string;
    expect(en("wins", { n: 1 })).toBe("1 win");
    expect(en("wins", { n: 1234 })).toBe("1,234 wins");
    const de = translator(ns, "de", { wins: compile("{n, plural, one {# Sieg} other {# Siege}}") } as never) as unknown as (k: string, v?: object) => string;
    expect(de("wins", { n: 1234 })).toBe("1.234 Siege");
    expect(de("hi")).toBe("Hi"); // missing in German: English
  });

  it("compiles the message files at import (as next build does)", async () => {
    const common = (await import("@/messages/common")).default;
    expect(common.name).toBe("common");
    expect(common.en.settings.language).toBe("Language");
  });
});
