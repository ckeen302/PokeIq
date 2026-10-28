import { describe, expect, it } from "vitest";
import retired from "../src/data/geo-retired.json";
import geo from "../src/data/geo.json";
import { hiddenShots, setHiddenShots } from "@/lib/server/geo";

describe("retired PokéGuessr shots (src/data/geo-retired.json)", () => {
  const all = new Set(geo.world.locations.flatMap((l) => l.shots.map((s) => (typeof s === "string" ? s : (s as { id: string }).id))));
  it("names real shots, which stay in the data but are never dealt", () => {
    expect(retired.length).toBeGreaterThan(0);
    for (const id of retired) expect(all.has(id), id).toBe(true);
    for (const id of retired) expect(hiddenShots().has(id), id).toBe(true);
  });
  it("stays hidden when players' reports are refreshed", () => {
    setHiddenShots(["not-a-retired-shot"]);
    for (const id of retired) expect(hiddenShots().has(id), id).toBe(true);
    expect(hiddenShots().has("not-a-retired-shot")).toBe(true);
    setHiddenShots([]);
  });
});
