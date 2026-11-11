import { blendPose, fillTall, fovToFit, insideBowl, type CamPose, type Vec3 } from "@/lib/race/director";
import { BOWL, barrierZ } from "@/lib/race/track";

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
  // (From inside the bowl, never from out over its dark roof.)
  o = { ...o, from: insideBowl(o.from), to: insideBowl(o.to) };
  const pos: Vec3 = [o.from[0] + (o.to[0] - o.from[0]) * e, o.from[1] + (o.to[1] - o.from[1]) * e, o.from[2] + (o.to[2] - o.from[2]) * e];
  const fov0 = (o.fov0 ?? 50) * (tall(aspect) ? 1.3 : 1), fov1 = (o.fov1 ?? 34) * (tall(aspect) ? 1.35 : 1);
  return { pos, target, fov: Math.min(75, fov0 + (fov1 - fov0) * e) };
}

/**
 * Keeps a camera out of the stands indoors: in the arena inside the field
 * of play (the first row is 15 m out), at the pool over the deck (the
 * stands start 17 m out). A camera that wanted to stand further back
 * climbs instead, and widens to keep the same framing.
 */
export function keepOut(p: CamPose, venue: "stadium" | "arena" | "pool"): CamPose {
  if (venue === "stadium") return p;
  let [x, y, z] = p.pos;
  let excess = 0;
  if (venue === "arena") {
    const lim = 13.6;
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m > lim) { excess = m - lim; x *= lim / m; z *= lim / m; }
  } else {
    const lim = 15.6;
    if (Math.abs(z) > lim) { excess = Math.abs(z) - lim; z = Math.sign(z) * lim; }
    if (Math.abs(x) > 38) { excess = Math.max(excess, Math.abs(x) - 38); x = Math.sign(x) * 38; }
  }
  if (excess <= 0) return p;
  y += excess * 0.75;
  const d0 = Math.hypot(p.pos[0] - p.target[0], p.pos[1] - p.target[1], p.pos[2] - p.target[2]);
  const d1 = Math.hypot(x - p.target[0], y - p.target[1], z - p.target[2]);
  const half = Math.atan(Math.tan((p.fov * DEG) / 2) * (d0 / Math.max(0.5, d1)));
  return { pos: [x, y, z], target: p.target, fov: Math.min(80, (2 * half) / DEG) };
}

/** A slow drift (a hand-held operator holding a shot). */
export function drift(p: CamPose, t: number, k = 0.04): CamPose {
  return { ...p, pos: [p.pos[0] + Math.sin(t * 0.37) * k * 3, p.pos[1] + Math.sin(t * 0.53 + 1) * k, p.pos[2] + Math.cos(t * 0.29) * k * 3] };
}

/** Keeps a low camera on the stadium's field of play: one that wanted to stand back in the stands (behind a giant) climbs instead, and widens to keep the same framing. */
export function keepOnField(p: CamPose): CamPose {
  let [x, y, z] = p.pos;
  if (y > 30) return p;
  let excess = 0;
  const ax = BOWL.A - 5;
  if (Math.abs(x) > ax) { excess = Math.abs(x) - ax; x = Math.sign(x) * ax; }
  const bz = barrierZ(x) - 2;
  if (Math.abs(z) > bz) { excess = Math.max(excess, Math.abs(z) - bz); z = Math.sign(z) * bz; }
  if (excess <= 0) return p;
  y += excess * 0.6;
  const d0 = Math.hypot(p.pos[0] - p.target[0], p.pos[1] - p.target[1], p.pos[2] - p.target[2]);
  const d1 = Math.hypot(x - p.target[0], y - p.target[1], z - p.target[2]);
  const half = Math.atan(Math.tan((p.fov * DEG) / 2) * (d0 / Math.max(0.5, d1)));
  return { pos: [x, y, z], target: p.target, fov: Math.min(75, (2 * half) / DEG) };
}

/** A thing a tall frame is framed on: its ground point, width and height (m), and how much it counts (0..1). */
export interface Subject { x: number; y: number; z: number; w: number; h: number; weight?: number }

/** In a tall frame (a phone held upright, a 9:16 video): the same camera, aimed and zoomed so its subjects fill the frame. */
export function fillFrame(p: CamPose, subjects: Subject[], aspect: number, fillH = 0.42): CamPose {
  if (!tall(aspect) || !subjects.length) return p;
  return fillTall(p.pos, subjects, aspect, { weights: subjects.map((s) => s.weight ?? 1), fillH, minFov: 7, maxFov: 62 });
}
