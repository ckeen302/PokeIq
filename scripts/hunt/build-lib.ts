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
import { AGREED_LABEL, ALTERING_CAVE, EVENT_ONLY, VERSION_REGIONS } from "./rules";
import { normPlace } from "../../src/lib/pokemon/encounter-transform";

/** Rows that need an event (rules.ts EVENT_ONLY, Altering Cave): left out like any event. */
function eventOnly(dex: number, v: string, loc: string): { kind: "excluded"; why: string } | undefined {
  const e = EVENT_ONLY.find((x) => x.dex === dex && (!x.versions || x.versions.includes(v)) && (!x.loc || normPlace(x.loc) === normPlace(loc)));
  if (e) return { kind: "excluded", why: e.why };
  if (ALTERING_CAVE.versions.includes(v) && normPlace(loc) === normPlace(ALTERING_CAVE.loc) && !ALTERING_CAVE.normal.includes(dex)) return { kind: "excluded", why: "Altering Cave Mystery Gift event" };
  return undefined;
}
import { buildPlaceIndex, classifyMethod, isOffMap, matchPlace, subAreaPlace, placeKey, type GeoPlace, type PinnedPlace, type PlaceIndex } from "./match";

export interface EncRow {
  v: string[];
  lv?: string;
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
  /** dex → form ("" for the original) → version → what Bulbapedia and Serebii agree on (scripts/hunt/make-agreed.ts). */
  agreed?: Record<string, Record<string, Record<string, { both: [string, string | null][]; any: string[] }>>>;
  /** dex → form ("" for the original) → version → Max Raid den places both sources list. */
  dens?: Record<string, Record<string, Record<string, string[]>>>;
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
  /** Places dropped from an entry because neither Bulbapedia nor Serebii lists them in that game. */
  dropped: ReviewItem[];
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

/** `difficulty: false` skips the measure (zeros), for quick checks of the matching alone. */
export function buildAnswers(inp: Inputs, opts: { difficulty?: boolean } = {}): BuildResult {
  const measure = opts.difficulty !== false;
  const idx = buildPlaceIndex(inp.geo.world.locations);
  const formsBy = regionalForms(inp.aboutForms);
  const dexBy = new Map(inp.pokedex.map((p) => [p.id, p]));
  const accs = new Map<string, Acc>();
  const review: ReviewItem[] = [];
  const missing = new Map<string, { versions: Set<string>; entries: Set<string> }>();
  const excludedAt = new Set<string>();
  const stats: Record<string, number> = { rows: 0, counted: 0, excludedMethod: 0, offMap: 0, excludedGame: 0, dataDenRows: 0, summaryRows: 0, summaryOnly: 0, addedByAgreement: 0, droppedUnconfirmed: 0 };

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
    // Max Raid dens come from the agreed den table (scripts/hunt/make-dens.ts), not the data's partial rows.
    const rows: (EncRow & { forms?: (string | null)[] })[] = [];
    for (const g of inp.encounters.get(dex) ?? []) for (const r of g.rows) r.m === "Max Raid" ? stats.dataDenRows++ : rows.push(r);
    for (const [form, byVersion] of Object.entries(inp.dens?.[String(dex)] ?? {}))
      for (const [v, places] of Object.entries(byVersion)) for (const loc of places) rows.push({ v: [v], loc, m: "Max Raid", forms: [form || null] });
    {
      for (const r of rows) {
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
          const mc = eventOnly(dex, v, r.loc) ?? classifyMethod(r.m, [v], r.n);
          if (mc.kind === "excluded") {
            stats.excludedMethod++;
            // Remember where: the sources' agreed list must not add back what a rule left out.
            const at = matchPlace(idx, r.loc, v);
            if (at.kind === "place") excludedAt.add(`${dex}|${v}|${at.key}`);
            continue;
          }
          if (isOffMap(r.loc)) {
            stats.offMap++;
            continue;
          }
          // Sword / Shield's expansion "Wild" rows are Serebii's summary lists (no method, no level):
          // they repeat a detailed row, or they may be something else entirely (Cosmog in Freezington is a gift).
          if (r.m === "Wild" && !r.lv && (v === "sword" || v === "shield")) {
            if (rows.some((o) => o !== r && o.loc === r.loc && o.m !== "Wild" && o.m !== "Max Raid" && o.v.includes(v))) {
              stats.summaryRows++;
              continue;
            }
            // Not counted on its own: where Bulbapedia and Serebii both list the place, the agreement step adds it.
            stats.summaryOnly++;
            continue;
          }
          // A sub-area only counts inside a place that matched (a Mirage spot's "Route 124" note isn't the route).
          const byName = matchPlace(idx, r.loc, v);
          const sub = byName.kind === "place" ? subAreaPlace(idx, r.n, v) : undefined;
          const pm: ReturnType<typeof matchPlace> = sub ? { kind: "place", key: sub, via: "the sub-area in the note" } : byName;
          const names = [r.loc, ...(pm.kind === "place" ? [idx.pinned.get(pm.key)!.name] : [])];
          const fr: ReturnType<typeof resolveForms> = r.forms ? { kind: "forms", forms: r.forms, via: "den table" } : resolveForms({ dex, version: v, note: r.n, names, forms, evidence: inp.evidence[String(dex)] });
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

  // Bulbapedia and Serebii together (scripts/hunt/make-agreed.ts): add the places both list that the
  // data lacks, and drop the ones neither lists, for every game both sources have a list for.
  const dropped: ReviewItem[] = [];
  for (const a of accs.values()) {
    const games = inp.agreed?.[String(a.dex)]?.[a.form ?? ""];
    if (!games) continue;
    for (const [v, g] of Object.entries(games)) {
      if (v === "legends-arceus" || !VERSION_BY_KEY[v]) continue;
      const ours = new Set([...a.places].filter(([, byLabel]) => [...byLabel.values()].some((vs) => vs.has(v))).map(([k]) => k));
      for (const [key, hint] of g.both) {
        if (ours.has(key) || hint === "Max Raid" || excludedAt.has(`${a.dex}|${v}|${key}`) || !idx.pinned.has(key)) continue;
        const byLabel = a.places.get(key) ?? new Map<string, Set<string>>();
        a.places.set(key, byLabel);
        const label = hint ?? AGREED_LABEL;
        (byLabel.get(label) ?? byLabel.set(label, new Set()).get(label)!).add(v);
        stats.addedByAgreement++;
      }
      const any = new Set(g.any);
      for (const key of ours) {
        if (any.has(key)) continue;
        const byLabel = a.places.get(key)!;
        for (const [label, vs] of byLabel) {
          if (label === "Max Raid") continue;
          if (vs.delete(v)) {
            stats.droppedUnconfirmed++;
            dropped.push({ id: entryId(a.dex, a.form), name: nameOf(a.dex, a.form), version: v, loc: idx.pinned.get(key)!.name, method: label, why: "dropped: neither Bulbapedia nor Serebii lists it in this game" });
          }
          if (!vs.size) byLabel.delete(label);
        }
        if (!byLabel.size) a.places.delete(key);
      }
    }
  }

  // Difficulty grids.
  const { width: W, height: H, squarePx } = inp.geo.world.map;
  const world = (p: Pt): Pt => [p[0] * W, p[1] * H];
  const pinned = [...idx.pinned.values()];
  const worldGrid = !measure ? null : buildGrid([0, 0, W, H], squarePx, pinned.map((p) => p.mask.map(world)));
  const regionGrids = new Map<HuntMapRegionId, { grid: MapGrid; regions: string[] }>();
  for (const id of measure ? HUNT_MAP_REGIONS : []) {
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
    const shares = regions.map((r) => (!worldGrid ? 0 : goodShare(worldGrid, spotsOf((p) => HUNT_REGION_OF_GEO[p.region] === r))));
    const difficulty = !measure ? 0 : worldDifficulty(shares, huntPinsFor(regions.length, "classic"));
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
  return { entries, review, dropped, missingPlaces, stats };
}

/** A one-line fact from the data, only when it's plainly true: a single spot. */
function factOf(e: HuntEntry): string | undefined {
  if (e.places.length !== 1) return undefined;
  const p = e.places[0];
  const games = [...new Set(p.methods.flatMap((m) => m.versions))];
  if (games.length === 1) return `Its one spot on the map is ${p.name}, in ${VERSION_BY_KEY[games[0]].name}.`;
  return `Every game puts it in the same place: ${p.name}.`;
}
