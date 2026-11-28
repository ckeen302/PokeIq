import type { EncounterKind } from "./model";
import type { ViewEncounter } from "./view";

/**
 * An area's encounters as the screens list them: by how they're met (Grass, Surf, Old Rod, Gift…), each Pokémon once,
 * with every line the data has for it there (a version's own rate, a floor, a time of day).
 */

export interface EncounterStat {
  versions?: string[];
  condition?: string;
  /** What varies between the data's lines summed up in this one (see compact.ts). */
  when?: string[];
  rate?: number;
  /** The lowest rate, when the lines summed up differ (`rate` is the highest). */
  rateMin?: number;
  levels?: [number, number];
  /** A post-game line ("After the Hall of Fame"), shown under the story's. */
  post?: string;
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

/** Diamond, Pearl and Platinum's dual-slot encounters: the data names the method after the GBA game in the DS. */
const DUAL_SLOT = /^(Ruby|Sapphire|Emerald|FireRed|LeafGreen)$/;

/** A way of meeting, as the screens head it: "FireRed in slot 2" rather than a bare "FireRed" (as DPPt's data words it). */
export const methodLabel = (method: string): string => (DUAL_SLOT.test(method) ? `${method} in slot 2` : method);

/**
 * The order the ways of meeting are listed in: walking (grass, caves) first, as it's how most areas are met; then what
 * the area gives once (a starter, a gift, a static Pokémon, a trade…); then the water (Surf, then the rods, weakest
 * first); then Rock Smash, Headbutt and the like.
 */
export function methodRank(method: string, kind: EncounterKind): number {
  if (kind !== "wild") return KIND_RANK[kind] ?? 1.9;
  // Last, what takes a mechanic of its own: SOS calls, hordes, the Poké Radar, swarms, a GBA game in the DS…
  if (DUAL_SLOT.test(method) || /\bsos\b|horde|dexnav|radar|swarm|grotto|island scan/i.test(method)) return 5;
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
  const groups = new Map<string, { group: MethodGroup; rows: Map<string, EncounterRow> }>();
  for (const e of encounters) {
    const key = `${e.kind}|${e.method}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { group: { method: e.method, kind: e.kind, rows: [] }, rows: new Map() }));
    let row = g.rows.get(e.mon);
    if (!row) {
      g.rows.set(e.mon, (row = { mon: e.mon, stats: [] }));
      g.group.rows.push(row);
    }
    const stat: EncounterStat = {};
    if (e.versions) stat.versions = e.versions;
    if (e.condition) stat.condition = e.condition;
    if (e.when) stat.when = e.when;
    if (e.rate !== undefined) stat.rate = e.rate;
    if (e.rateMin !== undefined) stat.rateMin = e.rateMin;
    if (e.levels) stat.levels = e.levels;
    if (e.post) stat.post = e.post;
    row.stats.push(stat);
  }
  return [...groups.values()].map((g) => g.group);
}

/** A row's story-time lines, and its post-game ones (shown apart, under them). */
export const storyStats = (stats: readonly EncounterStat[]): EncounterStat[] => stats.filter((s) => !s.post);
export const postStats = (stats: readonly EncounterStat[]): EncounterStat[] => stats.filter((s) => s.post);

/** The level range across a row's lines, or null when none is known. */
export function levelSpan(stats: readonly EncounterStat[]): [number, number] | null {
  const known = stats.flatMap((s) => (s.levels ? [s.levels] : []));
  if (!known.length) return null;
  return [Math.min(...known.map((l) => l[0])), Math.max(...known.map((l) => l[1]))];
}
