import { describe, expect, it } from "vitest";
import { GEO_PREVIEW_RE, answerFor, geoRegions, gradeGeo, planRounds, previewShot, previewToken, previewUrl, readGeo, startGeo } from "@/lib/server/geo";
import { PLACES } from "@/lib/dex/places-data";
import geo from "@/data/geo.json";
import { WORLD_REGION, type GeoSpec } from "@/lib/geo-types";

/**
 * The answer leak: a round's image id must never be matched to a place
 * through anything public (the Atlas, the map picker, the round payload…).
 */

const IDS: string[] = (geo as unknown as { world: { locations: { shots: { id: string }[] }[] } }).world.locations.flatMap((l) => l.shots.map((s) => s.id));
const ID_RE = /\/api\/geo\/shot\/([A-Za-z0-9_-]+)/g;
const idsIn = (s: string) => [...s.matchAll(ID_RE)].map((m) => m[1]);
/** The shot ids a string mentions anywhere (not only in a shot URL). */
const mentions = (s: string) => IDS.filter((id) => s.includes(id));

const kanto: GeoSpec = { region: "kanto", kind: "game" };

describe("PokéGuessr answer leak", () => {
  it("has thousands of screenshots to protect", () => {
    expect(IDS.length).toBeGreaterThan(3000);
    expect(new Set(IDS).size).toBe(IDS.length);
  });

  it("preview names never equal a shot id, round-trip server-side, and an id isn't a preview name", () => {
    const names = new Set<string>();
    for (const id of IDS) {
      const name = previewToken(id);
      expect(name).not.toBe(id);
      expect(GEO_PREVIEW_RE.test(name)).toBe(true);
      expect(previewShot(name)).toBe(id);
      names.add(name);
    }
    expect(names.size).toBe(IDS.length);
    for (const id of IDS) expect(previewShot(id)).toBeNull();
    expect(previewShot("")).toBeNull();
    expect(previewShot("../x")).toBeNull();
    // The how-to demo's fixed name stands for a real screenshot, without giving its id away.
    expect(IDS).toContain(previewShot("demo"));
    expect(previewUrl(IDS[0])).toMatch(/^\/api\/geo\/preview\/[A-Za-z0-9_-]{16}$/);
  });

  it("the map picker's previews (the /guessr page payload) carry preview names, never shot ids", () => {
    const regions = geoRegions();
    const payload = JSON.stringify(regions);
    expect(idsIn(payload)).toEqual([]);
    expect(mentions(payload)).toEqual([]);
    for (const r of regions) if (r.preview) expect(r.preview).toMatch(/^\/api\/geo\/preview\//);
    expect(regions.filter((r) => r.preview).length).toBeGreaterThan(5);
  });

  it("the Atlas place pages show previews, and their data holds no shot id", () => {
    const withShot = PLACES.filter((p) => p.shot);
    expect(withShot.length).toBeGreaterThan(500);
    for (const p of withShot) expect(p.shot!.preview).toMatch(/^\/api\/geo\/preview\//);
    const data = JSON.stringify(PLACES);
    expect(idsIn(data)).toEqual([]);
    expect(mentions(data)).toEqual([]);
  });

  it("a round's payload names its image only: no place, pin, area or region", () => {
    for (const spec of [kanto, { region: WORLD_REGION, kind: "game" } as GeoSpec, { region: WORLD_REGION, kind: "streak" } as GeoSpec]) {
      const start = startGeo(spec);
      // The blurred placeholder is the picture itself, a few pixels wide (random base64, so it's left out of the text check).
      const { blur, ...rest } = start.round;
      expect(blur).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]{20,300}$/);
      const round = JSON.stringify(rest);
      // The next round's picture URL may come along (to fetch ahead): a random id, nothing else.
      expect(Object.keys(start.round).sort()).toEqual(["blur", "index", "preload", "shot"]);
      expect(start.round.preload).toMatch(/^\/api\/geo\/shot\/[A-Za-z0-9_-]{8,24}$/);
      expect(start.round.preload).not.toBe(start.round.shot);
      expect(round).not.toMatch(/pin|mask|name|region|Route|City|Town/);
      // Not with a round timer, where it could be studied while the clock runs.
      expect(startGeo(spec, { timer: 30 }).round.preload).toBeUndefined();
      const state = readGeo(start.token)!;
      const answer = answerFor(spec, planRounds(spec, state.seed, 1)[0]);
      // The token is signed, and the plan inside it is sealed: no place name anywhere in it.
      expect(start.token).not.toContain(answer.name);
      expect(start.token).not.toContain(answer.region ?? "\u0000");
      // The next round, when it arrives with a reveal, is the same shape.
      const out = gradeGeo(state, { x: 0.5, y: 0.5 });
      if (!out.ok) throw new Error(out.error);
      if (out.body.next) expect(Object.keys(out.body.next).sort()).toEqual(["blur", "index", "preload", "shot"]);
    }
  });

  it("a shot id a round uses never appears under a preview name on any public surface", () => {
    const start = startGeo(kanto);
    const [id] = idsIn(start.round.shot);
    expect(IDS).toContain(id);
    const everywhere = JSON.stringify(geoRegions()) + JSON.stringify(PLACES);
    expect(everywhere).not.toContain(id);
  });
});
