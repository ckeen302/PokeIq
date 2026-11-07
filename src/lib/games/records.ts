import { allAroundPoints } from "./allround";
import type { Athlete } from "./athlete";
import { EVENT_IDS, MARK_EVENTS, eventOf, type EventId } from "./events";
import { NATION_TYPES } from "./games";
import { neutralMarks } from "./allround";
import { ringStrength } from "./wrestle";

/**
 * The records: every event pre-run for every athlete (the 1,025 Pokémon
 * and every form with its own stats), at neutral form, with a perfect
 * board and no fouls: each athlete's mark as the model sees its best day.
 * scripts/games-records.ts writes them to src/data/games-records.json;
 * tests/games-records.test.ts checks the file still matches the model.
 * Wrestling has no mark: its column is the ring strength (push + brace, in
 * newtons) the bracket is seeded by. Pure.
 */

export const RECORD_EVENTS = [...MARK_EVENTS, "wrestling", "all-around"] as const satisfies readonly EventId[];
export type RecordEvent = (typeof RECORD_EVENTS)[number];

/** One row: the key, then each RECORD_EVENTS mark (null: no mark). */
export type RecordRow = [key: string, ...marks: (number | null)[]];

export interface RecordsFile {
  version: 1;
  events: RecordEvent[];
  rows: RecordRow[];
  /** Each type's best all-rounders, best first (Pokémon, not forms; no Legendary or Mythical Pokémon, so every type fields a team of its own): its nation takes the first three no other nation has. */
  nations: Record<string, string[]>;
}

const r3 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

export function recordRow(a: Athlete): RecordRow {
  const m = neutralMarks(a);
  const aa = allAroundPoints(m).total;
  return [a.key, ...MARK_EVENTS.map((id) => r3(m[id])), r3(ringStrength(a)), aa];
}

export function buildRecords(athletes: Athlete[]): RecordsFile {
  const rows = athletes.map(recordRow);
  const aaAt = 1 + RECORD_EVENTS.indexOf("all-around");
  const byKey = new Map(athletes.map((a) => [a.key, a]));
  const nations: Record<string, string[]> = {};
  for (const t of NATION_TYPES) {
    nations[t] = rows
      .filter((r) => { const a = byKey.get(r[0])!; return a.entrant.kind === "pokemon" && !a.entrant.legendary && !a.entrant.mythical && a.types.includes(t); })
      .sort((x, y) => (y[aaAt] as number) - (x[aaAt] as number) || x[0].localeCompare(y[0]))
      .slice(0, 12)
      .map((r) => r[0]);
  }
  return { version: 1, events: [...RECORD_EVENTS], rows, nations };
}

/** A records table read back: per event, each key's mark. */
export interface RecordsIndex {
  events: RecordEvent[];
  mark(key: string, event: RecordEvent): number | null;
  /** Keys with a mark, best first (ties by key). */
  ranking(event: RecordEvent): string[];
  /** 1-based rank of a key in an event (null: no mark). */
  rank(key: string, event: RecordEvent): number | null;
  keys: string[];
  nations: Record<string, string[]>;
}

export function indexRecords(file: RecordsFile, include?: (key: string) => boolean): RecordsIndex {
  const rows = include ? file.rows.filter((r) => include(r[0])) : file.rows;
  const at = new Map(file.events.map((e, i) => [e, i + 1]));
  const byKey = new Map(rows.map((r) => [r[0], r]));
  const rankings = new Map<RecordEvent, string[]>();
  const ranks = new Map<RecordEvent, Map<string, number>>();
  const higher = (e: RecordEvent) => e === "wrestling" || eventOf(e).better === "higher";
  const ranking = (e: RecordEvent) => {
    let list = rankings.get(e);
    if (!list) {
      const i = at.get(e)!;
      const sign = higher(e) ? -1 : 1;
      list = rows.filter((r) => r[i] != null).sort((x, y) => sign * ((x[i] as number) - (y[i] as number)) || x[0].localeCompare(y[0])).map((r) => r[0]);
      rankings.set(e, list);
      ranks.set(e, new Map(list.map((k, j) => [k, j + 1])));
    }
    return list;
  };
  return {
    events: file.events,
    keys: rows.map((r) => r[0]),
    nations: file.nations,
    mark: (key, e) => (byKey.get(key)?.[at.get(e)!] as number | null | undefined) ?? null,
    ranking,
    rank: (key, e) => { ranking(e); return ranks.get(e)!.get(key) ?? null; },
  };
}

export const ALL_RECORD_EVENTS: readonly EventId[] = EVENT_IDS;
