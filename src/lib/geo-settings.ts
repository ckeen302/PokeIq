/**
 * PokéGuessr's play settings, GeoGuessr's "No move / Zoomed / Timer": one
 * screenshot with no looking around, a zoomed-in crop of it, and a clock per
 * round. They only make a game harder, so scores stay comparable and the
 * boards are shared. Kept on this device.
 */

/** The round timer's choices for practice games (seconds; 0 is Off), GeoGuessr's 1:30 the default. */
export const GEO_TIMERS = [0, 60, 90, 180] as const;
export type GeoTimer = (typeof GEO_TIMERS)[number];
/** GeoGuessr's round clock: the default for practice, and always the Daily's and the Weekly's. */
export const GEO_DEFAULT_TIMER: GeoTimer = 90;
/** What the server takes: today's choices, and 30 s from before (a page still open from an older version). */
export const GEO_TIMERS_ACCEPTED: readonly number[] = [30, 60, 90, 180];

export interface GeoPlaySettings {
  /** One screenshot per round: no flipping through the place's other views. */
  noMove: boolean;
  /** A zoomed-in crop of the screenshot instead of all of it. */
  zoomed: boolean;
  /** Seconds per round (0: no clock). */
  timer: GeoTimer;
}

export const DEFAULT_GEO_SETTINGS: GeoPlaySettings = { noMove: false, zoomed: false, timer: GEO_DEFAULT_TIMER };

/** How far the zoomed crop is blown up. */
export const GEO_ZOOM = 2.5;

const isTimer = (v: unknown): v is GeoTimer => GEO_TIMERS.includes(v as GeoTimer);

/** Settings from storage or a URL, with anything unknown left at its default. */
export function parseGeoSettings(raw: unknown): GeoPlaySettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    noMove: o.noMove === true,
    zoomed: o.zoomed === true,
    timer: isTimer(o.timer) ? o.timer : GEO_DEFAULT_TIMER,
  };
}

/** A short summary for the settings button (the timer has its own picker in the setup), or null when every setting is off. */
export function geoSettingsBadge(s: GeoPlaySettings): string | null {
  return s.zoomed ? "Zoomed" : null;
}

/** A clock's time as GeoGuessr writes it: "01:30". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** A timer choice's label: "Off" comes from the page's text; the rest read "1:00", "1:30", "3:00". */
export const timerLabel = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The views a round shows: all of them, or with No move just the dealt one. */
export const visibleViews = (views: string[], s: Pick<GeoPlaySettings, "noMove">) => (s.noMove ? views.slice(0, 1) : views);

/**
 * Where the zoomed crop sits on a screenshot, as percentages: picked from the
 * screenshot's URL, so it's the same spot every time it comes up, and kept
 * off the edges, where there's often nothing but a border.
 */
export function zoomOrigin(src: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  const x = 25 + ((h >>> 0) % 51);
  const y = 25 + ((h >>> 8) % 51);
  return [x, y];
}

/** Whole seconds left on a round's clock (never below 0). */
export function secondsLeft(startedAt: number, now: number, timer: number): number {
  return Math.max(0, Math.ceil((startedAt + timer * 1000 - now) / 1000));
}

const KEY = "piq_geo_settings";
/**
 * The timer is kept on its own: the old settings stored "no timer" for
 * everyone who ever touched Zoomed, and 1:30 is now the default for them too.
 */
const TIMER_KEY = "pokeiq:geo-timer";

export function readGeoSettings(): GeoPlaySettings {
  let stored: unknown = {};
  let timer: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    // Unreadable or private mode: the defaults.
  }
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    timer = raw === null ? undefined : Number(raw);
  } catch {
    // Private mode: the default timer.
  }
  return { ...parseGeoSettings(stored), timer: isTimer(timer) ? timer : GEO_DEFAULT_TIMER };
}

export function rememberGeoSettings(s: GeoPlaySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ noMove: s.noMove, zoomed: s.zoomed }));
    localStorage.setItem(TIMER_KEY, String(s.timer));
  } catch {
    // Private mode: the settings last for this visit.
  }
}
