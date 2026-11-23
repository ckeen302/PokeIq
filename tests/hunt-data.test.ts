/**
 * Pokémon Hunt answer table (src/data/hunt/answers.json): every answer is a real map place,
 * in the right region for its game, in the right form, by a counted method; and the table is
 * exactly what the build makes from the current data (scripts/hunt/build.ts).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import answers from "@/data/hunt/answers.json";
import geo from "@/data/geo.json";
import aboutForms from "@/data/about-forms.json";
import pokedex from "@/data/pokedex.json";
import { HUNT_MAP_REGIONS, HUNT_REGIONS, HUNT_REGION_OF_GEO, type HuntAnswerFile, type HuntEntry } from "@/lib/hunt/types";
import { VERSION_BY_KEY, versionOrder } from "@/lib/pokemon/encounter-types";
import { buildAnswers } from "../scripts/hunt/build-lib";
import { loadInputs } from "../scripts/hunt/build";
import { FAMOUS } from "../scripts/hunt/famous";
import { FORMS_IN_GAME, ORIGINAL_ONLY, PLACE_DEPENDENT_FORMS } from "../scripts/hunt/forms";
import { buildPlaceIndex, classifyMethod, matchPlace, type GeoPlace } from "../scripts/hunt/match";
import { METHODS, VERSION_REGIONS } from "../scripts/hunt/rules";

const table = answers as unknown as HuntAnswerFile;
const entries: HuntEntry[] = table.entries;
const locations = (geo as unknown as { world: { locations: GeoPlace[] } }).world.locations;
const pinned = new Map(locations.filter((l) => l.pin && l.mask && !l.parent).map((l) => [`${l.region}|${l.name}`, l]));
const forms = aboutForms as unknown as [number, number, string, string, string][];
const dex = new Map((pokedex as { id: number; slug: string; name: string }[]).map((p) => [p.id, p]));
const COUNTED_LABELS = new Set(Object.values(METHODS).filter((v): v is string => !!v));

describe("hunt answer table: shape", () => {
  it("is the full table, not the sample", () => {
    expect(table.version).toBe(1);
    expect(table.sample).toBeUndefined();
    expect(entries.length).toBeGreaterThan(300);
  });

  it("has one entry per species and form, with stable ids", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of entries) expect(e.id).toBe(e.form ? `${e.dex}-${e.form}` : String(e.dex));
  });

  it("lists regions as the set of its places' regions, in order", () => {
    for (const e of entries) {
      const want = HUNT_REGIONS.filter((r) => e.places.some((p) => p.region === r));
      expect(e.regions, e.id).toEqual(want);
      expect(e.places.length, e.id).toBeGreaterThan(0);
    }
  });

  it("has difficulty in range, measured only for maps it has spots on", () => {
    for (const e of entries) {
      expect(e.difficulty, e.id).toBeGreaterThanOrEqual(0);
      expect(e.difficulty, e.id).toBeLessThanOrEqual(1);
      for (const [r, v] of Object.entries(e.regionDifficulty)) {
        expect(HUNT_MAP_REGIONS as readonly string[], e.id).toContain(r);
        expect(e.regions as string[], e.id).toContain(r);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("flags famous only where a hand-picked spot is one of the answers", () => {
    for (const e of entries.filter((x) => x.famous)) expect(FAMOUS.some((f) => f.id === e.id && e.places.some((p) => p.name === f.place)), e.id).toBe(true);
    for (const f of FAMOUS) {
      const e = entries.find((x) => x.id === f.id);
      if (e && e.places.some((p) => p.name === f.place)) expect(e.famous, f.id).toBe(true);
    }
  });
});

describe("hunt answer table: places", () => {
  it("names a pinned map place exactly, with its pin, in the Hunt region it folds into", () => {
    for (const e of entries)
      for (const p of e.places) {
        const g = pinned.get(`${p.geoRegion}|${p.name}`);
        expect(g, `${e.id}: ${p.geoRegion} / ${p.name}`).toBeDefined();
        expect(p.pin).toEqual(g!.pin);
        expect(p.region).toBe(HUNT_REGION_OF_GEO[p.geoRegion]);
      }
  });

  it("puts every game's answer in that game's own region", () => {
    for (const e of entries)
      for (const p of e.places)
        for (const m of p.methods)
          for (const v of m.versions) {
            expect(VERSION_BY_KEY[v], v).toBeDefined();
            if (v === "legends-za") expect(`${p.geoRegion}|${p.name}`, e.id).toBe("Kalos|Lumiose City");
            else expect(VERSION_REGIONS[v], `${e.id} ${v} at ${p.name}`).toContain(p.geoRegion);
          }
  });

  it("labels each method with its games, in game order", () => {
    for (const e of entries)
      for (const p of e.places) {
        expect(p.methods.length).toBeGreaterThan(0);
        for (const m of p.methods) {
          expect([...m.versions].sort((a, b) => versionOrder(a) - versionOrder(b))).toEqual(m.versions);
          expect(m.games).toBe(m.versions.map((v) => VERSION_BY_KEY[v].name).join(" / "));
        }
      }
  });

  it("never counts an excluded method or game", () => {
    for (const e of entries)
      for (const p of e.places)
        for (const m of p.methods) {
          expect(COUNTED_LABELS, `${e.id} ${m.method}`).toContain(m.method);
          expect(m.versions).not.toContain("legends-arceus");
          if (m.method === "Max Raid") for (const v of m.versions) expect(["sword", "shield"]).toContain(v);
          for (const bad of ["Tera Raid", "Hyperspace", "Gift", "Trade", "Curry", "Underground", "Friend Safari", "Island Scan"]) expect(m.method).not.toContain(bad);
        }
  });
});

describe("hunt answer table: forms", () => {
  const regional = new Map<number, { key: string; art: number; name: string }[]>();
  for (const [art, d, slug, name, kind] of forms) {
    if (kind !== "regional" || slug.endsWith("-zen")) continue;
    const m = /-(alola|galar|hisui|paldea)(?:-(combat|blaze|aqua)-breed)?(?:-standard)?$/.exec(slug)!;
    regional.set(d, [...(regional.get(d) ?? []), { key: m[2] ? `${m[1]}-${m[2]}` : m[1], art, name: name.replace(/^Standard /, "") }]);
  }

  it("shows each entry's own form: the art and name are that form's", () => {
    for (const e of entries) {
      const mon = dex.get(e.dex)!;
      expect(e.slug).toBe(mon.slug);
      if (!e.form) {
        expect(e.art, e.id).toBe(e.dex);
        expect(e.name, e.id).toBe(mon.name);
      } else {
        const f = regional.get(e.dex)?.find((x) => x.key === e.form);
        expect(f, e.id).toBeDefined();
        expect(e.art, e.id).toBe(f!.art);
        expect(e.name, e.id).toBe(f!.name);
        expect(e.art).toBeGreaterThan(10000);
      }
    }
  });

  it("only puts a regional form in games that have it", () => {
    for (const e of entries.filter((x) => x.form))
      for (const p of e.places)
        for (const m of p.methods)
          for (const v of m.versions) {
            expect(ORIGINAL_ONLY.has(v), `${e.id} in ${v}`).toBe(false);
            expect(FORMS_IN_GAME[v], `${e.id} in ${v}`).toContain(e.form!.split("-")[0]);
          }
  });

  it("never gives the original and a regional form the same game and place unless both are recorded there", () => {
    // A mix-up would copy one form's rows onto another: identical answers are the tell.
    for (const [d] of regional) {
      const same = entries.filter((e) => e.dex === d);
      for (let i = 0; i < same.length; i++)
        for (let j = i + 1; j < same.length; j++) expect(JSON.stringify(same[i].places), `${same[i].id} vs ${same[j].id}`).not.toBe(JSON.stringify(same[j].places));
    }
  });

  it("leaves out species whose form depends on the spot", () => {
    for (const d of Object.keys(PLACE_DEPENDENT_FORMS)) expect(entries.some((e) => e.dex === Number(d))).toBe(false);
  });

  it("keeps the regional forms apart in the sample cases", () => {
    const meowth = entries.filter((e) => e.dex === 52);
    for (const e of meowth) {
      const vs = new Set(e.places.flatMap((p) => p.methods.flatMap((m) => m.versions)));
      if (e.form === "alola") for (const v of vs) expect(["sun", "moon", "ultra-sun", "ultra-moon"]).toContain(v);
      if (e.form === "galar") for (const v of vs) expect(["sword", "shield", "scarlet", "violet", "legends-za"]).toContain(v);
      if (!e.form) for (const v of vs) expect(["sun", "moon", "ultra-sun", "ultra-moon", "sword", "shield"]).not.toContain(v);
    }
  });
});

describe("hunt matching rules", () => {
  const idx = buildPlaceIndex(locations);
  const at = (loc: string, v: string) => {
    const m = matchPlace(idx, loc, v);
    return m.kind === "place" ? m.key : null;
  };

  it("matches by game and name, never by name alone", () => {
    expect(at("Route 1", "red")).toBe("Kanto|Route 1");
    expect(at("Route 1", "sun")).toBe("Alola|Route 1");
    expect(at("Route 1", "sword")).toBe("Galar|Route 1");
    expect(at("Route 1", "x")).toBe("Kalos|Route 1");
    expect(at("Route 1", "black")).toBe("Unova|Route 1");
  });

  it("handles the data's naming differences", () => {
    expect(at("East Province Area Three", "scarlet")).toBe("Paldea|East Province (Area Three)");
    expect(at("Sea Route 41", "heartgold")).toBe("Johto|Route 41");
    expect(at("Wild Zone 15", "legends-za")).toBe("Kalos|Lumiose City");
    expect(at("Kitakami Hall", "scarlet")).toBe("Kitakami|Mossui Town");
  });

  it("leaves out what isn't on the map instead of guessing", () => {
    expect(at("Obsidian Fieldlands", "legends-arceus")).toBeNull();
    expect(at("Victory Road", "black")).toBeNull();
    expect(at("Route 22", "x")).toBe(pinned.has("Kalos|Route 22") ? "Kalos|Route 22" : null);
  });

  it("classifies methods by the rules table", () => {
    expect(classifyMethod("Super Rod", ["red"])).toEqual({ kind: "counted", label: "Super Rod" });
    expect(classifyMethod("Tera Raid", ["scarlet"]).kind).toBe("excluded");
    expect(classifyMethod("Max Raid", ["scarlet"]).kind).toBe("unknown");
    expect(classifyMethod("Something new", ["red"]).kind).toBe("unknown");
  });

  it("is deterministic, and the committed table is exactly what the build makes", { timeout: 120_000 }, () => {
    const inputs = loadInputs();
    const a = buildAnswers(inputs);
    // Shuffled input order gives the same table.
    const shuffled = { ...inputs, pokedex: [...inputs.pokedex].reverse(), geo: { ...inputs.geo, world: { ...inputs.geo.world, locations: [...inputs.geo.world.locations].reverse() } } };
    const b = buildAnswers(shuffled, { difficulty: false });
    const strip = (es: HuntEntry[]) => es.map(({ difficulty: _d, regionDifficulty: _r, everywhere: _e, ...rest }) => rest);
    expect(strip(b.entries)).toEqual(strip(a.entries));
    expect(JSON.parse(JSON.stringify(a.entries))).toEqual(entries);
  });

  it("only lists entries whose every place is on the map (nothing uncertain is in the table)", { timeout: 120_000 }, () => {
    const out = buildAnswers(loadInputs(), { difficulty: false });
    const left = new Set(out.review.map((r) => r.id));
    for (const e of entries) expect(left.has(e.id), e.id).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), "src/data/hunt/review.json"))).toBe(true);
  });
});
