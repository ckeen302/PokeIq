import type { CamPose, Vec3 } from "./director";

/**
 * The free camera after (or during) the race: orbit around a target with
 * drag, zoom with the wheel, a trackpad pinch (ctrl + wheel), Safari's
 * gesture pinch, a two-finger pinch or the +/− buttons. Plain math,
 * unit-tested; the page turns input into these calls.
 */

export interface Orbit {
  target: Vec3;
  /** Around the target, radians (0 looks from +z towards −z). */
  yaw: number;
  /** Above the horizon, radians. */
  pitch: number;
  /** Distance from the target (m). */
  dist: number;
  fov: number;
}

export const ORBIT_LIMITS = { minDist: 1.2, maxDist: 260, minPitch: 0.02, maxPitch: 1.5 } as const;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function orbitPose(o: Orbit): CamPose {
  const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
  const pos: Vec3 = [o.target[0] + Math.sin(o.yaw) * cp * o.dist, o.target[1] + sp * o.dist, o.target[2] + Math.cos(o.yaw) * cp * o.dist];
  return { pos, target: [...o.target] as Vec3, fov: o.fov };
}

/** The orbit that reproduces a camera pose (to take over from the broadcast without a jump). */
export function orbitFrom(p: CamPose): Orbit {
  const dx = p.pos[0] - p.target[0], dy = p.pos[1] - p.target[1], dz = p.pos[2] - p.target[2];
  const dist = clamp(Math.hypot(dx, dy, dz), ORBIT_LIMITS.minDist, ORBIT_LIMITS.maxDist);
  return { target: [...p.target] as Vec3, yaw: Math.atan2(dx, dz), pitch: clamp(Math.asin(clamp(dy / Math.max(1e-6, Math.hypot(dx, dy, dz)), -1, 1)), ORBIT_LIMITS.minPitch, ORBIT_LIMITS.maxPitch), dist, fov: p.fov };
}

/** Drag: pixels across and up the view turn the camera around its target. */
export function orbitBy(o: Orbit, dxPx: number, dyPx: number, viewH: number): Orbit {
  const k = (Math.PI * 1.1) / Math.max(200, viewH);
  return { ...o, yaw: o.yaw - dxPx * k, pitch: clamp(o.pitch + dyPx * k, ORBIT_LIMITS.minPitch, ORBIT_LIMITS.maxPitch) };
}

/** Zoom by a factor (>1 moves in). */
export function zoomBy(o: Orbit, factor: number): Orbit {
  return { ...o, dist: clamp(o.dist / Math.max(0.05, factor), ORBIT_LIMITS.minDist, ORBIT_LIMITS.maxDist) };
}

/** A wheel event as a zoom factor: a mouse notch (~100 px) zooms about 12%; a trackpad pinch (ctrl + wheel, small deltas) tracks the fingers. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  const k = ctrlKey ? 0.012 : 0.0012;
  return Math.exp(-clamp(px, -400, 400) * k);
}

/** Lens zoom for the broadcast and head-on cameras: a factor on the field of view (>1 is tighter). */
export function zoomFov(fov: number, zoom: number): number {
  const t = Math.tan(((fov * Math.PI) / 180) / 2) / Math.max(0.05, zoom);
  return clamp((2 * Math.atan(t) * 180) / Math.PI, 3, 90);
}

export const ZOOM_LIMITS = { min: 0.45, max: 6 } as const;
export const clampZoom = (z: number) => clamp(z, ZOOM_LIMITS.min, ZOOM_LIMITS.max);
