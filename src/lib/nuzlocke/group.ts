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

export function groupByMethod(encounters: readonly ViewEncounter[]): MethodGroup[] {
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
