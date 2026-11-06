import { blendPose, fovToFit, type CamPose, type Vec3 } from "@/lib/race/director";

/**
 * Camera helpers for the event directors: a broadcast camera at an
 * offset from what it watches, framed to fit a subject (the Race's
 * fovToFit), on long lenses for tracking shots and wider for the venue.
 * Pure.
 */

export { blendPose, fovToFit };
export type { CamPose, Vec3 };

export const DEG = Math.PI / 180;

/** A camera at `pos` framing a subject of `w` × `h` metres centred at `target`. */
export function framed(pos: Vec3, target: Vec3, w: number, h: number, aspect: number, min = 6, max = 62): CamPose {
  const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  return { pos, target, fov: fovToFit(w, h, d, aspect, min, max) };
}

/** A point at a distance and bearing (radians from +x, round towards +z) from a centre, at a height. */
export const around = (c: Vec3, dist: number, bearing: number, y: number): Vec3 => [c[0] + Math.cos(bearing) * dist, y, c[2] + Math.sin(bearing) * dist];

/** On a phone (a tall frame) cameras stand further back. */
export const tall = (aspect: number) => aspect < 0.9;

export const mixPose = (a: CamPose, b: CamPose, k: number): CamPose => blendPose(a, b, k);

/** An establishing crane: from high and wide down onto a point. */
export function crane(target: Vec3, k: number, aspect: number, o: { from: Vec3; to: Vec3; fov0?: number; fov1?: number }): CamPose {
  const e = k * k * (3 - 2 * k);
  const pos: Vec3 = [o.from[0] + (o.to[0] - o.from[0]) * e, o.from[1] + (o.to[1] - o.from[1]) * e, o.from[2] + (o.to[2] - o.from[2]) * e];
  const fov0 = (o.fov0 ?? 50) * (tall(aspect) ? 1.3 : 1), fov1 = (o.fov1 ?? 34) * (tall(aspect) ? 1.35 : 1);
  return { pos, target, fov: Math.min(75, fov0 + (fov1 - fov0) * e) };
}

/** A slow drift (a hand-held operator holding a shot). */
export function drift(p: CamPose, t: number, k = 0.04): CamPose {
  return { ...p, pos: [p.pos[0] + Math.sin(t * 0.37) * k * 3, p.pos[1] + Math.sin(t * 0.53 + 1) * k, p.pos[2] + Math.cos(t * 0.29) * k * 3] };
}
