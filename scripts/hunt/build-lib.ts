/**
 * Builds the Pokémon Hunt answer table from the encounter data and the map.
 * Pure: takes the loaded inputs, returns the table and the review list, so the
 * tests can run it and check it's deterministic. The CLI is scripts/hunt/build.ts.
 */
import { HUNT_MAP_REGIONS, HUNT_REGIONS, HUNT_REGION_OF_GEO, huntPinsFor, type HuntEntry, type HuntMapRegionId, type HuntMethod, type HuntPlace, type HuntRegionId } from "../../src/lib/hunt/types";
import { VERSION_BY_KEY, versionOrder } from "../../src/lib/pokemon/encounter-types";
import { buildGrid, goodShare, round3, worldDifficulty, type MapGrid, type Pt } from "./difficulty";
import { FAMOUS } from "./famous";
import { PLACE_DEPENDENT_FORMS, regionalForms, resolveForms, type EvidenceEntry, type FormInfo } from "./forms";
import { VERSION_REGIONS } from "./rules";
import { buildPlaceIndex, classifyMethod, isOffMap, matchPlace, placeKey, type GeoPlace, type PinnedPlace, type PlaceIndex } from "./match";

export interface EncRow {
  v: string[];
  loc?: string;
  a?: string;
  m?: string;
  n?: string;
  x?: string;
}
export interface Inputs {
  geo: { world: { map: { width: number; height: number; squarePx: number }; crops: Record<string, { regions: string[]; box: [number, number, number, number] }>; locations: GeoPlace[] } };
  pokedex: { id: number; slug: string; name: string }[];
  aboutForms: [number, number, string, string, string][];
  /** dex → its encounter generations. */
  encounters: Map<number, { g: number; rows: EncRow[] }[]>;
  /** dex → Bulbapedia's location lines (only needed for species with regional forms). */
  evidence: Record<string, EvidenceEntry[]>;
}

/** Something the build couldn't place with certainty; the entry it belongs to is left out. */
export interface ReviewItem {
  id: string;
  name: string;
  version?: string;
  loc?: string;
  method?: string;
  why: string;
}

export interface BuildResult {
  entries: HuntEntry[];
  review: ReviewItem[];
  /** Real places missing from the map, with the entries each one keeps out. */
  missingPlaces: { place: string; versions: string[]; entries: string[] }[];
  stats: Record<string, number>;
}

/** Everywhere: in this many regions or more, and easy on the world map. */
export const EVERYWHERE_REGIONS = 4;
export const EVERYWHERE_DIFFICULTY = 0.91;
/** In this many regions it's everywhere whatever the measure says (three pins find three of them). */
export const EVERYWHERE_ALWAYS = 6;

const regionOrder = (r: HuntRegionId) => HUNT_REGIONS.indexOf(r);
const entryId = (dex: number, form: string | null) => (form ? `${dex}-${form}` : String(dex));

interface Acc {
  dex: number;
  form: string | null;
  places: Map<string, Map<string, Set<string>>>;
  uncertain: ReviewItem[];
}

export function buildAnswers(inp: Inputs): BuildResult {
  const idx = buildPlaceIndex(inp.geo.world.locations);
  const formsBy = regionalForms(inp.aboutForms);
  const dexBy = new Map(inp.pokedex.map((p) => [p.id, p]));
  const accs = new Map<string, Acc>();
  const review: ReviewItem[] = [];
  const missing = new Map<string, { versions: Set<string>; entries: Set<string> }>();
  const stats: Record<string, number> = { rows: 0, counted: 0, excludedMethod: 0, offMap: 0, excludedGame: 0 };

  const nameOf = (dex: number, form: string | null) => (form ? formsBy.get(dex)!.find((f) => f.key === form)!.name : dexBy.get(dex)!.name);
  const acc = (dex: number, form: string | null): Acc => {
    const id = entryId(dex, form);
    let a = accs.get(id);
    if (!a) accs.set(id, (a = { dex, form, places: new Map(), uncertain: [] }));
    return a;
  };

  for (const mon of [...inp.pokedex].sort((a, b) => a.id - b.id)) {
    const dex = mon.id;
    const forms: FormInfo[] | undefined = formsBy.get(dex);
    const allForms: (string | null)[] = [null, ...(forms ?? []).map((f) => f.key)];
    if (PLACE_DEPENDENT_FORMS[dex]) {
      review.push({ id: String(dex), name: mon.name, why: PLACE_DEPENDENT_FORMS[dex] });
      continue;
    }
    for (const g of inp.encounters.get(dex) ?? []) {
      for (const r of g.rows) {
        if (!r.loc) continue;
        for (const v of r.v) {
          stats.rows++;
          if (!VERSION_BY_KEY[v]) {
            for (const f of allForms) acc(dex, f).uncertain.push({ id: entryId(dex, f), name: nameOf(dex, f), version: v, loc: r.loc, method: r.m, why: `unknown version ${v}` });
            continue;
          }
          if (v === "legends-arceus") {
            stats.excludedGame++;
            continue;
          }
          const mc = classifyMethod(r.m, [v]);
          if (mc.kind === "excluded") {
            stats.excludedMethod++;
            continue;
          }
          if (isOffMap(r.loc)) {
            stats.offMap++;
            continue;
          }
          const pm = matchPlace(idx, r.loc, v);
          const names = [r.loc, ...(pm.kind === "place" ? [idx.pinned.get(pm.key)!.name] : [])];
          const fr = resolveForms({ dex, version: v, note: r.n, names, forms, evidence: inp.evidence[String(dex)] });
          const rowForms = fr.kind === "forms" ? fr.forms : allForms;
          const fail = (why: string) => {
            for (const f of rowForms) acc(dex, f).uncertain.push({ id: entryId(dex, f), name: nameOf(dex, f), version: v, loc: r.loc, method: r.m, why });
          };
          if (fr.kind === "uncertain") fail(`form: ${fr.why}`);
          if (mc.kind === "unknown") {
            fail(mc.why);
            continue;
          }
          if (pm.kind === "none") {
            fail(`place: ${pm.why}`);
            if (!pm.why.includes(" names ")) {
              const where = `${r.loc} · ${VERSION_REGIONS[v].join(" / ")}`;
              const m = missing.get(where) ?? { versions: new Set(), entries: new Set() };
              m.versions.add(v);
              for (const f of rowForms) m.entries.add(entryId(dex, f));
              missing.set(where, m);
            }
            continue;
          }
          if (fr.kind === "uncertain") continue;
          stats.counted++;
          for (const f of fr.forms) {
            const a = acc(dex, f);
            const byLabel = a.places.get(pm.key) ?? new Map<string, Set<string>>();
            a.places.set(pm.key, byLabel);
            const set = byLabel.get(mc.label) ?? new Set<string>();
            set.add(v);
            byLabel.set(mc.label, set);
          }
        }
      }
    }
  }

  // Difficulty grids.
  const { width: W, height: H, squarePx } = inp.geo.world.map;
  const world = (p: Pt): Pt => [p[0] * W, p[1] * H];
  const pinned = [...idx.pinned.values()];
  const worldGrid = buildGrid([0, 0, W, H], squarePx, pinned.map((p) => p.mask.map(world)));
  const regionGrids = new Map<HuntMapRegionId, { grid: MapGrid; regions: string[] }>();
  for (const id of HUNT_MAP_REGIONS) {
    const crop = inp.geo.world.crops[id];
    if (!crop) continue;
    regionGrids.set(id, { grid: buildGrid(crop.box, squarePx, pinned.filter((p) => crop.regions.includes(p.region)).map((p) => p.mask.map(world))), regions: crop.regions });
  }

  const entries: HuntEntry[] = [];
  for (const a of [...accs.values()].sort((x, y) => x.dex - y.dex || (x.form ?? "").localeCompare(y.form ?? ""))) {
    const id = entryId(a.dex, a.form);
    const name = nameOf(a.dex, a.form);
    if (a.uncertain.length) {
      review.push(...a.uncertain);
      continue;
    }
    if (!a.places.size) continue;
    const places: HuntPlace[] = [...a.places.entries()].map(([key, byLabel]) => {
      const p = idx.pinned.get(key)!;
      const methods: HuntMethod[] = [...byLabel.entries()]
        .map(([method, vs]) => {
          const versions = [...vs].sort((x, y) => versionOrder(x) - versionOrder(y));
          return { versions, games: versions.map((v) => VERSION_BY_KEY[v].name).join(" / "), method };
        })
        .sort((x, y) => versionOrder(x.versions[0]) - versionOrder(y.versions[0]) || x.method.localeCompare(y.method));
      return { region: HUNT_REGION_OF_GEO[p.region], geoRegion: p.region, name: p.name, pin: p.pin, methods };
    });
    places.sort((x, y) => regionOrder(x.region) - regionOrder(y.region) || x.geoRegion.localeCompare(y.geoRegion) || x.name.localeCompare(y.name));
    const regions = HUNT_REGIONS.filter((r) => places.some((p) => p.region === r));
    const spotsOf = (filter: (p: PinnedPlace) => boolean) => places.map((p) => idx.pinned.get(placeKey(p.geoRegion, p.name))!).filter(filter).map((p) => p.mask.map(world));
    const shares = regions.map((r) => goodShare(worldGrid, spotsOf((p) => HUNT_REGION_OF_GEO[p.region] === r)));
    const difficulty = worldDifficulty(shares, huntPinsFor(regions.length, "classic"));
    const regionDifficulty: Partial<Record<HuntMapRegionId, number>> = {};
    for (const [rid, { grid, regions: geoRegions }] of regionGrids) {
      const spots = spotsOf((p) => geoRegions.includes(p.region));
      if (spots.length) regionDifficulty[rid] = round3(1 - goodShare(grid, spots));
    }
    const mon = dexBy.get(a.dex)!;
    const form = a.form ? formsBy.get(a.dex)!.find((f) => f.key === a.form)! : null;
    const famous = FAMOUS.find((f) => f.id === id && places.some((p) => p.name === f.place));
    const entry: HuntEntry = {
      id,
      dex: a.dex,
      form: a.form,
      name,
      art: form ? form.art : a.dex,
      slug: mon.slug,
      regions,
      places,
      difficulty,
      regionDifficulty,
      ...(famous ? { famous: true } : {}),
      ...((regions.length >= EVERYWHERE_REGIONS && difficulty < EVERYWHERE_DIFFICULTY) || regions.length >= EVERYWHERE_ALWAYS ? { everywhere: true } : {}),
    };
    const fact = factOf(entry);
    if (fact) entry.fact = fact;
    entries.push(entry);
  }

  const missingPlaces = [...missing.entries()]
    .map(([place, m]) => ({ place, versions: [...m.versions].sort((x, y) => versionOrder(x) - versionOrder(y)), entries: [...m.entries].sort() }))
    .sort((x, y) => y.entries.length - x.entries.length || x.place.localeCompare(y.place));
  stats.entries = entries.length;
  stats.reviewItems = review.length;
  stats.species = new Set(entries.map((e) => e.dex)).size;
  return { entries, review, missingPlaces, stats };
}

/** A one-line fact from the data, only when it's plainly true: a single spot. */
function factOf(e: HuntEntry): string | undefined {
  if (e.places.length !== 1) return undefined;
  const p = e.places[0];
  const games = [...new Set(p.methods.flatMap((m) => m.versions))];
  if (games.length === 1) return `Its one spot on the map is ${p.name}, in ${VERSION_BY_KEY[games[0]].name}.`;
  return `Every game puts it in the same place: ${p.name}.`;
}
