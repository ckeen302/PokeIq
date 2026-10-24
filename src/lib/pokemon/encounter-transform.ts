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
  /** Display label. */
  loc?: string;
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

const COND_DROP = /(-no|-off|-none|-not-mentioned)$/;
const COND_LABELS: Record<string, string> = {
  "swarm-yes": "Swarm",
  "radar-on": "PokéRadar",
  "radio-hoenn": "Hoenn Sound",
  "radio-sinnoh": "Sinnoh Sound",
};

/** Non-time encounter conditions -> a short human label ("" for the plain case). */
export function conditionLabel(names: string[]): string {
  return names
    .filter((n) => !n.startsWith("time-") && !COND_DROP.test(n))
    .map((n) => {
      if (COND_LABELS[n]) return COND_LABELS[n];
      if (n.startsWith("slot2-")) return `GBA slot: ${SLOT2[n.slice(6)] ?? titleCase(n.slice(6))}`;
      if (n.startsWith("season-")) return titleCase(n.slice(7));
      return titleCase(n);
    })
    .sort()
    .join(", ");
}

const SLOT2: Record<string, string> = { ruby: "Ruby", sapphire: "Sapphire", emerald: "Emerald", firered: "FireRed", leafgreen: "LeafGreen" };
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function levelText(lo: number, hi: number): string {
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

const SLOT_BY_COND: Record<string, 0 | 1 | 2> = { "time-morning": 0, "time-day": 1, "time-night": 2 };
const NO_RATE_METHODS = new Set(["gift", "gift-egg", "only-one", "static", "npc-trade"]);

/** Flatten PokéAPI encounters into one RawRow per (version, area, method, condition). */
export function rowsFromPokeApi(
  encounters: PokeApiEncounter[],
  resolveArea: (slug: string) => AreaName,
  versionFilter: (key: string) => boolean = (k) => (VERSION_BY_KEY[k]?.gen ?? 99) <= 7 && !k.startsWith("lets-go")
): RawRow[] {
  const out: RawRow[] = [];
  for (const enc of encounters) {
    const area = resolveArea(enc.location_area.name);
    const label = area.area && !area.area.toLowerCase().startsWith(area.loc.toLowerCase()) ? `${area.loc} (${area.area})` : area.area ?? area.loc;
    for (const vd of enc.version_details) {
      if (!versionFilter(vd.version.name)) continue;
      // group by method + non-time condition
      const groups = new Map<string, { method: string; cond: string; lo: number; hi: number; slots: [number, number, number] }>();
      for (const d of vd.encounter_details) {
        const names = d.condition_values.map((c) => c.name);
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
        const row: RawRow = { ver: vd.version.name, loc: label, base: area.loc, m: methodLabel(g.method, label) };
        if (g.method !== "npc-trade") row.lv = levelText(g.lo, g.hi); // a trade's level is whatever you send
        if (g.cond) row.n = g.cond;
        if (!NO_RATE_METHODS.has(g.method)) {
          const [m, d, n] = g.slots;
          if (m === d && d === n) row.r = `${m}%`;
          else row.t = g.slots.map((v) => (v ? `${v}%` : "—")) as [string, string, string];
        }
        out.push(row);
      }
    }
  }
  return collapseSlot2(out);
}

/** Dual-slot rows that only differ by the inserted GBA game become one row ("GBA slot: Ruby, Sapphire"). */
function collapseSlot2(rows: RawRow[]): RawRow[] {
  const kept: RawRow[] = [];
  const byKey = new Map<string, { row: RawRow; games: string[] }>();
  for (const r of rows) {
    if (!r.n?.startsWith("GBA slot: ")) {
      kept.push(r);
      continue;
    }
    const key = JSON.stringify([r.ver, r.loc, r.m, r.lv, r.r, r.t]);
    const g = byKey.get(key) ?? { row: { ...r }, games: [] };
    g.games.push(r.n.slice("GBA slot: ".length));
    byKey.set(key, g);
  }
  for (const { row, games } of byKey.values()) kept.push({ ...row, n: `GBA slot: ${games.join(", ")}` });
  return kept;
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

const sig = (r: RawRow) => JSON.stringify([r.loc, r.base, r.m, r.lv, r.r, r.t, r.n, r.x]);

/** Merge rows whose content is identical across versions into one multi-version row. */
export function mergeVersions(raw: RawRow[], atlas?: AtlasIndex): EncRow[] {
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
    if (row.n) out.n = row.n;
    if (row.x) out.x = row.x;
    rows.push(out);
  }
  return rows.sort((a, b) => versionOrder(a.v[0]) - versionOrder(b.v[0]) || (a.loc ?? "~").localeCompare(b.loc ?? "~", undefined, { numeric: true }) || (a.m ?? "").localeCompare(b.m ?? ""));
}

/* ----------------------------------------------------- generations etc. -- */

export interface FallbackContext {
  id: number;
  /** Generation the species was introduced in. */
  speciesGen: number;
  evolvesFrom?: string;
  isBaby?: boolean;
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
    const versions = VERSIONS.filter((v) => v.gen === g && (!v.key.startsWith("lets-go") || inLetsGo(ctx.id)));
    const inGen = raw.filter((r) => VERSION_BY_KEY[r.ver]?.gen === g);
    const have = new Set(inGen.map((r) => r.ver));
    const fill: RawRow[] = versions
      .filter((v) => !have.has(v.key))
      .map((v) => ({ ver: v.key, x: ctx.evolvesFrom ? `Evolve from ${ctx.evolvesFrom}` : ctx.isBaby ? "Breed" : "Not found in the wild" }));
    const rows = mergeVersions(inGen, atlas);
    const fillRows = mergeVersions(fill);
    if (rows.length + fillRows.length) gens.push({ g, rows: [...rows, ...fillRows] });
  }
  return gens;
}
