import { afterEach, describe, expect, it } from "vitest";
import data from "@/data/geo.json";
import { GEO_MAX_VIEWS, gradeGeo, planRounds, readGeo, roundViews, setHiddenShots, startGeo, hiddenShots } from "@/lib/server/geo";
import { roundViewsOf, stepView, viewKeyStep, viewLabel } from "@/lib/geo-look";
import { WORLD_REGION, type GeoSpec } from "@/lib/geo-types";
import { allowedFamilies } from "@/lib/geo-families";

type Shot = { id: string; game: string; family: string };
type Loc = { name: string; region: string; parent?: string; shots: Shot[] };
const LOCATIONS = (data as unknown as { world: { locations: Loc[] } }).world.locations;
const placeOf = (r: { location: string; region?: string }) => LOCATIONS.find((l) => l.name === r.location && l.region === r.region)!;

describe("look around: flipping through views", () => {
  it("steps and wraps around both ends", () => {
    expect(stepView(0, 1, 3)).toBe(1);
    expect(stepView(2, 1, 3)).toBe(0);
    expect(stepView(0, -1, 3)).toBe(2);
    expect(stepView(1, -4, 3)).toBe(0);
    expect(stepView(0, 1, 1)).toBe(0);
    expect(stepView(3, 1, 0)).toBe(0);
  });

  it("maps the arrow keys (and , .) to steps and nothing else", () => {
    expect(viewKeyStep("ArrowLeft")).toBe(-1);
    expect(viewKeyStep("ArrowRight")).toBe(1);
    expect(viewKeyStep(",")).toBe(-1);
    expect(viewKeyStep(".")).toBe(1);
    for (const key of [" ", "Enter", "Escape", "a", "ArrowUp"]) expect(viewKeyStep(key)).toBeNull();
  });

  it("falls back to the dealt shot when a round has no other views", () => {
    expect(roundViewsOf({ shot: "/a" })).toEqual(["/a"]);
    expect(roundViewsOf({ shot: "/a", views: [] })).toEqual(["/a"]);
    expect(roundViewsOf({ shot: "/a", views: ["/a", "/b"] })).toEqual(["/a", "/b"]);
    expect(viewLabel(1, 4)).toBe("View 2 of 4");
  });
});

describe("look around: a round's views", () => {
  afterEach(() => setHiddenShots([]));
  const world: GeoSpec = { region: WORLD_REGION, kind: "game" };
  const rounds = Array.from({ length: 30 }, (_, i) => planRounds(world, `look-${i}`)).flat();

  it("starts with the dealt shot and shows only that place's shots, each once", () => {
    for (const round of rounds) {
      const views = roundViews(world, round);
      const place = placeOf(round);
      expect(views[0]).toBe(round.shot);
      expect(new Set(views).size).toBe(views.length);
      for (const id of views) expect(place.shots.some((s) => s.id === id)).toBe(true);
      // Retired shots (src/data/geo-retired.json) are never shown as a view.
      expect(views.length).toBe(Math.min(place.shots.filter((s) => !hiddenShots().has(s.id)).length, GEO_MAX_VIEWS));
    }
  });

  it("keeps to the game filter's families", () => {
    const spec: GeoSpec = { region: WORLD_REGION, kind: "game", era: "3d" };
    const allowed = allowedFamilies(spec);
    for (let i = 0; i < 20; i++) {
      for (const round of planRounds(spec, `look-3d-${i}`)) {
        const place = placeOf(round);
        for (const id of roundViews(spec, round)) expect(allowed.has(place.shots.find((s) => s.id === id)!.family as never)).toBe(true);
      }
    }
  });

  it("with 'guess the game too', shows only the dealt shot's family", () => {
    const spec: GeoSpec = { ...world, guessGame: true };
    let mixed = 0;
    for (const round of rounds) {
      const place = placeOf(round);
      const family = place.shots.find((s) => s.id === round.shot)!.family;
      if (new Set(place.shots.map((s) => s.family)).size > 1) mixed++;
      for (const id of roundViews(spec, round)) expect(place.shots.find((s) => s.id === id)!.family).toBe(family);
    }
    expect(mixed).toBeGreaterThan(0);
  });

  it("leaves out hidden shots, but never the dealt one", () => {
    const round = rounds.find((r) => placeOf(r).shots.length >= 3)!;
    const hidden = placeOf(round).shots.map((s) => s.id).filter((id) => id !== round.shot);
    setHiddenShots(hidden);
    expect(roundViews(world, round)).toEqual([round.shot]);
  });

  it("sends exactly one screenshot per round, from the start to the last guess", () => {
    for (let g = 0; g < 10; g++) {
      const start = startGeo(world, { seed: `look-start-${g}` });
      let round = start.round;
      let token = start.token;
      for (;;) {
        expect(round.views).toBeUndefined();
        expect(round.shot).toMatch(/^\/api\/geo\/shot\/[A-Za-z0-9_-]+$/);
        const graded = gradeGeo(readGeo(token)!, { x: 0.5, y: 0.5 });
        if (!graded.ok || graded.body.done) break;
        token = graded.body.token;
        round = graded.body.next!;
      }
    }
  });
});
