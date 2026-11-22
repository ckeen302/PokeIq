import { describe, expect, it } from "vitest";
import { gameName, mapName, placeName, type GuessrNames } from "@/components/geo/duel-names";
import type { GeoAnswer, GeoRegionInfo } from "@/lib/geo-types";

const world = { id: "world", name: "World" } as GeoRegionInfo;
const kanto = { id: "kanto", name: "Kanto" } as GeoRegionInfo;
const answer = (a: Partial<GeoAnswer>) => ({ name: "", game: "", family: "frlg", pin: [0, 0], mask: [], squares: 0, ...a }) as GeoAnswer;

const fr: GuessrNames = {
  maps: { world: "Monde", kanto: "Kanto" },
  places: { route1: "Route 1", pallettown: "Bourg Palette", pewtercity: "Argenta", kanto: "Kanto", johto: "Johto" },
  games: { sword: "Épée", shield: "Bouclier", letsgopikachu: "Let’s Go, Pikachu", letsgoeevee: "Let’s Go, Évoli" },
  gameSep: " / ",
};

describe("PokéGuessr duel names", () => {
  it("leaves English exactly as the server wrote it", () => {
    expect(placeName(answer({ name: "Kanto Route 1", region: "Kanto" }), world)).toBe("Route 1, Kanto");
    expect(placeName(answer({ name: "Pewter Gym", parent: "Pewter City", region: "Kanto" }), kanto)).toBe("Pewter Gym · Pewter City");
    expect(placeName(answer({ name: "Iron Ruins (Sinnoh)", region: "Sinnoh" }), world)).toBe("Iron Ruins, Sinnoh");
    expect(gameName("Sword / Shield")).toBe("Sword / Shield");
    expect(mapName(world)).toBe("World");
  });

  it("uses the official names in another language, English where there is none", () => {
    expect(placeName(answer({ name: "Pallet Town", region: "Kanto" }), world, fr)).toBe("Bourg Palette, Kanto");
    expect(placeName(answer({ name: "Pewter Gym", parent: "Pewter City", region: "Kanto" }), kanto, fr)).toBe("Pewter Gym · Argenta");
    expect(gameName("Sword / Shield", fr)).toBe("Épée / Bouclier");
    expect(gameName("Let's Go, Pikachu! / Eevee!", fr)).toBe("Let’s Go, Pikachu / Let’s Go, Évoli");
    expect(gameName("Crystal", fr)).toBe("Crystal");
    expect(mapName(world, fr)).toBe("Monde");
  });

  it("names the Gym Leader bot and the divisions in the page's language", async () => {
    const { translator } = await import("@/i18n/catalog");
    const ranked = (await import("@/messages/guessr-ranked")).default;
    const { gymLeaderLabel, divisionName } = await import("@/components/geo/GeoRanked");
    const en = translator(ranked, "en", undefined);
    const de = translator(ranked, "de", (await import("@/messages/de/guessr-ranked.json")).default);
    const ja = translator(ranked, "ja", (await import("@/messages/ja/guessr-ranked.json")).default);
    expect(gymLeaderLabel(en, "Gym Leader Brock")).toBe("Gym Leader Brock");
    expect(gymLeaderLabel(de, "Gym Leader Misty")).toBe("Arenaleiterin Misty");
    expect(gymLeaderLabel(ja, "Gym Leader Lt. Surge")).toBe("ジムリーダー マチス");
    expect(gymLeaderLabel(ja, "Gym Leader Brock", "name")).toBe("タケシ");
    expect(gymLeaderLabel(de, "Red")).toBe("Red");
    expect(divisionName(en, "beast")).toBe("Beast Ball");
    expect(divisionName(de, "ultra")).toBe("Hyperball");
  });
});
