import { BASE_YAW, ORBIT_LIMIT, pitchFor, type View } from "./camera";
import { frameDistance, viewWidth, type Framer, type Lens } from "./glide";
import { ROOF_Y, STREET } from "./world";

/**
 * Explore and Compare on /pokedex/sizes, as plain math (unit-tested): the
 * camera follows a point on the line, at the distance that frames whatever
 * stands there; drags, wheel turns and keys move that point; a search flies
 * it to a figure (passing over everything in between, so the camera rises
 * and settles on the way); Compare frames the whole comparison at once.
 *
 * On top of that automatic framing the visitor has a look of their own: a
 * zoom (a multiple of the framing, from a close-up on a 10 cm Pokémon out to
 * a drone's view of the crowd), a tilt (the camera rises and looks down, or
 * drops and looks up) and a modest orbit round the figure. Every part of the
 * camera eases towards its target with frame-rate-independent damping, and
 * drags and flicks coast to a stop.
 */

export interface Flight {
  from: number;
  to: number;
  /** Start time and length (seconds). */
  t0: number;
  dur: number;
}

/** A flight's length: longer for longer trips, but never a chore (1–3.2 s). */
export function flightSeconds(from: number, to: number, viewW: number): number {
  const screens = Math.abs(to - from) / Math.max(0.05, viewW);
  return Math.min(3.2, Math.max(1, 0.9 + 0.55 * Math.log2(1 + screens)));
}

/** Eases out of rest and into rest (smootherstep). */
export const easeFlight = (f: number) => {
  const k = Math.max(0, Math.min(1, f));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

export function flightAt(f: Flight, t: number): { x: number; done: boolean } {
  const k = f.dur > 0 ? (t - f.t0) / f.dur : 1;
  if (k >= 1) return { x: f.to, done: true };
  return { x: f.from + (f.to - f.from) * easeFlight(k), done: false };
}

// ---------------------------------------------------------------------------
// The visitor's look: zoom, tilt and orbit
// ---------------------------------------------------------------------------

export interface Look {
  /** Magnification over the automatic framing: 2 is twice as close, 0.1 ten times further back. */
  zoom: number;
  /** Extra downward tilt (radians) over the natural one; negative looks up. */
  tilt: number;
  /** Yaw round the framed point (radians). */
  orbit: number;
}

export const DEFAULT_LOOK: Look = { zoom: 1, tilt: 0, orbit: 0 };

/** Closest: a 10 cm Pokémon overfills the frame. */
export const ZOOM_MAX = 2.4;
/** Furthest: some 25 framings back, where dozens of figures read as a crowd. */
export const ZOOM_MIN = 0.04;
/** The camera never goes further than this (m) from what it frames, or the city's edge and the haze would show. */
export const MAX_DISTANCE = 700;
/** Nor nearer than this (m). */
export const MIN_DISTANCE = 0.06;

export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(z) ? z : 1));
export const clampOrbit = (o: number) => Math.max(-ORBIT_LIMIT, Math.min(ORBIT_LIMIT, Number.isFinite(o) ? o : 0));

/** The camera's distance for a framing distance and a zoom (capped, so a zoom-out over the giants stays inside the city). */
export function zoomedDistance(dAuto: number, zoom: number): number {
  const d = dAuto / clampZoom(zoom);
  return Math.max(MIN_DISTANCE, Math.min(Math.max(dAuto, MAX_DISTANCE), d));
}

/** The zoom actually on screen: the framing distance over the camera's. */
export const effectiveZoom = (dAuto: number, d: number) => dAuto / Math.max(1e-6, d);

/** The furthest-out zoom that still means something here (beyond it the distance cap holds the camera). */
export const zoomFloorAt = (dAuto: number) => Math.max(ZOOM_MIN, Math.min(1, dAuto / MAX_DISTANCE));

/** How far towards the widest view a zoom is (0 at the framing or closer, 1 at ZOOM_MIN), on a log scale. */
export function zoomOutness(zoom: number): number {
  if (zoom >= 1) return 0;
  return Math.min(1, Math.log(1 / Math.max(ZOOM_MIN, zoom)) / Math.log(1 / ZOOM_MIN));
}

const smooth01 = (f: number) => { const k = Math.max(0, Math.min(1, f)); return k * k * (3 - 2 * k); };

/**
 * Pulling back also lifts the camera, like a drone: by the widest view it
 * looks down on the line at about 30°, clear of the rooftops either side of
 * the boulevard, so the crowd reads instead of hiding behind its front row.
 */
export const zoomPitch = (zoom: number) => 0.52 * smooth01(zoomOutness(zoom));

/**
 * The tilts the relief figures can take: from a little below (a hero shot)
 * to about 32° above up close, and further down onto the crowd when zoomed
 * out (where the figures are small and the camera must clear the roofs).
 */
export function pitchRange(zoom: number): [number, number] {
  const k = smooth01(zoomOutness(zoom));
  return [-0.1 + 0.42 * k, 0.56 + 0.44 * k];
}

/** The camera's tilt for a framed height, zoom and the visitor's own tilt, kept inside the safe range. */
export function lookPitch(h: number, zoom: number, tilt: number): number {
  const [lo, hi] = pitchRange(zoom);
  return Math.max(lo, Math.min(hi, pitchFor(h) + zoomPitch(zoom) + tilt));
}

/** Keeps the visitor's tilt inside what lookPitch allows here (so dragging past a limit never winds up). */
export function clampTilt(tilt: number, h: number, zoom: number): number {
  const [lo, hi] = pitchRange(zoom);
  const base = pitchFor(h) + zoomPitch(zoom);
  return Math.max(lo - base, Math.min(hi - base, Number.isFinite(tilt) ? tilt : 0));
}

/**
 * Over the rooftops: a camera pulled back past the near facades looks over
 * them, not through them. The sight line from the camera to the framed
 * point crosses the facade line at a height of h/2 + F·tan(pitch)/cos(yaw),
 * whatever the distance, so clearing the roof takes a fixed least pitch. It
 * comes in gradually as the camera nears the facades.
 */
export function clearancePitch(d: number, h: number, orbit: number, pitch: number): number {
  const cy = Math.cos(BASE_YAW + clampOrbit(orbit));
  const need = Math.atan((Math.max(0, ROOF_Y + 3 - h / 2) * cy) / STREET.facade);
  if (need <= pitch) return pitch;
  // How far out from the line the camera stands, at the pitch it has.
  const reach = d * Math.cos(pitch) * cy;
  return pitch + (need - pitch) * smooth01((reach - (STREET.facade - 14)) / 12);
}

/** The Explore camera at a point on the line, with the visitor's look. */
export function exploreView(x: number, fr: Framer, heightAt: (x: number) => number, look: Look = DEFAULT_LOOK): View {
  const h = heightAt(x);
  const d = zoomedDistance(fr.at(x), look.zoom);
  const orbit = clampOrbit(look.orbit);
  let pitch = lookPitch(h, look.zoom, look.tilt);
  // At the automatic framing the city's cutaway clears the way (as in Play); pulled back, the camera rises over the roofs instead.
  const k = smooth01(zoomOutness(look.zoom) * 4);
  if (k > 0) pitch += (clearancePitch(d, h, orbit, pitch) - pitch) * k;
  return { x, d, h, orbit, pitch, rise: 0 };
}

// ---------------------------------------------------------------------------
// Input mapping
// ---------------------------------------------------------------------------

/** Metres along the line for a drag of `px` screen pixels at the current framing (the line follows the finger). */
export function dragMetres(px: number, screenW: number, d: number, lens: Lens): number {
  return (-px / Math.max(1, screenW)) * viewWidth(d, lens);
}

/** Pixels for a wheel delta in any delta mode (lines are about 16 px, pages a screen), capped per event. */
export function wheelPixels(delta: number, mode: number, screen: number): number {
  const px = delta * (mode === 1 ? 16 : mode === 2 ? Math.max(100, screen) : 1);
  return Math.max(-240, Math.min(240, px));
}

/** Log-zoom change for a wheel turn of `px` pixels: a mouse notch (100 px) is about 16%; a pinch (ctrl+wheel) is more sensitive. */
export function wheelZoom(px: number, pinch: boolean): number {
  return -px * (pinch ? 0.011 : 0.0015);
}

/** Log-zoom change for a press of + or − (keys) and the on-screen buttons. */
export const ZOOM_STEP_KEY = Math.log(1.3);
export const ZOOM_STEP_BUTTON = Math.log(1.6);

/** Radians of orbit and tilt per pixel of drag. */
export const ORBIT_PER_PX = 0.0042;
export const TILT_PER_PX = 0.0036;

/**
 * Where the camera's point on the line goes when the zoom changes by `ratio`
 * with the pointer `offset` pixels from the frame's centre: the spot under
 * the pointer stays under it, as on a map.
 */
export function zoomAnchorShift(offset: number, screenW: number, d: number, ratio: number, lens: Lens): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const before = viewWidth(d, lens);
  const after = viewWidth(d / ratio, lens);
  return (offset / Math.max(1, screenW)) * (before - after);
}

/** Pinch on a touch screen: the zoom follows the fingers' spread. */
export function pinchZoom(startLogZoom: number, startSpread: number, spread: number): number {
  return startLogZoom + Math.log(Math.max(1, spread) / Math.max(1, startSpread));
}

/** The smallest signed difference between two angles (radians). */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------
// Motion: damping and inertia
// ---------------------------------------------------------------------------

/**
 * Exponential approach of `cur` to `target` at `rate` per second. Frame-rate
 * independent: two steps of dt land exactly where one step of 2·dt does.
 */
export function damp(cur: number, target: number, rate: number, dt: number): number {
  if (dt <= 0) return cur;
  return target + (cur - target) * Math.exp(-rate * dt);
}

/**
 * Inertia: a velocity that fades at `friction` per second carries the target
 * on. Exact over any step, so a flick travels vel / friction in total
 * whatever the frame rate.
 */
export function coast(target: number, vel: number, friction: number, dt: number): { target: number; vel: number } {
  if (dt <= 0 || vel === 0) return { target, vel };
  const k = Math.exp(-friction * dt);
  const next = Math.abs(vel * k) < 1e-6 ? 0 : vel * k;
  return { target: target + (vel * (1 - k)) / friction, vel: next };
}

/**
 * Velocity of a drag from its recent samples (time ms, value): the slope over
 * the last `windowMs`, or nothing if the pointer had stopped before release.
 */
export function releaseVelocity(samples: { t: number; v: number }[], now: number, windowMs = 90): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (now - last.t > 70) return 0;
  let first = last;
  for (let i = samples.length - 1; i >= 0 && last.t - samples[i].t <= windowMs; i--) first = samples[i];
  const dt = (last.t - first.t) / 1000;
  return dt > 0.008 ? (last.v - first.v) / dt : 0;
}

/** Damping rates (per second) of each part of the camera, and the friction of a flick. */
export const RATE = { x: 9, zoom: 8, tilt: 10, orbit: 10 } as const;
export const FRICTION = { x: 3.2, tilt: 5, orbit: 5 } as const;

/** Keeps the camera's point on the line, with a little room past each end. */
export function clampX(x: number, first: { x: number; w: number }, last: { x: number; w: number }): number {
  return Math.max(first.x - first.w, Math.min(last.x + last.w * 0.5, x));
}

/** The figure to step to from `i` (arrow keys), staying on the line. */
export function stepIndex(i: number, dir: number, n: number): number {
  return Math.max(0, Math.min(n - 1, i + dir));
}

/** How many badges the frame holds at a zoom: fewer as the view widens, down to the framed figure's own. */
export function badgeBudget(zoom: number, phone: boolean): number {
  const full = phone ? 2 : 4;
  if (zoom >= 0.7) return full;
  if (zoom >= 0.35) return Math.max(1, full - 1);
  if (zoom >= 0.15) return Math.max(1, full - 2);
  return 1;
}

/** Badges shrink a little as the view widens (never below 70%), so a label never dwarfs a crowd of small figures. */
export const badgeScaleFor = (zoom: number) => 1 - 0.3 * zoomOutness(zoom);

/**
 * Compare's overview: the camera centred on the comparison and far enough
 * back to take in every figure, the biggest filling about half the frame.
 */
export function overviewView(placed: { x: number; w: number; h: number }[], lens: Lens): View {
  if (!placed.length) return { x: 0, d: 2, h: 1, orbit: 0, pitch: pitchFor(1), rise: 0 };
  const left = placed[0].x - placed[0].w / 2;
  const right = placed[placed.length - 1].x + placed[placed.length - 1].w / 2;
  const tall = Math.max(...placed.map((p) => p.h));
  const x = (left + right) / 2;
  // The width fits the frame with a margin; the tallest figure leaves room for its badge.
  const d = Math.max(frameDistance(right - left, tall, lens) * 1.08, frameDistance(0, tall * 1.15, lens));
  return { x, d, h: tall * 0.9, orbit: 0, pitch: pitchFor(tall), rise: 0 };
}

/** The camera eases between two views (a Compare overview and an Explore point): blend in log distance. */
export function blendViews(a: View, b: View, k: number): View {
  const f = easeFlight(k);
  const mix = (p: number, q: number) => p + (q - p) * f;
  return {
    x: mix(a.x, b.x),
    d: Math.exp(mix(Math.log(a.d), Math.log(b.d))),
    h: Math.exp(mix(Math.log(Math.max(0.01, a.h)), Math.log(Math.max(0.01, b.h)))),
    orbit: mix(a.orbit, b.orbit),
    pitch: mix(a.pitch, b.pitch),
    rise: mix(a.rise, b.rise),
  };
}
