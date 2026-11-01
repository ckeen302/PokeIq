import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import atlasJson from "../public/atlas/atlas.json";
import geo from "@/data/geo.json";
import blur from "@/data/geo-shot-blur.json";
import { clampEra, eraVisibility, LAST_GEN, regionGeneration, regionsAt } from "@/lib/globe/era";
import { latOf, lonOf, uvOf, type Atlas } from "@/lib/globe/geo";
import { atlasMountains } from "@/lib/globe/mountains";
import { buildGlobeShotIndex, isLegendsShot, publicShotOf, type GlobeLocationInput } from "@/lib/globe/shots";
import { globeIntroSeen, markGlobeIntroSeen, resetGlobeIntroMemory, shouldPlayGlobeIntro } from "@/lib/globe/intro";
import { GLOBE_MAIN_REGIONS, globeEras, globeRegionCards } from "@/lib/globe/regions";
import { mostRecentShot, placeType } from "@/lib/dex/places";

const atlas = atlasJson as unknown as Atlas;
const LOCATIONS = (geo as unknown as { world: { locations: GlobeLocationInput[] } }).world.locations;

describe("globe era filter", () => {
  it("dates each region by its first main-series generation", () => {
    expect(regionGeneration("Kanto")).toBe(1);
    expect(regionGeneration("Johto")).toBe(2);
    expect(regionGeneration("Hoenn")).toBe(3);
    expect(regionGeneration("Sevii Islands")).toBe(3);
    expect(regionGeneration("Sinnoh")).toBe(4);
    expect(regionGeneration("Unova")).toBe(5);
    expect(regionGeneration("Kalos")).toBe(6);
    expect(regionGeneration("Alola")).toBe(7);
    expect(regionGeneration("Galar")).toBe(8);
    expect(regionGeneration("Crown Tundra")).toBe(8);
    expect(regionGeneration("Paldea")).toBe(9);
    expect(regionGeneration("Kitakami")).toBe(9);
    expect(regionGeneration("Nowhere")).toBeNull();
  });

  it("grows the world one generation at a time: Gen 1 is only Kanto, Gen 2 adds Johto, Gen 9 is everything", () => {
    const mains = [...GLOBE_MAIN_REGIONS];
    expect(regionsAt(1, mains)).toEqual(["Kanto"]);
    expect(regionsAt(2, mains)).toEqual(["Kanto", "Johto"]);
    expect(regionsAt(3, mains)).toEqual(["Kanto", "Johto", "Hoenn"]);
    for (let g = 1; g < LAST_GEN; g++) expect(regionsAt(g + 1, mains).length).toBeGreaterThan(regionsAt(g, mains).length);
    expect(regionsAt(LAST_GEN, mains)).toEqual(mains);
  });

  it("fades a region in across the step that adds it", () => {
    expect(eraVisibility(2, 1)).toBe(0);
    expect(eraVisibility(2, 1.5)).toBeCloseTo(0.5);
    expect(eraVisibility(2, 2)).toBe(1);
    expect(eraVisibility(2, 9)).toBe(1);
    expect(eraVisibility(null, 1)).toBe(1);
    expect(clampEra("3")).toBe(3);
    expect(clampEra("99")).toBe(LAST_GEN);
    expect(clampEra("x")).toBe(LAST_GEN);
  });

  it("the era steps list the regions each generation adds, dated by their first game", () => {
    const eras = globeEras();
    expect(eras).toHaveLength(LAST_GEN);
    expect(eras[0]).toMatchObject({ gen: 1, year: 1996, regions: ["Kanto"] });
    expect(eras[1]).toMatchObject({ gen: 2, year: 1999, regions: ["Johto"] });
    expect(eras[8].regions).toEqual(["Paldea"]);
  });

  it("the GPU's generation map agrees with the atlas: every labelled place sits on its own region's generation", async () => {
    const { data, info } = await sharp(path.join(process.cwd(), "public/geo/maps/globe-gens.png")).raw().toBuffer({ resolveWithObject: true });
    const parent = new Map(atlas.regions.map((r) => [r.name, r.parent ?? r.name]));
    let ok = 0, n = 0;
    for (const p of [...atlas.markers, ...atlas.places]) {
      const [u, v] = uvOf(p.x, p.y, atlas.W, atlas.H);
      const i = Math.min(info.height - 1, Math.floor(v * info.height)) * info.width + Math.min(info.width - 1, Math.floor(u * info.width));
      n++;
      if (data[i * info.channels] / 25 === regionGeneration(parent.get(p.region) ?? p.region)) ok++;
    }
    // Two places of different regions can share a texel at a border; nearly all must match.
    expect(ok / n).toBeGreaterThan(0.99);
  });
});

describe("globe hover pictures", () => {
  const loc = (region: string, shots: { id: string; game: string; family: string }[], name = "Town", parent?: string): GlobeLocationInput => ({ name, region, ...(parent ? { parent } : {}), shots });

  it("never shows a Legends: Arceus, Legends: Z-A or Hisui picture, nor an older one in its place", () => {
    const index = buildGlobeShotIndex(
      [
        loc("Kalos", [{ id: "aaaaaaaa01", game: "X / Y", family: "xy" }, { id: "aaaaaaaa02", game: "Legends: Z-A", family: "za" }], "Lumiose City"),
        loc("Hisui", [{ id: "aaaaaaaa03", game: "Legends: Arceus", family: "pla" }], "Jubilife Village"),
        loc("Sinnoh", [{ id: "aaaaaaaa04", game: "Platinum", family: "dppt" }, { id: "aaaaaaaa05", game: "Legends: Arceus", family: "pla" }], "Jubilife City"),
        loc("Kanto", [{ id: "aaaaaaaa06", game: "Red / Blue", family: "rby" }, { id: "aaaaaaaa07", game: "FireRed / LeafGreen", family: "frlg" }], "Pallet Town"),
      ],
      { preview: (id) => `/api/geo/preview/p-${id.slice(-2)}` },
    );
    expect(Object.keys(index)).toEqual(["Pallet Town · Kanto"]);
    expect(index["Pallet Town · Kanto"]).toEqual([{ n: "Pallet Town", g: "FireRed / LeafGreen", src: "/api/geo/preview/p-07" }]);
    expect(isLegendsShot({ family: "za" }, "Kalos")).toBe(true);
    expect(isLegendsShot({ family: "xy" }, "Hisui")).toBe(true);
    expect(isLegendsShot({ family: "xy", game: "X / Y" }, "Kalos")).toBe(false);
  });

  it("a town shows its own picture first, then its buildings', each the one its Pokédex page shows", () => {
    const index = buildGlobeShotIndex(
      [
        loc("Kanto", [{ id: "bbbbbbbb01", game: "Let's Go, Pikachu! / Eevee!", family: "lgpe" }], "Professor Oak's Laboratory", "Pallet Town"),
        loc("Kanto", [{ id: "bbbbbbbb02", game: "Red / Blue", family: "rby" }, { id: "bbbbbbbb03", game: "FireRed / LeafGreen", family: "frlg" }], "Pallet Town"),
      ],
      { preview: (id) => `/p/${id}` },
    );
    expect(index["Pallet Town · Kanto"].map((s) => [s.n, s.src])).toEqual([
      ["Pallet Town", "/p/bbbbbbbb03"],
      ["Professor Oak's Laboratory", "/p/bbbbbbbb01"],
    ]);
  });

  it("over the real data: only Pokédex place-page pictures, under preview names, with no Legends picture", () => {
    const ids = new Set(LOCATIONS.flatMap((l) => l.shots.map((s) => s.id)));
    const pageShot = new Map(LOCATIONS.map((l) => [l.name + "|" + l.region, mostRecentShot(l.shots.filter((s) => !!s.family) as { id: string; game: string; family: string }[])]));
    const legends = new Set(LOCATIONS.flatMap((l) => l.shots.filter((s) => isLegendsShot(s, l.region)).map((s) => s.id)));
    const index = buildGlobeShotIndex(LOCATIONS, { preview: (id) => `P(${id})` });
    const shown = Object.values(index).flat();
    expect(shown.length).toBeGreaterThan(400);
    for (const s of shown) {
      const id = /^P\((.+)\)$/.exec(s.src)![1];
      expect(ids.has(id)).toBe(true);
      expect(legends.has(id)).toBe(false);
    }
    // Each label's pictures are exactly its places' page pictures.
    for (const l of LOCATIONS) {
      const s = publicShotOf(l);
      const page = pageShot.get(l.name + "|" + l.region);
      if (s) expect(s.id).toBe(page?.id);
    }
  });

  it("the served index never carries a round's id or a round's placeholder", async () => {
    const { GET } = await import("@/app/guessr/globe/shots.json/route");
    const text = await (await GET()).text();
    const index = JSON.parse(text) as Record<string, { src: string; b?: string }[]>;
    expect(Object.keys(index).length).toBeGreaterThan(400);
    for (const list of Object.values(index)) for (const s of list) expect(s.src).toMatch(/^\/api\/geo\/preview\/[A-Za-z0-9_-]+$/);
    for (const l of LOCATIONS) for (const s of l.shots) expect(text.includes(s.id)).toBe(false);
    const blurs = Object.values(blur as Record<string, string>);
    const placeholders = new Set(Object.values(index).flat().map((s) => s.b?.replace(/^data:image\/webp;base64,/, "")));
    for (const b of blurs) expect(placeholders.has(b)).toBe(false);
  }, 60_000);
});

describe("globe mountains", () => {
  const peaks = atlasMountains(atlas);

  it("raises the iconic peaks", () => {
    const names = peaks.map((m) => m.name);
    for (const n of ["Mt. Silver", "Mt. Coronet", "Mt. Moon", "Mt. Chimney", "Mt. Pyre", "Spear Pillar", "Mount Lanakila"]) expect(names).toContain(n);
    expect(names).not.toContain("Dividing Peak Tunnel");
    expect(new Set(peaks.map((m) => m.name + m.region)).size).toBe(peaks.length);
  });

  it("puts every peak exactly on its atlas pin", () => {
    for (const m of peaks) {
      const pin = [...atlas.markers, ...atlas.places].find((p) => p.name === m.name && p.region === m.region)!;
      expect(pin).toBeTruthy();
      expect([m.x, m.y]).toEqual([pin.x, pin.y]);
      expect(m.lon).toBeCloseTo(lonOf(pin.x, atlas.W), 10);
      expect(m.lat).toBeCloseTo(latOf(pin.y, atlas.W, atlas.H), 10);
    }
  });

  it("includes every atlas place the Pokédex calls a mountain", () => {
    const none = { gyms: new Set<string>(), towns: new Set<string>(), routes: new Set<string>() };
    const names = new Set(peaks.map((m) => m.name + "|" + m.region));
    for (const p of atlas.places) if (placeType(p, none) === "Mountain") expect(names.has(p.name + "|" + p.region)).toBe(true);
  });
});

describe("globe region cards", () => {
  const cards = globeRegionCards();

  it("has every main region with its generation, first game's starters and links", () => {
    expect(cards.map((c) => c.name)).toEqual([...GLOBE_MAIN_REGIONS]);
    const kanto = cards.find((c) => c.name === "Kanto")!;
    expect(kanto).toMatchObject({ gen: 1, year: 1996, guessr: "/guessr?region=kanto", places: "/pokedex/places?region=Kanto" });
    expect(kanto.starters.map((s) => s.name)).toEqual(["Bulbasaur", "Charmander", "Squirtle"]);
    expect(kanto.games[0].title).toBe("Red and Green");
    const paldea = cards.find((c) => c.name === "Paldea")!;
    expect(paldea.starters.map((s) => s.name)).toEqual(["Sprigatito", "Fuecoco", "Quaxly"]);
    for (const c of cards) {
      expect(c.games.length).toBeGreaterThan(0);
      expect(c.guessr).toMatch(/^\/guessr\?region=[a-z]+$/);
    }
  });

  it("links only to PokéGuessr maps that exist", () => {
    const crops = Object.keys((geo as unknown as { world: { crops: Record<string, unknown> } }).world.crops);
    for (const c of cards) expect(crops).toContain(new URL(c.guessr!, "https://x").searchParams.get("region"));
  });
});

describe("globe intro", () => {
  it("plays once per browser, never under reduced motion, and survives storage that throws", () => {
    resetGlobeIntroMemory();
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(shouldPlayGlobeIntro({ store, reducedMotion: true })).toBe(false);
    expect(shouldPlayGlobeIntro({ store, reducedMotion: false })).toBe(true);
    markGlobeIntroSeen(store);
    expect(shouldPlayGlobeIntro({ store, reducedMotion: false })).toBe(false);
    resetGlobeIntroMemory();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(globeIntroSeen(broken)).toBe(false);
    markGlobeIntroSeen(broken);
    expect(globeIntroSeen(broken)).toBe(true);
    resetGlobeIntroMemory();
  });

  it("the scene and the sound load lazily: the page shell only imports their types", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/globe/WorldGlobe.tsx"), "utf8");
    expect(src).toMatch(/import\("\.\/scene"\)/);
    expect(src).toMatch(/import\("\.\/audio"\)/);
    for (const line of src.split("\n").filter((l) => /from "\.\/(scene|audio)"/.test(l))) expect(line).toMatch(/^import type /);
  });
});
