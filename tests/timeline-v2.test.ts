import { afterEach, describe, expect, it } from "vitest";
import { TIMELINE } from "@/lib/timeline/data";
import { REGION_MAPS, T_START, dateRows, firstRelease, yearFrac } from "@/lib/timeline/types";
import { entryPath, isEntryId, parseDeepLink, urlFor } from "@/lib/timeline/deeplink";
import { INTRO_KEY, introSeen, markIntroSeen, resetIntroMemory, shouldPlayIntro } from "@/lib/timeline/intro";
import { TOUR_STOP_IDS, buildTour, pickTourStops, tourAt } from "@/lib/timeline/tour";
import { existsSync } from "node:fs";
import { join } from "node:path";

const IDS = new Set(TIMELINE.map((e) => e.id));
const known = (id: string) => IDS.has(id);

describe("timeline deep links", () => {
  it("reads an entry's own path", () => {
    expect(parseDeepLink({ pathname: "/pokedex/timeline/pokemon-go" }, known)).toBe("pokemon-go");
    expect(parseDeepLink({ pathname: "/pokedex/timeline/pokemon-go/" }, known)).toBe("pokemon-go");
  });
  it("reads the older ?e= and #id forms", () => {
    expect(parseDeepLink({ pathname: "/pokedex/timeline", search: "?e=gold-silver" }, known)).toBe("gold-silver");
    expect(parseDeepLink({ pathname: "/pokedex/timeline", hash: "#red-green" }, known)).toBe("red-green");
    expect(parseDeepLink({ pathname: "/pokedex/timeline", search: "?view=3d&e=x-y" }, known)).toBe("x-y");
  });
  it("prefers the path, then ?e=, then the hash", () => {
    expect(parseDeepLink({ pathname: "/pokedex/timeline/x-y", search: "?e=gold-silver", hash: "#red-green" }, known)).toBe("x-y");
    expect(parseDeepLink({ pathname: "/pokedex/timeline", search: "?e=gold-silver", hash: "#red-green" }, known)).toBe("gold-silver");
  });
  it("falls through to the next form when one is unknown", () => {
    expect(parseDeepLink({ pathname: "/pokedex/timeline", search: "?e=nope", hash: "#red-green" }, known)).toBe("red-green");
  });
  it("ignores unknown, malformed and reserved ids, and other paths", () => {
    expect(parseDeepLink({ pathname: "/pokedex/timeline/not-an-entry" }, known)).toBeNull();
    expect(parseDeepLink({ pathname: "/pokedex/timeline/species" }, () => true)).toBeNull();
    expect(parseDeepLink({ pathname: "/pokedex/timeline/species/1" }, () => true)).toBeNull();
    expect(parseDeepLink({ pathname: "/pokedex/timeline", hash: "#<script>" }, () => true)).toBeNull();
    expect(parseDeepLink({ pathname: "/pokedex/timeline", hash: "#%E0%A4%A" }, known)).toBeNull();
    expect(parseDeepLink({ pathname: "/pokedex/places/kanto" }, () => true)).toBeNull();
    expect(parseDeepLink({ pathname: "/pokedex/timeline" }, known)).toBeNull();
  });
  it("is case-insensitive on the id", () => {
    expect(parseDeepLink({ pathname: "/pokedex/timeline", hash: "#Pokemon-GO" }, known)).toBe("pokemon-go");
  });
  it("gives every entry a valid, round-tripping path", () => {
    for (const e of TIMELINE) {
      expect(isEntryId(e.id), e.id).toBe(true);
      expect(parseDeepLink({ pathname: entryPath(e.id) }, known)).toBe(e.id);
    }
  });
  it("builds the address bar for an open entry, keeping other params", () => {
    expect(urlFor("pokemon-go")).toBe("/pokedex/timeline/pokemon-go");
    expect(urlFor(null)).toBe("/pokedex/timeline");
    expect(urlFor("x-y", "?view=3d&e=red-green")).toBe("/pokedex/timeline/x-y?view=3d");
    expect(urlFor(null, "?e=red-green")).toBe("/pokedex/timeline");
  });
});

describe("timeline tour", () => {
  const stops = pickTourStops(TIMELINE);
  const plan = buildTour(stops, { from: T_START });

  it("stops at every key moment that exists, in time order", () => {
    expect(stops.length).toBe(TOUR_STOP_IDS.length);
    for (let i = 1; i < stops.length; i++) expect(stops[i].t).toBeGreaterThanOrEqual(stops[i - 1].t);
    // Every generation's opener is a stop.
    for (const e of TIMELINE.filter((x) => x.introduces)) expect(stops.map((s) => s.id)).toContain(e.id);
  });
  it("lasts 60 to 90 seconds", () => {
    expect(plan.total).toBeGreaterThanOrEqual(60);
    expect(plan.total).toBeLessThanOrEqual(90);
  });
  it("alternates glide and hold, holding on each stop", () => {
    expect(plan.segments.length).toBe(stops.length * 2);
    plan.segments.forEach((s, i) => {
      expect(s.kind).toBe(i % 2 ? "hold" : "glide");
      expect(s.dur).toBeGreaterThan(0);
      if (s.kind === "hold") {
        expect(s.from).toBe(s.to);
        expect(s.id).toBe(stops[(i - 1) / 2].id);
      }
    });
  });
  it("moves forward through time, starting at the start and ending on the last stop", () => {
    expect(tourAt(plan, 0).t).toBeCloseTo(T_START, 5);
    let last = -Infinity;
    for (let s = 0; s <= plan.total; s += 0.25) {
      const st = tourAt(plan, s);
      expect(st.t).toBeGreaterThanOrEqual(last - 1e-9);
      last = st.t;
    }
    const end = tourAt(plan, plan.total + 1);
    expect(end.done).toBe(true);
    expect(end.t).toBeCloseTo(stops[stops.length - 1].t, 5);
  });
  it("reports the moment it is holding on", () => {
    const hold = plan.segments[1];
    const st = tourAt(plan, hold.start + hold.dur / 2);
    expect(st.holding).toBe(stops[0].id);
    expect(st.t).toBe(stops[0].t);
    expect(tourAt(plan, plan.segments[2].start + 0.01).holding).toBeNull();
  });
  it("skips stops on hidden tracks", () => {
    const lane = new Map(TIMELINE.map((e) => [e.id, e.lane]));
    const gamesOnly = pickTourStops(TIMELINE, (id) => lane.get(id) === "games");
    expect(gamesOnly.every((s) => lane.get(s.id) === "games")).toBe(true);
    const p = buildTour(gamesOnly, { from: T_START });
    expect(p.total).toBeGreaterThanOrEqual(60);
    expect(p.total).toBeLessThanOrEqual(90);
  });
  it("handles no stops", () => {
    const p = buildTour([], { from: T_START });
    expect(p.total).toBe(0);
    expect(tourAt(p, 3).done).toBe(true);
  });
});

describe("timeline intro", () => {
  afterEach(() => resetIntroMemory());
  const memStore = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("plays once per browser", () => {
    const store = memStore();
    expect(shouldPlayIntro({ store, reducedMotion: false, deepLink: false })).toBe(true);
    markIntroSeen(store);
    expect(store.m.get(INTRO_KEY)).toBe("1");
    resetIntroMemory();
    expect(shouldPlayIntro({ store, reducedMotion: false, deepLink: false })).toBe(false);
  });
  it("never plays under reduced motion or on an entry's own link", () => {
    expect(shouldPlayIntro({ store: memStore(), reducedMotion: true, deepLink: false })).toBe(false);
    expect(shouldPlayIntro({ store: memStore(), reducedMotion: false, deepLink: true })).toBe(false);
  });
  it("survives storage that throws: once per page instead", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(shouldPlayIntro({ store: broken, reducedMotion: false, deepLink: false })).toBe(true);
    expect(() => markIntroSeen(broken)).not.toThrow();
    expect(introSeen(broken)).toBe(true);
    expect(shouldPlayIntro({ store: broken, reducedMotion: false, deepLink: false })).toBe(false);
  });
  it("works with no storage at all", () => {
    expect(shouldPlayIntro({ store: null, reducedMotion: false, deepLink: false })).toBe(true);
    markIntroSeen(null);
    expect(shouldPlayIntro({ store: null, reducedMotion: false, deepLink: false })).toBe(false);
  });
});

describe("timeline region maps", () => {
  it("has the atlas crop for every generation's opener", () => {
    for (const e of TIMELINE.filter((x) => x.introduces)) {
      const m = REGION_MAPS[e.introduces!];
      expect(m, `gen ${e.introduces}`).toBeTruthy();
      expect(m.region).toBe(e.region);
      expect(existsSync(join(process.cwd(), "public", m.src)), m.src).toBe(true);
    }
  });
});

describe("timeline card dates", () => {
  it("show the earliest release, which is where the entry sits", () => {
    for (const e of TIMELINE) {
      const f = firstRelease(e);
      for (const r of dateRows(e)) expect(yearFrac(f.date), `${e.id}: ${r.label}`).toBeLessThanOrEqual(yearFrac(r.date));
      expect(Math.abs(yearFrac(f.date) - e.t), e.id).toBeLessThan(1e-3);
    }
  });
  it("uses another region's date when it came first", () => {
    const go = TIMELINE.find((e) => e.id === "pokemon-go")!;
    expect(firstRelease(go)).toEqual({ label: "North America", date: "2016-07-06" });
    // The panel still lists every region, Japan first.
    expect(dateRows(go).map((r) => r.label)).toEqual(["Japan", "North America"]);
  });
  it("keeps Japan on a same-day tie, and the single date of a worldwide release", () => {
    expect(firstRelease({ date_jp: "2019-11-15", date_na: "2019-11-15", date_eu: null, worldwide: false }).label).toBe("Japan");
    expect(firstRelease({ date_jp: "2019-11-15", date_na: null, date_eu: null, worldwide: true }).label).toBe("Worldwide");
  });
  it("keeps the entries in time order by that date", () => {
    for (let i = 1; i < TIMELINE.length; i++) expect(TIMELINE[i].t, TIMELINE[i].id).toBeGreaterThanOrEqual(TIMELINE[i - 1].t);
  });
});
