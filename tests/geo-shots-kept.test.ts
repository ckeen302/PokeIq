import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// PokéGuessr's screenshots only grow. Every shot in the data when the 3D-games
// additions were made (geo-shot-ids-baseline.json) and every shot there was
// before the 5,000-shot expansion (geo-shot-ids-protected.json) is still
// there, so additions never quietly replace or drop an existing shot.
// The one exception, by the owner's decision: the 13 Legends: Z-A shots
// (geo-shot-ids-za-removed.json), since Z-A isn't played in PokéGuessr.
const root = process.cwd();
const read = <T>(file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8")) as T;
const geo = read<{ world: { locations: { shots: { id: string; game: string; family?: string }[] }[] } }>("src/data/geo.json");
const removed = new Set(read<string[]>("tests/fixtures/geo-shot-ids-za-removed.json"));
const baseline = read<string[]>("tests/fixtures/geo-shot-ids-baseline.json").filter((id) => !removed.has(id));
const protectedIds = read<string[]>("tests/fixtures/geo-shot-ids-protected.json");
const shots = geo.world.locations.flatMap((l) => l.shots);
const ids = new Set(shots.map((s) => s.id));

describe("geo shots are only ever added", () => {
  it("keeps every baseline shot", () => {
    expect(baseline.filter((id) => !ids.has(id))).toEqual([]);
  });
  it("keeps every shot from before the expansion", () => {
    expect(protectedIds.length).toBe(2025);
    expect(protectedIds.filter((id) => !ids.has(id))).toEqual([]);
  });
  it("has at least as many shots as before", () => {
    expect(ids.size).toBeGreaterThanOrEqual(protectedIds.length);
  });
  it("has no Legends: Z-A or Legends: Arceus shots", () => {
    expect(removed.size).toBe(13);
    expect([...removed].filter((id) => ids.has(id))).toEqual([]);
    expect(shots.filter((s) => s.family === "za" || s.family === "pla" || /Legends/.test(s.game))).toEqual([]);
  });
});
