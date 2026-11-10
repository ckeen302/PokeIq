import type { Motion } from "@/lib/race/types";

/**
 * An athlete's pose for one frame, as plain numbers (no three.js): the
 * event motions (scene/motions) compute it from the physics, and
 * scene/actors applies it to the figure's rig.
 */

export interface LimbSet {
  /** Forward swing about the stride axis (rad) and the bend of the far half (knees, elbows). */
  a: number;
  b: number;
  /** 0: the gait's angles, 1: these. */
  k: number;
  /** Legs only: how far apart the two legs split (rad, + front leg forward). */
  split?: number;
}

export interface ActorPose {
  visible: boolean;
  /** The ground point under the figure (its base), world metres. */
  x: number;
  y: number;
  z: number;
  /** Direction of travel in the ground plane (unit). */
  dx: number;
  dz: number;
  /** Forward lean about the lateral axis (rad). */
  lean: number;
  /** Rotation in the figure's own plane (rad, + head back), about `pivot` (share of height). */
  roll: number;
  pivot?: number;
  /** Side-to-side sway about the direction of travel (rad). */
  sway?: number;
  /** Drawn at this share of its real size (the medal ceremony, where a giant would hide the others). Default 1. */
  scale?: number;
  /** − squash, + stretch. */
  squash: number;
  /** Extra turn about the vertical (rad): π turns its back on its direction of travel. */
  turn?: number;
  /** How far past the camera its plane turns towards its direction of travel (default 0.32; 1 is three quarters on: two wrestlers face each other instead of both facing the lens). */
  headOn?: number;
  /** Locked facing: the figure's plane faces this direction (unit) instead of the camera. */
  faceDir?: [number, number] | null;
  /** The gait that swings its limbs, if any. */
  gait: { motion: Motion; phase: number; v: number; a?: number } | null;
  legs?: LimbSet;
  arms?: LimbSet;
  wings?: LimbSet;
  tail?: LimbSet;
  /** Arms up in the figure's plane (0..1): overhead, or celebrating. */
  raise?: number;
  /** Arch of the body (share of its height; + belly out). */
  bend?: number;
  /** A shake (m) of the whole figure (a held weight). */
  shake?: number;
  /** Ground shadow (0..1) and the height it falls on. */
  shadow?: number;
  ground?: number;
  /** Swimmer's body wave: amplitude (share of length), waves along the body, phase, style (1 carangiform, 2 anguilliform). */
  swim?: { amp: number; waves: number; phase: number; style: 1 | 2 } | null;
  /** Clip the figure below this world height (under water). */
  clipY?: number;
  /** Seen through the water below clipY instead of cut there: the water's clarity (1 the pool's; more is murkier). */
  under?: number;
}

export const restPose = (x = 0, z = 0): ActorPose => ({ visible: true, x, y: 0, z, dx: 1, dz: 0, lean: 0, roll: 0, squash: 0, gait: null });
