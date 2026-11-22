import { beforeEach, describe, expect, it, vi } from "vitest";
import { translator, type Namespace, type Tree } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";

// serverT in the render's language, without React's request cache: the test picks the language.
let locale: Locale = "en";
const loaded: Record<string, Tree> = {};
vi.mock("@/i18n/server", () => ({
  serverT: <T extends Tree>(ns: Namespace<T>) =>
    translator(ns, locale, locale === "en" ? undefined : loaded[`${locale}/${ns.name}`]),
  getLocale: () => locale,
}));

// The messages as the build loads them (compiled by the same loader as the site's).
for (const l of ["fr", "ja"]) for (const n of ["geo-names", "trainers", "places", "globe-page"]) loaded[`${l}/${n}`] = (await import(`../src/messages/${l}/${n}.json`)).default;

const { dexNames } = await import("@/lib/dex/local-names");
const { atlasNames } = await import("@/lib/dex/atlas-names");
const { battleLabel, formLabel, levelText, roleName, tagName } = await import("@/lib/trainers/i18n");
const { gameName } = await import("@/lib/trainers/explorer-local");
const { globeLocal } = await import("@/lib/globe/local");
const { globeRegionCards } = await import("@/lib/globe/regions");
const trainersNs = (await import("@/messages/trainers")).default;
const { serverT } = await import("@/i18n/server");

describe("Places and Trainers names", () => {
  beforeEach(() => {
    locale = "en";
  });

  it("leaves English exactly as it was", () => {
    const n = dexNames();
    expect(n.place("Pokémon Mansion (Kanto)")).toBe("Pokémon Mansion (Kanto)");
    expect(n.version("firered")).toBe("FireRed");
    expect(n.gameList("Red, Blue and Yellow")).toBe("Red, Blue and Yellow");
    expect(gameName(n, { key: "red-blue", name: "Red & Blue" })).toBe("Red & Blue");
    const t = serverT(trainersNs);
    expect(tagName(t, n, "Rematch 2")).toBe("Rematch 2");
    expect(battleLabel(t, n, {}, 0)).toBe("First battle");
    expect(battleLabel(t, n, {}, 2)).toBe("Battle 3");
    expect(levelText(t, [{ lv: 10 }, { lv: 14 }])).toBe("Lv 10–14");
    expect(levelText(t, [{ lv: 5 }])).toBe("Lv 5");
    expect(roleName(t, "Gym Leader")).toBe("Gym Leader");
    expect(atlasNames()).toBeNull();
    const cards = globeRegionCards();
    expect(globeLocal(cards)).toEqual({ cards, local: null });
  });

  it("uses the official names in another language", () => {
    locale = "fr";
    const n = dexNames();
    expect(n.place("Saffron City")).toBe("Safrania");
    expect(n.place("Kanto Route 1")).toBe("Route 1");
    expect(n.region("Kanto")).toBe("Kanto");
    expect(n.move("Surf")).toBe("Surf");
    expect(n.version("firered")).toBe("Rouge Feu");
    expect(gameName(n, { key: "red-blue", name: "Red & Blue" })).toBe("Rouge & Bleu");
    expect(n.gameList("Red, Blue and Yellow")).toBe("Rouge, Bleu et Jaune");
    const t = serverT(trainersNs);
    expect(tagName(t, n, "Rematch 2")).toBe("Revanche 2");
    expect(tagName(t, n, "If you chose Bulbasaur")).toBe("Si tu as choisi Bulbizarre");
    expect(tagName(t, n, "Requires Surf and Dive")).toBe("Nécessite Surf et Plongée");
    expect(tagName(t, n, "After speaking with Kagetora")).toBe("After speaking with Kagetora");
    expect(formLabel(t, "Alolan Form")).toBe("Forme d’Alola");
    expect(roleName(t, "Elite Four")).toBe("Conseil 4");
    expect(atlasNames()?.["Saffron City"]).toBe("Safrania");
    const { cards, local } = globeLocal(globeRegionCards());
    expect(local?.origins.Kalos).toMatch(/Illumis/);
    expect(cards.find((c) => c.name === "Kanto")?.starters.map((s) => s.name)).toContain("Bulbizarre");
  });

  it("keeps a name English when the language's data has none", () => {
    locale = "ja";
    const n = dexNames();
    expect(n.place("Not A Real Place")).toBe("Not A Real Place");
    expect(n.place("Route 1")).toBe("１番道路");
    expect(gameName(n, { key: "red-blue", name: "Red & Blue" })).toBe("赤・青");
  });
});
