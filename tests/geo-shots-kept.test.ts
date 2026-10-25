import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// PokéGuessr's screenshots only grow: every shot that was in the data when the
// 3D-games additions were made (tests/fixtures/geo-shot-ids-baseline.json) is
// still there, so additions never quietly replace or drop an existing shot.
const root = process.cwd();
const geo = JSON.parse(readFileSync(path.join(root, "src/data/geo.json"), "utf8")) as {
  world: { locations: { shots: { id: string }[] }[] };
};
const baseline = JSON.parse(readFileSync(path.join(root, "tests/fixtures/geo-shot-ids-baseline.json"), "utf8")) as string[];
const ids = new Set(geo.world.locations.flatMap((l) => l.shots.map((s) => s.id)));

describe("geo shots are only ever added", () => {
  it("keeps every baseline shot", () => {
    expect(baseline.filter((id) => !ids.has(id))).toEqual([]);
  });
  it("has at least as many shots as the baseline", () => {
    expect(ids.size).toBeGreaterThanOrEqual(baseline.length);
  });
});
