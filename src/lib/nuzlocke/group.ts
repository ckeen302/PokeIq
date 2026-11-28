import type { EncounterKind } from "./model";
import type { ViewEncounter } from "./view";

/**
 * An area's encounters as the screens list them: by how they're met (Grass, Surf, Old Rod, Gift…), each Pokémon once,
 * with every line the data has for it there (a version's own rate, a floor, a time of day).
 */

export interface EncounterStat {
  versions?: string[];
  condition?: string;
  rate?: number;
  levels?: [number, number];
}

export interface EncounterRow {
  mon: string;
  stats: EncounterStat[];
}

export interface MethodGroup {
  method: string;
  kind: EncounterKind;
  rows: EncounterRow[];
}

const KIND_RANK: Partial<Record<EncounterKind, number>> = { gift: 1, static: 1.1, trade: 1.2, egg: 1.3, fossil: 1.4, roaming: 1.5 };

/**
 * The order the ways of meeting are listed in: walking (grass, caves) first, as it's how most areas are met; then what
 * the area gives once (a starter, a gift, a static Pokémon, a trade…); then the water (Surf, then the rods, weakest
 * first); then Rock Smash, Headbutt and the like.
 */
export function methodRank(method: string, kind: EncounterKind): number {
  if (kind !== "wild") return KIND_RANK[kind] ?? 1.9;
  const m = method.toLowerCase();
  if (/old rod/.test(m)) return 3;
  if (/good rod/.test(m)) return 3.1;
  if (/super rod/.test(m)) return 3.2;
  if (/rod|fish/.test(m)) return 3.3;
  if (/surf|water|dive|swim/.test(m)) return 2;
  if (/rock smash|smash/.test(m)) return 4;
  if (/headbutt|honey|tree/.test(m)) return 4.1;
  if (/grass|cave|walk|tall|dark|field|flower|sand|snow|bridge|overworld/.test(m)) return 0;
  return 0.5;
}

const topRate = (r: EncounterRow) => Math.max(-1, ...r.stats.map((s) => s.rate ?? -1));

/** By method (in methodRank's order), each Pokémon once, the likeliest first. */
export function groupByMethod(encounters: readonly ViewEncounter[]): MethodGroup[] {
  const groups = collect(encounters);
  for (const g of groups) g.rows = g.rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => topRate(b) - topRate(a) || i - j).map(([r]) => r);
  return groups.map((g, i) => [g, i] as const).sort(([a, i], [b, j]) => methodRank(a.method, a.kind) - methodRank(b.method, b.kind) || i - j).map(([g]) => g);
}

function collect(encounters: readonly ViewEncounter[]): MethodGroup[] {
  const groups = new Map<string, MethodGroup>();
  for (const e of encounters) {
    const key = `${e.kind}|${e.method}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { method: e.method, kind: e.kind, rows: [] }));
    let row = g.rows.find((r) => r.mon === e.mon);
    if (!row) g.rows.push((row = { mon: e.mon, stats: [] }));
    const stat: EncounterStat = {};
    if (e.versions) stat.versions = e.versions;
    if (e.condition) stat.condition = e.condition;
    if (e.rate !== undefined) stat.rate = e.rate;
    if (e.levels) stat.levels = e.levels;
    row.stats.push(stat);
  }
  return [...groups.values()];
}

/** The level range across a row's lines, or null when none is known. */
export function levelSpan(stats: readonly EncounterStat[]): [number, number] | null {
  const known = stats.flatMap((s) => (s.levels ? [s.levels] : []));
  if (!known.length) return null;
  return [Math.min(...known.map((l) => l[0])), Math.max(...known.map((l) => l[1]))];
}
