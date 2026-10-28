import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// PokéGuessr's screenshots only grow. Every shot in the data when the 3D-games
// additions were made (geo-shot-ids-baseline.json) and every shot in the data
// since (geo-shot-ids-protected.json: the 2,308 there were before the
// 5,000-shot expansion, and every shot added after) is still there, so
// additions never quietly replace or drop an existing shot. A shot added to
// the data is added to the protected list too.
// The one exception, by the owner's decision: the 13 Legends: Z-A shots
// (geo-shot-ids-za-removed.json), since Z-A isn't played in PokéGuessr.
// A shot may be re-cut (geo-shot-ids-replaced.json: old id → new id), as the
// 73 area maps with black around them were, by the owner's decision: the same
// picture, cropped or with the black filled, under a new id so caches move on.
const root = process.cwd();
const read = <T>(file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8")) as T;
const geo = read<{ world: { locations: { shots: { id: string; game: string; family?: string }[] }[] } }>("src/data/geo.json");
const removed = new Set(read<string[]>("tests/fixtures/geo-shot-ids-za-removed.json"));
const baseline = read<string[]>("tests/fixtures/geo-shot-ids-baseline.json").filter((id) => !removed.has(id));
const replaced = read<Record<string, string>>("tests/fixtures/geo-shot-ids-replaced.json");
const protectedIds = read<string[]>("tests/fixtures/geo-shot-ids-protected.json");
const shots = geo.world.locations.flatMap((l) => l.shots);
const ids = new Set(shots.map((s) => s.id));
/** The id a shot goes by now: itself, or its re-cut version. */
const current = (id: string) => (replaced[id] && !ids.has(id) ? replaced[id] : id);

describe("geo shots are only ever added", () => {
  it("keeps every baseline shot", () => {
    expect(baseline.filter((id) => !ids.has(current(id)))).toEqual([]);
  });
  it("keeps every protected shot", () => {
    expect(protectedIds.length).toBeGreaterThanOrEqual(2308);
    expect(new Set(protectedIds).size).toBe(protectedIds.length);
    expect(protectedIds.filter((id) => !ids.has(current(id)))).toEqual([]);
  });
  it("protects every shot in the data", () => {
    const guarded = new Set(protectedIds);
    expect([...ids].filter((id) => !guarded.has(id))).toEqual([]);
    expect(ids.size).toBe(protectedIds.length);
  });
  it("lists each shot once", () => {
    expect(shots.length).toBe(ids.size);
  });
  it("has no Legends: Z-A or Legends: Arceus shots", () => {
    expect(removed.size).toBe(13);
    expect([...removed].filter((id) => ids.has(id))).toEqual([]);
    expect(shots.filter((s) => s.family === "za" || s.family === "pla" || /Legends/.test(s.game))).toEqual([]);
  });
});
