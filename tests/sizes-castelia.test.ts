import { describe, expect, it } from "vitest";
import { SIZE_ITEMS, SIZE_BY_KEY } from "@/lib/sizes/data";
import { PRESETS, compareLineup, presetLineup } from "@/lib/sizes/presets";
import { layoutLine, type SizeItem } from "@/lib/sizes/types";
import { planWorld, type WorldPlan } from "@/lib/sizes/world";
import { ringRuleFor } from "@/lib/sizes/order";
import { CASTELIA_STREET, planCastelia, rectDistance, type Tower } from "@/lib/sizes/castelia";
import { CITIES, DEFAULT_CITY, cityFromUrl, parseCity, withCity } from "@/lib/sizes/city";

const plans = (): [string, WorldPlan][] => {
  const lines: [string, SizeItem[]][] = PRESETS.map((p) => [p.id, presetLineup(p, SIZE_ITEMS)]);
  const pick = (...keys: string[]) => keys.map((k) => SIZE_BY_KEY.get(k)!).filter(Boolean);
  lines.push(["compare", compareLineup(pick("wailord", "eternatus"), SIZE_ITEMS)]);
  lines.push(["compare-small", compareLineup(pick("pikachu", "joltik"), SIZE_ITEMS)]);
  const out: [string, WorldPlan][] = lines.map(([id, line]) => [id, planWorld(layoutLine(line))]);
  // A line in a stat order: a giant may stand on the straight, with the camera's side opened up.
  const tallFirst = { by: "height", dir: "desc" } as const;
  out.push(["tall-first", planWorld(layoutLine(presetLineup(PRESETS[0], SIZE_ITEMS, tallFirst)), ringRuleFor(tallFirst))]);
  return out;
};

/** Distance from a point to a tower's (turned) footprint, 0 inside. */
function towerDistance(t: Tower, x: number, z: number): number {
  const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
  const dx = x - t.x, dz = z - t.z;
  // Into the tower's own frame (inverse of the footprint's turn).
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  if (t.round) return Math.max(0, Math.hypot(lx, lz) - Math.min(t.w, t.d) / 2);
  return rectDistance({ x0: -t.w / 2, x1: t.w / 2, z0: -t.d / 2, z1: t.d / 2 }, lx, lz);
}

/** A tower's footprint corners (a round one's bounding square). */
function corners(t: Tower): [number, number][] {
  const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
  const hw = t.round ? Math.min(t.w, t.d) / 2 : t.w / 2, hd = t.round ? Math.min(t.w, t.d) / 2 : t.d / 2;
  return [[-hw, -hd], [-hw, hd], [hw, hd], [hw, -hd]].map(([lx, lz]) => [t.x + lx * cs + lz * sn, t.z - lx * sn + lz * cs]);
}

describe("the city in the address", () => {
  it("reads ?city=castelia and treats anything else as Lumiose", () => {
    expect(DEFAULT_CITY).toBe("lumiose");
    expect(CITIES).toEqual(["lumiose", "castelia"]);
    expect(parseCity("castelia")).toBe("castelia");
    expect(parseCity(" Castelia ")).toBe("castelia");
    expect(parseCity(["castelia", "lumiose"])).toBe("castelia");
    expect(parseCity("nimbasa")).toBe("lumiose");
    expect(parseCity(null)).toBe("lumiose");
    expect(cityFromUrl("https://playpokeiq.com/pokedex/sizes/compare?vs=wailord,eternatus&city=castelia")).toBe("castelia");
    expect(cityFromUrl("/ja/pokedex/sizes?city=castelia")).toBe("castelia");
    expect(cityFromUrl("/pokedex/sizes")).toBe("lumiose");
  });

  it("sets the city on a path, keeping the rest of its query and its hash", () => {
    expect(withCity("/pokedex/sizes", "castelia")).toBe("/pokedex/sizes?city=castelia");
    expect(withCity("/pokedex/sizes?by=speed&dir=desc", "castelia")).toBe("/pokedex/sizes?by=speed&dir=desc&city=castelia");
    expect(withCity("/pokedex/sizes/compare?vs=a,b&city=castelia", "castelia")).toBe("/pokedex/sizes/compare?vs=a,b&city=castelia");
    expect(withCity("/pokedex/sizes/compare?city=castelia&vs=a,b", "lumiose")).toBe("/pokedex/sizes/compare?vs=a,b");
    expect(withCity("/pokedex/sizes?city=castelia", "lumiose")).toBe("/pokedex/sizes");
    expect(withCity("/pokedex/sizes?q=draft#x", "castelia")).toBe("/pokedex/sizes?q=draft&city=castelia#x");
    // Round trip.
    for (const c of CITIES) expect(cityFromUrl(withCity("/pokedex/sizes/pikachu?by=weight", c))).toBe(c);
  });
});

describe("Castelia's layout", () => {
  const all = plans();

  it("keeps the main street, the line and the camera's ground clear of towers", () => {
    for (const [id, plan] of all) {
      const cp = planCastelia(plan);
      expect(cp.towers.length, id).toBeGreaterThan(150);
      for (const t of cp.towers) {
        // The main street's canyon: towers stand behind its facades, up to the plaza.
        for (let x = plan.x0; x < plan.x1 - 40; x += 20) expect(towerDistance(t, x, 0), `${id}: tower on the main street at x=${x}`).toBeGreaterThan(CASTELIA_STREET.facade - 1);
        // Every figure's spot on the line is clear (with room round it).
        for (let s = plan.lineStart; s <= plan.lineEnd; s += 8) {
          const p = plan.path.at(s);
          expect(towerDistance(t, p.x, p.z), `${id}: tower on the line at s=${s.toFixed(0)}`).toBeGreaterThan(12);
        }
        // Central Plaza: between the towers round the fountain and those round the edge, open paving (where the camera stands).
        const d = Math.hypot(t.x - cp.centre.x, t.z - cp.centre.z);
        const near = towerDistance(t, cp.centre.x, cp.centre.z), far = Math.max(...corners(t).map(([x, z]) => Math.hypot(x - cp.centre.x, z - cp.centre.z)));
        void d;
        const inside = far <= cp.inner.r1 + 4, outside = near >= cp.edge - 4;
        expect(inside || outside, `${id}: tower in the plaza at ${d.toFixed(0)} m from the centre`).toBe(true);
        if (inside) expect(near, `${id}: tower on the fountain's plaza`).toBeGreaterThanOrEqual(cp.centre.r);
      }
    }
  });

  it("stands every tower on land, and the piers, the island and the bridge out on the water", () => {
    for (const [id, plan] of all) {
      const cp = planCastelia(plan);
      const L = cp.land;
      for (const t of cp.towers) {
        expect(t.x - t.w / 2 >= L.x0 && t.z - t.d / 2 >= L.z0 && t.z + t.d / 2 <= L.z1, `${id}: tower in the water`).toBe(true);
        expect(t.h, id).toBeGreaterThan(8);
        expect(t.h, id).toBeLessThan(460);
      }
      expect(cp.piers).toHaveLength(5);
      for (const p of cp.piers) {
        const endZ = p.z + Math.sin(p.dir) * p.len;
        expect(endZ, id).toBeGreaterThan(L.z1 + 100);
      }
      expect(rectDistance(L, cp.island.x, cp.island.z), id).toBeGreaterThan(cp.island.r + 200);
      expect(rectDistance(L, cp.bridge.x1, cp.bridge.z1), id).toBeGreaterThan(1000);
      expect(Math.hypot(cp.bridge.x1 - cp.bridge.x0, cp.bridge.z1 - cp.bridge.z0), id).toBeGreaterThan(1500);
    }
  });

  it("opens the camera's side when a giant stands on the straight", () => {
    const [, plan] = all.find(([id]) => id === "tall-first")!;
    expect(plan.open).toBeGreaterThan(0);
    const cp = planCastelia(plan);
    for (const t of cp.towers) {
      if (t.x > plan.x1 - 40 || t.role === "plaza" || t.role === "inner") continue;
      expect(t.z + t.d / 2 < -plan.open || t.z - t.d / 2 > 0, "tower on the open side").toBe(true);
    }
  });

  it("is the same city every time, and lighter qualities only thin the far blocks", () => {
    const [, plan] = all[0];
    const a = planCastelia(plan), b = planCastelia(plan);
    expect(b.towers).toEqual(a.towers);
    const light = planCastelia(plan, 0.45);
    expect(light.towers.length).toBeLessThan(a.towers.length);
    const key = (t: Tower) => `${t.x.toFixed(2)},${t.z.toFixed(2)}`;
    const kept = new Set(light.towers.map(key));
    for (const t of a.towers.filter((x) => x.role !== "block")) expect(kept.has(key(t)), `${t.role} tower thinned`).toBe(true);
  });

  it("rises from the waterfront to the plaza, with the tallest round the fountain", () => {
    const [, plan] = all[0];
    const cp = planCastelia(plan);
    const walls = cp.towers.filter((t) => t.role === "far" || t.role === "near");
    const nearWater = walls.filter((t) => t.x < plan.x0 + 500), nearPlaza = walls.filter((t) => t.x > plan.x1 - 500 && t.x < plan.x1);
    const mean = (ts: Tower[]) => ts.reduce((s, t) => s + t.h, 0) / ts.length;
    expect(nearWater.length).toBeGreaterThan(4);
    expect(nearPlaza.length).toBeGreaterThan(4);
    expect(mean(nearPlaza)).toBeGreaterThan(mean(nearWater) * 1.5);
    const inner = cp.towers.filter((t) => t.role === "inner");
    expect(inner.length).toBeGreaterThan(3);
    expect(Math.max(...inner.map((t) => t.h))).toBeGreaterThan(200);
  });
});
