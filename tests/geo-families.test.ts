import { describe, expect, it } from "vitest";
import data from "@/data/geo.json";
import {
  GEO_FAMILIES,
  GEO_FAMILY_IDS,
  allowedFamilies,
  familyEra,
  familyOfGame,
  isGeoFamily,
  normalizeFamilies,
  placesFor,
} from "@/lib/geo-families";

type StoredShot = { id: string; game: string; family?: string };
const shots = (data as unknown as { world: { locations: { shots: StoredShot[] }[] } }).world.locations.flatMap((l) => l.shots);

describe("PokéGuessr game families", () => {
  it("normalises every game label to its family, remakes apart from the originals", () => {
    expect(familyOfGame("Red / Green / Blue / Yellow")).toBe("rby");
    expect(familyOfGame("Yellow")).toBe("rby");
    expect(familyOfGame("FireRed / LeafGreen")).toBe("frlg");
    expect(familyOfGame("Let's Go, Pikachu! / Eevee!")).toBe("lgpe");
    expect(familyOfGame("Crystal")).toBe("gsc");
    expect(familyOfGame("HeartGold / SoulSilver")).toBe("hgss");
    expect(familyOfGame("Sapphire / Emerald")).toBe("rse");
    expect(familyOfGame("Omega Ruby")).toBe("oras");
    expect(familyOfGame("Platinum")).toBe("dppt");
    expect(familyOfGame("Brilliant Diamond / Shining Pearl")).toBe("bdsp");
    expect(familyOfGame("Black 2 / White 2")).toBe("bw");
    expect(familyOfGame("Black / White / Black 2 / White 2")).toBe("bw");
    expect(familyOfGame("Ultra Sun / Ultra Moon")).toBe("sm");
    expect(familyOfGame("Sword / Shield")).toBe("swsh");
    expect(familyOfGame("Legends: Arceus")).toBe("pla");
    expect(familyOfGame("Legends: Z-A")).toBe("za");
    expect(familyOfGame("Pokémon Colosseum")).toBeNull();
  });

  it("splits the families into Classic 2D (to Black 2 / White 2) and Modern 3D (X / Y on, remakes included)", () => {
    const era = (id: (typeof GEO_FAMILY_IDS)[number]) => familyEra(id);
    for (const id of ["rby", "gsc", "rse", "frlg", "dppt", "hgss", "bw"] as const) expect(era(id)).toBe("2d");
    for (const id of ["xy", "oras", "sm", "lgpe", "swsh", "bdsp", "pla", "sv", "za"] as const) expect(era(id)).toBe("3d");
    expect(new Set(GEO_FAMILIES.map((f) => f.short)).size).toBe(GEO_FAMILIES.length);
  });

  it("gives every screenshot in the data a family that matches its game", () => {
    expect(shots.length).toBeGreaterThan(1500);
    for (const s of shots) {
      expect(isGeoFamily(s.family), s.id).toBe(true);
      expect(familyOfGame(s.game), `${s.id} ${s.game}`).toBe(s.family);
    }
  });

  it("lets a filter through only its era's families, narrowed by any picked", () => {
    expect(allowedFamilies({}).size).toBe(GEO_FAMILY_IDS.length);
    expect([...allowedFamilies({ era: "2d" })]).toEqual(["rby", "gsc", "rse", "frlg", "dppt", "hgss", "bw"]);
    expect([...allowedFamilies({ era: "3d", families: ["xy", "rby", "nope"] })]).toEqual(["xy"]);
    expect([...allowedFamilies({ families: ["sv", "rby"] })]).toEqual(["rby", "sv"]);
  });

  it("keeps picked families only when they narrow the era", () => {
    expect(normalizeFamilies(undefined, undefined)).toBeUndefined();
    expect(normalizeFamilies("2d", [])).toBeUndefined();
    expect(normalizeFamilies("2d", ["rby", "gsc", "rse", "frlg", "dppt", "hgss", "bw"])).toBeUndefined();
    expect(normalizeFamilies("2d", ["hgss", "rby", "sv", "rby"])).toEqual(["rby", "hgss"]);
    expect(normalizeFamilies(undefined, ["za", "xy"])).toEqual(["xy", "za"]);
  });

  it("counts a filter's places from the map's family combinations", () => {
    const combos = { rby: 3, "rby,frlg": 4, "frlg,lgpe": 2, lgpe: 1 };
    expect(placesFor(combos, {})).toBe(10);
    expect(placesFor(combos, { era: "2d" })).toBe(9);
    expect(placesFor(combos, { era: "3d" })).toBe(3);
    expect(placesFor(combos, { families: ["frlg"] })).toBe(6);
    // A pick outside the era leaves nothing.
    expect(placesFor(combos, { era: "3d", families: ["frlg"] })).toBe(0);
  });
});
