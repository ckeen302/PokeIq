import { LAUNCH_DATE } from "@/lib/daily";

/**
 * The Daily's crowd map: where everyone pinned each round, as a coarse grid
 * of counts on the Daily's map (never anyone's own pin, never a name). Built
 * on the server (src/lib/server/geo-crowd.ts) from the pin log (migration
 * 0050) and only handed out once the asker has finished that Daily, or once
 * the day is over everywhere, so it can't give today's places away.
 */

/** Cells across the map's longer side: coarse enough that a cell is a neighbourhood, not a pin. */
export const CROWD_GRID = 64;
/** A round's map shows once at least this many trainers pinned it (fewer says little and points at someone). */
export const CROWD_MIN_PINS = 3;

/** One round's crowd: grid cells as [x, y, count] (the cell's centre, on the map's own 0–1), biggest first. */
export interface GeoCrowdRound {
  /** 1-based round number. */
  round: number;
  /** Trainers who pinned it. */
  pins: number;
  cells: [number, number, number][];
  /** A cell's size on the map's 0–1 (across, down). */
  cw: number;
  ch: number;
  /** The biggest cell's count. */
  max: number;
}

export interface GeoCrowd {
  date: string;
  /** Rounds with enough pins to show; empty until there are. */
  rounds: GeoCrowdRound[];
}

const DAY_MS = 86_400_000;
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** A real calendar date from the PokéGuessr Daily's launch on, as YYYY-MM-DD. */
export function isCrowdDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = midnight(date);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date && date >= LAUNCH_DATE;
}

/**
 * A Daily is over once nobody anywhere can still play it: it's graded while
 * its date is within a day of today in UTC (every time zone's today), so it
 * closes two days after its UTC midnight.
 */
export function crowdDayOver(date: string, now = Date.now()): boolean {
  return isCrowdDate(date) && now >= midnight(date) + 2 * DAY_MS;
}

/**
 * Who may see a day's crowd map: anyone once the day is over; before that,
 * only a trainer who finished that very Daily (`finished`: their signed
 * result's date, from geo-crowd's server side). Never a day still to come.
 */
export function crowdAllowed(date: string, finished: string | null, now = Date.now()): boolean {
  if (!isCrowdDate(date) || midnight(date) > now + DAY_MS) return false;
  return crowdDayOver(date, now) || finished === date;
}

/** Each trainer's first pin only (a replay of the Daily is practice and says nothing new). Pins with no trainer all count. */
export function firstPinPerPlayer<T extends { player: string | null }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.player) return true;
    if (seen.has(r.player)) return false;
    seen.add(r.player);
    return true;
  });
}

/**
 * Pins on a map (its own 0–1) into square cells, `grid` across its longer
 * side (`width` × `height`: the map's size, any unit). Pins off the map are
 * dropped. Below `min` pins there's no map: null.
 */
export function aggregateCrowd(
  pins: readonly (readonly [number, number])[],
  size: { width: number; height: number },
  round: number,
  { grid = CROWD_GRID, min = CROWD_MIN_PINS }: { grid?: number; min?: number } = {}
): GeoCrowdRound | null {
  const side = Math.max(size.width, size.height) / grid;
  const cols = Math.max(1, Math.ceil(size.width / side));
  const rows = Math.max(1, Math.ceil(size.height / side));
  const cw = side / size.width;
  const ch = side / size.height;
  const counts = new Map<number, number>();
  let n = 0;
  for (const [x, y] of pins) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) continue;
    const c = Math.min(cols - 1, Math.floor(x / cw));
    const r = Math.min(rows - 1, Math.floor(y / ch));
    counts.set(r * cols + c, (counts.get(r * cols + c) ?? 0) + 1);
    n++;
  }
  if (n < min) return null;
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  const cells = [...counts]
    .map(([k, count]): [number, number, number] => {
      const c = k % cols;
      const r = Math.floor(k / cols);
      return [r4(Math.min(1, (c + 0.5) * cw)), r4(Math.min(1, (r + 0.5) * ch)), count];
    })
    .sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
  return { round, pins: n, cells, cw: r4(cw), ch: r4(ch), max: cells[0]?.[2] ?? 0 };
}

/** A cell's heat colour, cool to hot by its share of the busiest cell. */
export function crowdColor(share: number): string {
  if (share >= 0.66) return "#ff4f6d";
  if (share >= 0.33) return "#ffb23c";
  return "#ffe46b";
}
