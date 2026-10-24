/**
 * PokéGuessr's play settings, GeoGuessr's "No move / Zoomed / Timer": one
 * screenshot with no looking around, a zoomed-in crop of it, and a clock per
 * round. They only make a game harder, so scores stay comparable and the
 * boards are shared. Kept on this device.
 */

export const GEO_TIMERS = [0, 30, 60, 90] as const;
export type GeoTimer = (typeof GEO_TIMERS)[number];

export interface GeoPlaySettings {
  /** One screenshot per round: no flipping through the place's other views. */
  noMove: boolean;
  /** A zoomed-in crop of the screenshot instead of all of it. */
  zoomed: boolean;
  /** Seconds per round (0: no clock). */
  timer: GeoTimer;
}

export const DEFAULT_GEO_SETTINGS: GeoPlaySettings = { noMove: false, zoomed: false, timer: 0 };

/** How far the zoomed crop is blown up. */
export const GEO_ZOOM = 2.5;

const isTimer = (v: unknown): v is GeoTimer => GEO_TIMERS.includes(v as GeoTimer);

/** Settings from storage or a URL, with anything unknown left at its default. */
export function parseGeoSettings(raw: unknown): GeoPlaySettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    noMove: o.noMove === true,
    zoomed: o.zoomed === true,
    timer: isTimer(o.timer) ? o.timer : 0,
  };
}

/** A short summary for the settings button, or null when every setting is off. */
export function geoSettingsBadge(s: GeoPlaySettings): string | null {
  const parts = [s.zoomed && "Zoomed", s.timer > 0 && `${s.timer}s`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

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

export function readGeoSettings(): GeoPlaySettings {
  try {
    return parseGeoSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return DEFAULT_GEO_SETTINGS;
  }
}

export function rememberGeoSettings(s: GeoPlaySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode: the settings last for this visit.
  }
}
