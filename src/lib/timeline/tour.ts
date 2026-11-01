/**
 * Tour mode: a hands-free glide through the whole timeline that pauses at
 * the key moments. A tour is a list of segments (glide from one moment to
 * the next, then hold on it); `tourAt` turns elapsed seconds into where the
 * camera should be. Pure, so it is unit-tested. Client-safe.
 */

/** The moments a tour stops at, in order of id preference; missing ids are skipped. */
export const TOUR_STOP_IDS = [
  "red-green",
  "tcg-japan",
  "anime-s01",
  "movie-01",
  "gold-silver",
  "ruby-sapphire",
  "diamond-pearl",
  "black-white",
  "x-y",
  "pokemon-go",
  "sun-moon",
  "sword-shield",
  "ash-world-champion",
  "scarlet-violet",
  "gen-10-revealed",
] as const;

export interface TourStop {
  id: string;
  t: number;
}

export interface TourSegment {
  kind: "glide" | "hold";
  /** Timeline position at the start and end of the segment. */
  from: number;
  to: number;
  /** Seconds into the tour the segment starts, and how long it lasts. */
  start: number;
  dur: number;
  /** The moment held on (holds), or glided towards (glides). */
  id: string;
}

export interface TourPlan {
  segments: TourSegment[];
  /** Total length in seconds. */
  total: number;
}

export interface TourOptions {
  /** Where the tour starts (the camera's moment when it begins). */
  from: number;
  /** Seconds held on each moment. */
  hold?: number;
  /** The whole tour is fitted into this many seconds, give or take. */
  minTotal?: number;
  maxTotal?: number;
}

/** The tour's stops, picked from the entries that exist and are shown, in time order. */
export function pickTourStops(entries: readonly TourStop[], visible: (id: string) => boolean = () => true): TourStop[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return TOUR_STOP_IDS.map((id) => byId.get(id))
    .filter((e): e is TourStop => !!e && visible(e.id))
    .sort((a, b) => a.t - b.t);
}

/**
 * Glides take time in proportion to the years they cover (at least a second
 * each), holds are fixed; the glide speed is chosen so the whole tour lands
 * between `minTotal` and `maxTotal` seconds.
 */
export function buildTour(stops: readonly TourStop[], opts: TourOptions): TourPlan {
  const hold = opts.hold ?? 2.2;
  const minTotal = opts.minTotal ?? 62;
  const maxTotal = opts.maxTotal ?? 86;
  if (!stops.length) return { segments: [], total: 0 };
  const points = [opts.from, ...stops.map((s) => s.t)];
  const spans = stops.map((s, i) => Math.abs(s.t - points[i]));
  const years = spans.reduce((a, b) => a + b, 0);
  const holds = hold * stops.length;
  const MIN_GLIDE = 1;
  // Glide seconds per year, fitted to the target length (the midpoint of the window).
  const target = (minTotal + maxTotal) / 2;
  let perYear = years > 0 ? Math.max(0, target - holds - MIN_GLIDE * stops.length) / years : 0;
  perYear = Math.min(perYear, 4);
  const segments: TourSegment[] = [];
  let at = 0;
  stops.forEach((s, i) => {
    const dur = MIN_GLIDE + spans[i] * perYear;
    segments.push({ kind: "glide", from: points[i], to: s.t, start: at, dur, id: s.id });
    at += dur;
    segments.push({ kind: "hold", from: s.t, to: s.t, start: at, dur: hold, id: s.id });
    at += hold;
  });
  return { segments, total: at };
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export interface TourState {
  /** Where the camera's focus should be now. */
  t: number;
  /** The moment being held on, if any. */
  holding: string | null;
  /** The moment ahead (or held on). */
  next: string | null;
  index: number;
  done: boolean;
}

export function tourAt(plan: TourPlan, elapsed: number): TourState {
  const segs = plan.segments;
  if (!segs.length) return { t: 0, holding: null, next: null, index: -1, done: true };
  if (elapsed >= plan.total) {
    const last = segs[segs.length - 1];
    return { t: last.to, holding: null, next: null, index: segs.length - 1, done: true };
  }
  const e = Math.max(0, elapsed);
  let i = 0;
  while (i < segs.length - 1 && e >= segs[i].start + segs[i].dur) i++;
  const s = segs[i];
  const k = s.dur > 0 ? Math.min(1, (e - s.start) / s.dur) : 1;
  const t = s.kind === "hold" ? s.to : s.from + (s.to - s.from) * easeInOut(k);
  return { t, holding: s.kind === "hold" ? s.id : null, next: s.id, index: i, done: false };
}
