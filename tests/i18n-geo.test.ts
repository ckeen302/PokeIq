import { describe, expect, it } from "vitest";
import { translator, type Tree } from "@/i18n/catalog";
import geoNames from "@/messages/geo-names";
import geoRecord from "@/messages/geo-record";
import frNames from "@/messages/fr/geo-names.json";
import jaNames from "@/messages/ja/geo-names.json";
import deRecord from "@/messages/de/geo-record.json";
import frPlaces from "@/data/i18n/fr/locations.json";
import { localGame, localMap, localPlace, localRegion } from "@/lib/geo-i18n";
import { placeLabel } from "@/lib/geo-names";
import { achievementNote, achievementText } from "@/lib/geo-achievements-text";
import { geoAchievement } from "@/lib/geo-achievements";

const en = translator(geoNames, "en", undefined);
const fr = translator(geoNames, "fr", frNames as unknown as Tree);
const ja = translator(geoNames, "ja", jaNames as unknown as Tree);

describe("PokéGuessr names in other languages", () => {
  it("leaves English exactly as the data writes it", () => {
    expect(localRegion(en, "Kanto")).toBe("Kanto");
    expect(localGame(en, "Let's Go, Pikachu! / Eevee!")).toBe("Let's Go, Pikachu! / Eevee!");
    expect(localPlace(en, null, "Route 1")).toBe("Route 1");
    expect(localMap(en, { id: "theme-gyms", name: "Gyms" })).toBe("Gyms");
    expect(placeLabel({ name: "Silph Co.", parent: "Saffron City", region: "Kanto" }, { name: "World" })).toBe("Silph Co. · Saffron City, Kanto");
  });

  it("uses each language's official regions, games and places", () => {
    expect(localRegion(ja, "Unova")).toBe("イッシュ");
    expect(localRegion(fr, "Kitakami")).toBe("Septentria");
    expect(localGame(fr, "FireRed / LeafGreen")).toBe("Rouge Feu / Vert Feuille");
    expect(localGame(ja, "Let's Go, Pikachu! / Eevee!")).toBe("Let’s Go! ピカチュウ / Let’s Go! イーブイ");
    expect(localMap(fr, { id: "world", name: "World" })).toBe("Monde");
    expect(localMap(fr, { id: "theme-routes", name: "Routes" })).toBe("Routes");
    expect(localPlace(fr, frPlaces, "Saffron City")).toBe("Safrania");
    expect(localPlace(ja, null, "Route 24")).toBe("24番道路");
    const local = { place: (s: string) => localPlace(fr, frPlaces, s), region: (s: string) => localRegion(fr, s), join: (p: string, r: string) => fr("placeIn", { place: p, region: r }) };
    expect(placeLabel({ name: "Pallet Town", region: "Kanto" }, { name: "World" }, local)).toBe("Bourg Palette, Kanto");
  });

  it("names achievements and their notes", () => {
    const de = translator(geoRecord, "de", deRecord as unknown as Tree);
    const deNames = translator(geoNames, "de", undefined);
    const def = geoAchievement("streak-10")!;
    expect(achievementText(def, translator(geoRecord, "en", undefined), en)).toEqual({ name: def.name, blurb: def.blurb });
    expect(achievementText(def, de, deNames).blurb).toBe("10 Orte in Folge in einer Serie (Nadel-Serie oder Regionen-Serie).");
    expect(achievementNote("Average 3,812 of 3,500 needed", de)).toBe("Schnitt 3.812, nötig sind 3.500");
  });
});
