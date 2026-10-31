import { describe, expect, it } from "vitest";
import geo from "@/data/geo.json";
import spots2d from "@/data/geo-shot-spots.json";
import { FLOOR_RIP, isFloorRip, loadAudit, loadPlaceRules, spotRuleViolation } from "../scripts/geo/spot-rules";

/**
 * PokéGuessr exact spots: a spot is scored only where a player can aim at it
 * on our world map (scripts/geo/spot-rules.ts). These fail if any scored spot
 * sits in a place our map draws as a block or an icon (a town, cave, forest,
 * tower, building or interior), on one floor of a place, or anywhere a spot
 * was taken out by hand, so a rerun of the pipeline can't quietly score them again.
 */

type Row = [number, number, number, string, boolean];
const ROWS = spots2d as unknown as Record<string, Row>;
const world = (geo as unknown as { world: { locations: { name: string; region: string; parent?: string; pin?: [number, number]; mask?: [number, number][]; shots: { id: string; family: string }[] }[] } }).world;
const placeOf = new Map(world.locations.flatMap((l) => l.shots.map((s) => [s.id, l] as const)));
const places = loadPlaceRules();
const audit = loadAudit();
const scored = Object.entries(ROWS).filter(([, r]) => r[4]);
const SPRITE = new Set(["rby", "gsc", "rse", "frlg", "dppt", "hgss", "bw"]);

describe("which places can hold a scored spot", () => {
  it("every pinned place with sprite-game shots has a decision made on the atlas", () => {
    const missing = world.locations.filter((l) => l.pin && l.mask && !l.parent && l.shots.some((s) => SPRITE.has(s.family)) && !places[`${l.region}|${l.name}`]).map((l) => `${l.region}|${l.name}`);
    expect(missing).toEqual([]);
    for (const [k, p] of Object.entries(places)) {
      expect(typeof p.drawn, k).toBe("boolean");
      expect(p.why.length, k).toBeGreaterThan(5);
      expect(p.drawn ? ["path", "sea", "island", "lake"] : ["town", "icon", "undrawn"], k).toContain(p.kind);
    }
  });

  it("towns, caves, forests, towers and buildings are never drawn as walkable", () => {
    const iconish = /\b(City|Town|Village)$|\b(Cave|Caves|Cavern|Forest|Woods|Tunnel|Tower|Hideout|Well|Den|Chamber|Mansion|Ship|Temple|Plant|Lab|Laboratory|Warehouse|Mine|Ruins|Castle|Sewers|Lighthouse)\b|^Mt\. /;
    const wrong = Object.entries(places).filter(([k, p]) => p.drawn && iconish.test(k.split("|")[1])).map(([k]) => k);
    expect(wrong).toEqual([]);
  });

  it("knows a floor map from a whole-area map", () => {
    for (const f of ["Union_Cave_B1F_HGSS.png", "Bell_Tower_10F_HGSS.png", "Abandoned_Ship_UF_RSE.png", "Clay_Tunnel_second_room_B2W2.png", "Ruins_of_Alph_Interior_HGSS.png", "Mt_Mortar_Basement_GS.png"]) expect(isFloorRip(`archives.bulbagarden.net|${f}`), f).toBe(true);
    for (const f of ["Unova_Route_4_B2.png", "Kanto_Route_2_HGSS.png", "Village_Bridge_Spring_B2W2.png", "Johto_Route_42_GSC.png", "Sinnoh_Route_210_Pt.png"]) expect(FLOOR_RIP.test(f.replace(/\.png$/, "")), f).toBe(false);
  });
});

describe("every scored spot passes the rules", () => {
  it("is in a place our map draws with its layout", () => {
    const bad = scored
      .map(([id]) => {
        const l = placeOf.get(id)!;
        if (l.parent) return `${id}: inside ${l.name}`;
        const p = places[`${l.region}|${l.name}`];
        return p?.drawn ? null : `${id}: ${l.region}|${l.name} (${p?.kind ?? "no decision"})`;
      })
      .filter(Boolean);
    expect(bad).toEqual([]);
  });

  it("was never taken out by hand, and isn't on a floor map", () => {
    const bad = scored.filter(([id]) => audit[id]?.verdict === "unscored" || (audit[id]?.verdict === "ok" && isFloorRip((audit[id] as { rip: string }).rip))).map(([id]) => id);
    expect(bad).toEqual([]);
  });

  it("every spot taken out by hand is a known shot, with its reason", () => {
    for (const [id, a] of Object.entries(audit)) {
      expect(placeOf.has(id), id).toBe(true);
      if (a.verdict === "unscored") expect(a.reason.length, id).toBeGreaterThan(10);
      else expect(a.note.length, id).toBeGreaterThan(5);
    }
  });

  it("was checked by eye on our atlas at this very spot, and passes every rule", () => {
    const bad: string[] = [];
    for (const [id, row] of scored) {
      const l = placeOf.get(id)!;
      const why = spotRuleViolation(places, audit, id, l.region, l.name, [row[0], row[1]]);
      if (why) bad.push(`${id}: ${why}`);
    }
    expect(bad).toEqual([]);
  });
});
