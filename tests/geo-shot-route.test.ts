import { describe, expect, it } from "vitest";
import data from "@/data/geo.json";
import blur from "@/data/geo-shot-blur.json";
import { GEO_SHOT_ROUTE_ID_RE, GEO_STORAGE_BASE } from "@/lib/geo-storage";
import { shotBlur } from "@/lib/server/geo-blur";

describe("PokéGuessr screenshot serving", () => {
  it("the screenshot route reads the same bucket as the game data", () => {
    expect((data as { storageBase?: string }).storageBase).toBe(GEO_STORAGE_BASE);
  });

  it("every screenshot id fits the route", () => {
    const ids = (data as { world: { locations: { shots: { id: string }[] }[] } }).world.locations.flatMap((l) => l.shots.map((s) => s.id));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(GEO_SHOT_ROUTE_ID_RE.test(id)).toBe(true);
  });

  it("placeholders are tiny WebP data URIs", () => {
    const [id] = Object.keys(blur);
    const uri = shotBlur(id)!;
    expect(uri.startsWith("data:image/webp;base64,")).toBe(true);
    expect(uri.length).toBeLessThan(400);
    expect(shotBlur("not-a-shot")).toBeUndefined();
  });
});
