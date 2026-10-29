import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import themes from "@/data/geo-themes.json";
import { buildThemes } from "../scripts/geo/themes";
import { answerFor, geoRegions, gradeGeo, isGeoSpec, planRounds, readGeo, startGeo } from "@/lib/server/geo";
import { GEO_THEMES, GEO_THEME_IDS, isWorldwide, themeMapId, themeOf } from "@/lib/geo-themes";
import { GEO_KINDS, WORLD_REGION, geoBoardKey, geoMapRank, type GeoSpec } from "@/lib/geo-types";

const tags = themes as Record<string, { places?: string[]; buildings?: string[]; preview: string }>;
const key = (r: { region?: string; location: string }) => `${r.region}|${r.location}`;

describe("themed maps: the tags", () => {
  it("are what scripts/geo/themes.ts makes of the data (run it after changing either)", () => {
    const places = JSON.parse(readFileSync("scripts/geo/world-places.json", "utf8")).places;
    const located = JSON.parse(readFileSync("src/data/geo.json", "utf8")).world.locations;
    expect(buildThemes(places, located)).toEqual(themes);
  });

  it("cover every theme, each with enough places for a game", () => {
    expect(Object.keys(tags).sort()).toEqual([...GEO_THEME_IDS].sort());
    for (const id of GEO_THEME_IDS) expect((tags[id].places ?? tags[id].buildings ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it("keep out what isn't that kind of place", () => {
    const towns = new Set(tags.towns.places);
    for (const k of ["Kanto|Indigo Plateau", "Hoenn|Battle Frontier", "Unova|Pokémon League", "Kalos|Pokémon Village"]) expect(towns.has(k)).toBe(false);
    for (const k of tags.routes.places!) expect(k).toMatch(/\|Route \d+$/);
    for (const k of tags.gyms.buildings!) expect(k).toMatch(/ (Gym|Stadium)$/);
    expect(tags.gyms.buildings).not.toContain("Alola|Kantonian Gym");
    const both = tags.towns.places!.filter((k) => tags.routes.places!.includes(k));
    expect(both).toEqual([]);
  });
});

describe("themed maps: playing them", () => {
  const maps = geoRegions();

  it("are maps of their own, after the regions, with a preview and their own boards", () => {
    const boards = new Set<string>();
    for (const t of GEO_THEMES) {
      const id = themeMapId(t.id);
      const info = maps.find((m) => m.id === id)!;
      expect(info.theme).toBe(true);
      expect(info.name).toBe(t.name);
      expect(info.preview).toMatch(/^\/api\/geo\/preview\//);
      expect(geoMapRank(id)).toBeGreaterThan(geoMapRank("paldea"));
      expect(themeOf(id)?.id).toBe(t.id);
      expect(isWorldwide(id)).toBe(true);
      for (const kind of GEO_KINDS) {
        expect(isGeoSpec({ region: id, kind })).toBe(true);
        boards.add(geoBoardKey({ region: id, kind }));
      }
    }
    expect(boards.size).toBe(GEO_THEMES.length * GEO_KINDS.length);
    expect([...boards]).not.toContain(WORLD_REGION);
    expect(themeOf("kanto")).toBeNull();
    expect(isWorldwide("kanto")).toBe(false);
  });

  it("deal only the theme's places (Gyms: only the Gym buildings)", () => {
    for (const t of GEO_THEMES) {
      const spec: GeoSpec = { region: themeMapId(t.id), kind: "game" };
      const allowed = new Set(tags[t.id].places ?? []);
      const gyms = new Set(tags[t.id].buildings ?? []);
      for (let i = 0; i < 25; i++) {
        for (const round of planRounds(spec, `theme-${t.id}-${i}`)) {
          const answer = answerFor(spec, round);
          if (gyms.size) expect(gyms.has(key(round))).toBe(true);
          else expect(allowed.has(`${answer.region}|${answer.parent ?? answer.name}`)).toBe(true);
        }
      }
    }
  });

  it("score a streak by region, like the world map", () => {
    const spec: GeoSpec = { region: themeMapId("towns"), kind: "streak" };
    const [round] = planRounds(spec, "theme-streak");
    const answer = answerFor(spec, round);
    const start = startGeo(spec, { seed: "theme-streak" });
    const right = gradeGeo(readGeo(start.token)!, { x: answer.pin[0], y: answer.pin[1] });
    expect(right.ok && right.body.hit).toBe(true);
    // The far corner of the world map is nowhere near the place's region.
    const far = answer.pin[0] > 0.5 ? 0.02 : 0.98;
    const wrong = gradeGeo(readGeo(startGeo(spec, { seed: "theme-streak" }).token)!, { x: far, y: answer.pin[1] > 0.5 ? 0.02 : 0.98 });
    expect(wrong.ok && wrong.body.hit).toBe(false);
  });
});
