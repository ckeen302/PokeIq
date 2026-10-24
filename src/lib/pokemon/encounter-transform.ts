/**
 * Pure transforms behind the "Where to find it" data (no I/O): PokéAPI
 * encounter payloads -> per-version rows -> rows merged across versions and
 * grouped by generation. Used by scripts/dex and unit-tested in
 * tests/encounter-transform.test.ts.
 */
import { VERSIONS, VERSION_BY_KEY, versionOrder, type EncGen, type EncRow } from "./encounter-types";

/** One row for one version, before identical versions are merged. */
export interface RawRow {
  ver: string;
  /** Place label. */
  loc?: string;
  /** Sub-area of the place ("1F", "Area 2", "after Galactic intervention"). */
  sub?: string;
  /** Place name used for the atlas lookup (area suffixes stripped). */
  base?: string;
  m?: string;
  lv?: string;
  r?: string;
  t?: [string, string, string];
  n?: string;
  x?: string;
}

/* ------------------------------------------------------------- PokéAPI -- */

export interface PokeApiEncounterDetail {
  min_level: number;
  max_level: number;
  chance: number;
  method: { name: string };
  condition_values: { name: string }[];
}
export interface PokeApiEncounter {
  location_area: { name: string; url: string };
  version_details: { version: { name: string }; encounter_details: PokeApiEncounterDetail[] }[];
}
export interface AreaName {
  /** Place name ("Mt. Coronet"). */
  loc: string;
  /** Sub-area ("1F"), when the API names one. */
  area?: string;
}

const METHOD_LABELS: Record<string, string> = {
  surf: "Surf",
  "old-rod": "Old Rod",
  "good-rod": "Good Rod",
  "super-rod": "Super Rod",
  "rock-smash": "Rock Smash",
  headbutt: "Headbutt",
  "headbutt-low": "Headbutt (low)",
  "headbutt-normal": "Headbutt",
  "headbutt-high": "Headbutt (high)",
  gift: "Gift",
  "gift-egg": "Gift (Egg)",
  "only-one": "Static",
  static: "Static",
  sos: "SOS call",
  horde: "Horde",
  "berry-trees": "Berry tree",
  "hidden-grotto": "Hidden Grotto",
  "honey-tree": "Honey tree",
  snag: "Snag",
  pokespot: "PokéSpot",
  pokeflute: "Poké Flute",
  "squirt-bottle": "Squirt Bottle",
  "wailmer-pail": "Wailmer Pail",
  seaweed: "Dive",
  "roaming-grass": "Roaming",
  "roaming-water": "Roaming (water)",
  "devon-scope": "Devon Scope",
  "sos-encounter": "SOS call",
  "npc-trade": "Trade",
  "dark-grass": "Dark grass",
  "grass-spots": "Rustling grass",
  "cave-spots": "Dust cloud",
  "bridge-spots": "Bridge shadow",
  "super-rod-spots": "Fishing spot",
  "surf-spots": "Rippling water",
  "yellow-flowers": "Yellow flowers",
  "purple-flowers": "Purple flowers",
  "red-flowers": "Red flowers",
  "rough-terrain": "Rough terrain",
  "bubbling-spots": "Bubbling spot",
  "feebas-tile-fishing": "Feebas tile",
  "island-scan": "Island Scan",
  "berry-piles": "Berry pile",
  "sos-from-bubbling-spot": "SOS (bubbling spot)",
};
const CAVE_RE = /cave|tunnel|mt\.? |mount |ruins|grotto|mine\b|chamber|cavern|basement|\b\d+f\b|\bb\d+f\b|tower|well\b|depths|lair|hall\b|sewers?|relic|seafloor|path\b|\bpit\b/i;

export function methodLabel(name: string, loc = ""): string {
  if (name === "walk") return CAVE_RE.test(loc) ? "Cave" : "Grass";
  return METHOD_LABELS[name] ?? name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Conditions that describe the ordinary case: the row is shown without a note. */
const COND_PLAIN = /^(swarm-no|radar-off|radio-off|slot2-none|bug-catching-contest-no|johto-safari-blocks-inactive|backlot-not-mentioned|great-marsh-daily-slot-none)$/;

/**
 * Encounters that only happen under a niche modifier players find confusing
 * (Gen 4 dual-slot "GBA game inserted" rows and the HGSS / Pokégear radio
 * shows). The whole encounter is dropped rather than shown with a note.
 */
export function isNicheCondition(names: string[]): boolean {
  return names.some((n) => (n.startsWith("slot2-") && n !== "slot2-none") || n === "radio-hoenn" || n === "radio-sinnoh");
}

const COND_LABELS: Record<string, string> = {
  "swarm-yes": "Swarm",
  "radar-on": "Poké Radar",
  "headbutt-tree-common": "Common trees",
  "headbutt-tree-rare": "Rare trees",
  "headbutt-tree-secret": "One special tree",
  "bug-catching-contest-yes": "Bug-Catching Contest",
  "backlot-mentioned": "Daily, after Mr. Backlot mentions it",
  "story-progress-national-dex": "After National Dex",
  "story-progress-before-national-dex": "Before National Dex",
  "story-progress-hall-of-fame": "After the Hall of Fame",
  "story-progress-before-hall-of-fame": "Before the Hall of Fame",
};
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const sentence = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function oneCondition(n: string): string {
  if (COND_LABELS[n]) return COND_LABELS[n];
  if (n.startsWith("season-")) return `${titleCase(n.slice(7))} only`;
  if (n.startsWith("weekday-")) return `${titleCase(n.slice(8))}s`;
  if (n.startsWith("weather-")) return `Weather: ${sentence(n.slice(8))}`;
  if (n.startsWith("great-marsh-daily-slot-")) return "Changes daily";
  if (n.startsWith("johto-safari-blocks-")) return "Needs Safari Zone objects placed";
  if (n.startsWith("honey-tree-group-")) return "";
  if (n.startsWith("friend-safari-slot-")) return "Friend Safari";
  if (n.startsWith("trade-")) return `For your ${titleCase(n.slice(6))}`;
  if (n.startsWith("coins-")) return `${Number(n.slice(6)).toLocaleString("en-US")} coins`;
  if (n.startsWith("item-")) return `Needs ${titleCase(n.slice(5))}`;
  if (n.startsWith("story-progress-")) return `After: ${sentence(n.slice(15))}`;
  if (n.startsWith("starter-")) return `If you chose ${titleCase(n.slice(8))}`;
  return sentence(n);
}

/** Non-time encounter conditions -> a short plain-English label ("" for the plain case). */
export function conditionLabel(names: string[]): string {
  return [...new Set(names.filter((n) => !n.startsWith("time-") && !COND_PLAIN.test(n)).map(oneCondition).filter(Boolean))].sort().join(", ");
}

export function levelText(lo: number, hi: number): string {
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

const SLOT_BY_COND: Record<string, 0 | 1 | 2> = { "time-morning": 0, "time-day": 1, "time-night": 2 };
const NO_RATE_METHODS = new Set(["gift", "gift-egg", "only-one", "static", "npc-trade", "honey-tree"]);
/** Labels that pool several alternative tables, so a summed rate would be meaningless. */
const NO_RATE_LABELS = /Changes daily|Safari Zone objects|Friend Safari/;

/** Flatten PokéAPI encounters into one RawRow per (version, area, method, condition). */
export function rowsFromPokeApi(
  encounters: PokeApiEncounter[],
  resolveArea: (slug: string) => AreaName,
  versionFilter: (key: string) => boolean = (k) => (VERSION_BY_KEY[k]?.gen ?? 99) <= 7 && !k.startsWith("lets-go")
): RawRow[] {
  const out: RawRow[] = [];
  for (const enc of encounters) {
    const area = resolveArea(enc.location_area.name);
    const label = area.loc;
    for (const vd of enc.version_details) {
      if (!versionFilter(vd.version.name)) continue;
      // group by method + non-time condition
      const groups = new Map<string, { method: string; cond: string; lo: number; hi: number; slots: [number, number, number] }>();
      for (const d of vd.encounter_details) {
        const names = d.condition_values.map((c) => c.name);
        if (isNicheCondition(names)) continue;
        const cond = conditionLabel(names);
        const key = `${d.method.name}|${cond}`;
        const g = groups.get(key) ?? { method: d.method.name, cond, lo: 255, hi: 0, slots: [0, 0, 0] as [number, number, number] };
        g.lo = Math.min(g.lo, d.min_level);
        g.hi = Math.max(g.hi, d.max_level);
        const timed = names.filter((n) => n in SLOT_BY_COND).map((n) => SLOT_BY_COND[n]);
        for (const s of timed.length ? timed : ([0, 1, 2] as const)) g.slots[s] += d.chance;
        groups.set(key, g);
      }
      for (const g of groups.values()) {
        const row: RawRow = { ver: vd.version.name, loc: label, base: area.loc, m: methodLabel(g.method, `${label} ${area.area ?? ""}`) };
        if (area.area) row.sub = area.area;
        if (g.method !== "npc-trade") row.lv = levelText(g.lo, g.hi); // a trade's level is whatever you send
        if (g.cond) row.n = g.cond;
        const [m, d, n] = g.slots;
        if (!NO_RATE_METHODS.has(g.method) && !NO_RATE_LABELS.test(g.cond) && Math.max(m, d, n) <= 100) {
          if (m === d && d === n) row.r = `${m}%`;
          else row.t = g.slots.map((v) => (v ? `${v}%` : "—")) as [string, string, string];
        }
        out.push(row);
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------- merge -- */

export type AtlasIndex = Map<string, { name: string; region: string }[]>;

export function normPlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildAtlasIndex(places: { name: string; region: string }[]): AtlasIndex {
  const idx: AtlasIndex = new Map();
  for (const p of places) {
    const k = normPlace(p.name);
    // Two places with one name in a region stay as two hits, i.e. ambiguous.
    idx.set(k, [...(idx.get(k) ?? []), { name: p.name, region: p.region }]);
  }
  return idx;
}

/** "Name · Region" atlas query, only when exactly one place matches in the games' regions. */
export function atlasQuery(base: string | undefined, versions: string[], idx: AtlasIndex): string | undefined {
  if (!base) return undefined;
  const regions = new Set(versions.flatMap((v) => VERSION_BY_KEY[v]?.regions ?? []));
  const hits = (idx.get(normPlace(base)) ?? []).filter((h) => regions.has(h.region));
  return hits.length === 1 ? `${hits[0].name} · ${hits[0].region}` : undefined;
}

const sig = (r: RawRow) => JSON.stringify([r.loc, r.base, r.m, r.lv, r.r, r.t, r.n, r.x, r.sub]);
const sigNoSub = (r: RawRow) => JSON.stringify([r.ver, r.loc, r.base, r.m, r.lv, r.r, r.t, r.n, r.x]);
const FISHING = /rod|fishing/i;

/** Rows that differ only by sub-area become one row listing the areas. */
function foldSubAreas(raw: RawRow[]): RawRow[] {
  const groups = new Map<string, { row: RawRow; subs: string[] }>();
  for (const r of raw) {
    const g = groups.get(sigNoSub(r)) ?? { row: r, subs: [] };
    if (r.sub && !g.subs.includes(r.sub)) g.subs.push(r.sub);
    groups.set(sigNoSub(r), g);
  }
  return [...groups.values()].map(({ row, subs }) => {
    const { sub: _s, ...rest } = row;
    void _s;
    if (!subs.length) return rest;
    subs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { ...rest, sub: subs.join(", ") };
  });
}

/** The same rod/fishing row in many places collapses into one "most water" row. */
function foldFishing(rows: EncRow[]): EncRow[] {
  const groups = new Map<string, EncRow[]>();
  for (const r of rows) {
    if (!r.m || !FISHING.test(r.m) || !r.loc) continue;
    const key = JSON.stringify([r.v, r.m, r.lv, r.r, r.t]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const drop = new Set<EncRow>();
  const added = new Map<EncRow, EncRow>();
  for (const list of groups.values()) {
    const places = [...new Set(list.map((r) => r.loc!))];
    if (places.length < 4) continue;
    const f = list[0];
    list.forEach((r) => drop.add(r));
    added.set(f, { v: f.v, loc: "Most fishable water", m: f.m, lv: f.lv, ...(f.r ? { r: f.r } : {}), ...(f.t ? { t: f.t } : {}), n: `${places.length} places: ${places.slice(0, 4).join(", ")}…` });
  }
  return rows.flatMap((r) => (added.has(r) ? [added.get(r)!] : drop.has(r) ? [] : [r]));
}

/** Merge rows whose content is identical across versions into one multi-version row. */
export function mergeVersions(raw: RawRow[], atlas?: AtlasIndex): EncRow[] {
  raw = foldSubAreas(raw);
  const groups = new Map<string, { row: RawRow; vers: Set<string> }>();
  for (const r of raw) {
    const g = groups.get(sig(r)) ?? { row: r, vers: new Set<string>() };
    g.vers.add(r.ver);
    groups.set(sig(r), g);
  }
  const rows: EncRow[] = [];
  for (const { row, vers } of groups.values()) {
    const v = [...vers].sort((a, b) => versionOrder(a) - versionOrder(b));
    const out: EncRow = { v };
    if (row.loc) out.loc = row.loc;
    const a = atlas && atlasQuery(row.base, v, atlas);
    if (a) out.a = a;
    if (row.m) out.m = row.m;
    if (row.lv) out.lv = row.lv;
    if (row.r) out.r = row.r;
    if (row.t) out.t = row.t;
    const note = [row.n, row.sub].filter(Boolean).join(" · ");
    if (note) out.n = note;
    if (row.x) out.x = row.x;
    rows.push(out);
  }
  return foldFishing(rows).sort((a, b) => versionOrder(a.v[0]) - versionOrder(b.v[0]) || (a.loc ?? "~").localeCompare(b.loc ?? "~", undefined, { numeric: true }) || (a.m ?? "").localeCompare(b.m ?? ""));
}

/* ----------------------------------------------------- generations etc. -- */

export interface FallbackContext {
  id: number;
  /** Generation the species was introduced in. */
  speciesGen: number;
  evolvesFrom?: string;
  isBaby?: boolean;
  /** False when the game can't contain the species at all (default true). */
  inGame?: (version: string) => boolean;
}

/** Let's Go only contains the original 151 + Meltan/Melmetal. */
const inLetsGo = (id: number) => id <= 151 || id === 808 || id === 809;

/**
 * Group merged rows by generation (newest first) and add a free-text row for
 * every game of the generation the species has no encounter in: "Evolve from
 * X", "Breed" or "Not found in the wild".
 */
export function groupByGen(raw: RawRow[], ctx: FallbackContext, atlas?: AtlasIndex): EncGen[] {
  const gens: EncGen[] = [];
  const maxGen = Math.max(...VERSIONS.map((v) => v.gen));
  for (let g = maxGen; g >= ctx.speciesGen; g--) {
    const versions = VERSIONS.filter((v) => v.gen === g);
    const inGen = raw.filter((r) => VERSION_BY_KEY[r.ver]?.gen === g);
    const have = new Set(inGen.map((r) => r.ver));
    const fill: RawRow[] = versions
      .filter((v) => !have.has(v.key))
      .map((v) => ({ ver: v.key, x: !(ctx.inGame?.(v.key) ?? (!v.key.startsWith("lets-go") || inLetsGo(ctx.id))) ? "Not in this game" : ctx.evolvesFrom ? `Evolve from ${ctx.evolvesFrom}` : ctx.isBaby ? "Breed" : "Not found in the wild" }));
    const rows = mergeVersions(inGen, atlas);
    const fillRows = mergeVersions(fill);
    if (rows.length + fillRows.length) gens.push({ g, rows: [...rows, ...fillRows] });
  }
  return gens;
}
