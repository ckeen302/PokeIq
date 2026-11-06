import type * as THREE from "three";
import type { OrbitLimits, Pose, Vec3 } from "@/lib/world-history/camera";
import type { ChapterTime } from "@/lib/world-history/timing";
import type { Chapter } from "@/lib/world-history/types";
import type { FigureFactory } from "./figures";

/** "draft" is for automated checks on machines without a GPU: never offered to people. */
export type Quality = "draft" | "low" | "medium" | "high" | "export";

export interface Spec {
  /** Pixel ratio cap. */
  pr: number;
  msaa: number;
  bloom: boolean;
  /** Screen-space light shafts from the brightest source. */
  rays: boolean;
  /** Share of each effect's particles drawn. */
  particles: number;
  /** Relief mesh resolution (cells on the long side). */
  segments: number;
  texSize: 256 | 512;
  aniso: number;
  /** Terrain and ocean grid resolution. */
  grid: number;
  /** Key-light shadow map size (0: no shadows). */
  shadow: 0 | 1024 | 2048;
  /** A depth texture for the lens pass (height fog); depth of field and camera motion blur need `lens` too. */
  depth: boolean;
  /** Depth of field and camera motion blur (the costly lens effects). */
  lens: boolean;
}

export const QUALITY: Record<Quality, Spec> = {
  draft: { pr: 0.6, msaa: 0, bloom: false, rays: false, particles: 0.12, segments: 40, texSize: 256, aniso: 1, grid: 48, shadow: 0, depth: false, lens: false },
  low: { pr: 1, msaa: 0, bloom: false, rays: false, particles: 0.35, segments: 64, texSize: 256, aniso: 2, grid: 96, shadow: 0, depth: false, lens: false },
  medium: { pr: 1.25, msaa: 4, bloom: true, rays: true, particles: 0.7, segments: 96, texSize: 512, aniso: 4, grid: 160, shadow: 1024, depth: true, lens: false },
  high: { pr: 1.75, msaa: 4, bloom: true, rays: true, particles: 1, segments: 120, texSize: 512, aniso: 8, grid: 220, shadow: 2048, depth: true, lens: true },
  export: { pr: 1, msaa: 4, bloom: true, rays: true, particles: 1, segments: 140, texSize: 512, aniso: 8, grid: 240, shadow: 2048, depth: true, lens: true },
};

/** A chapter's grade and lens, keyed over its anim clock. */
export interface Look {
  exposure: number;
  bloom: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** Colour gain (multiplies), lift (adds in the shadows). */
  gain: Vec3;
  lift: Vec3;
  saturation: number;
  contrast: number;
  vignette: number;
  /** Chromatic aberration (0 none … 1 strong). */
  chroma: number;
  /** A white flash (0..1) and a fade to black (0..1). */
  flash: number;
  fade: number;
  /** Light shafts from a point in the world. */
  rays?: { pos: Vec3; strength: number; color: Vec3 };
  /** Film grain. */
  grain: number;

  // ---- Opt-in (absent: the original look, unchanged).
  /**
   * Tone curve. "aces" (default): the original per-channel fit. "filmic":
   * the fuller ACES fit (bright saturated colours roll off toward white
   * instead of clipping to pure hues), with contrast, lift and saturation
   * applied on display values, so contrast > 1 deepens shadows without
   * crushing dark channels to 0. "agx": AgX, softer and more neutral.
   */
  tone?: "aces" | "filmic" | "agx";
  /** How much of `tone` is used (0..1, default 1; blends from the original curve, for transitions). */
  toneMix?: number;
  /**
   * Height fog in the lens pass (medium and up): densest at and below
   * `height`, thinning above it at `falloff` per unit; `sun` brightens the
   * fog toward a light (a cheap in-scatter), `sky` (0..1) how much of the
   * fog reaches the sky dome at the horizon.
   */
  fog?: { color: Vec3; density: number; height: number; falloff: number; sun?: { dir: Vec3; color: Vec3 }; sky?: number };
  /** Depth of field (high only): the focus distance from the camera, or a point to focus on; `k` 0..1 is the aperture (0 off). */
  dof?: { focus: number | Vec3; k: number };
  /** Camera motion blur strength on fast moves (high only; 1 is a 180° shutter). */
  mblur?: number;
  /** A whip-pan smear (medium and up): screen direction and strength 0..1. */
  whip?: { dir: [number, number]; k: number };
  /** Anamorphic streak on hot lights (medium and up): strength, and tint. */
  streak?: number;
  streakColor?: Vec3;
  /** Chromatic fringing at the frame's edges only (0..1). */
  fringe?: number;
  /**
   * Hot sources keep their colour (0..1, filmic and agx only): highlights
   * roll off on luminance with the hue held, whitening only far above
   * white, instead of each channel clipping to a flat white disc.
   */
  hueKeep?: number;
  /** A display-space black point (0..0.2): the darkest values go to real black. */
  black?: number;
  /** Split toning (display space, small values): a tint added to the shadows and one to the highlights. */
  split?: { shadows: Vec3; highlights: Vec3 };
  /**
   * Bloom on what is over the threshold only (0..1, 1: subtract the
   * threshold, so broad bright areas glow softly and only hot cores
   * flare), with each pixel's bloom capped at `bloomCap` (luminance), so a
   * large bright area can't box out the frame.
   */
  bloomKnee?: number;
  bloomCap?: number;
  /**
   * `flash` as a punch of light in HDR (exposure up, highlights flare)
   * instead of a mix toward white, so a flash never lays a grey veil over
   * the blacks.
   */
  flashHdr?: boolean;
}

export const BASE_LOOK: Look = {
  exposure: 1,
  bloom: 0.7,
  bloomRadius: 0.55,
  bloomThreshold: 0.82,
  gain: [1, 1, 1],
  lift: [0, 0, 0],
  saturation: 1.05,
  contrast: 1.05,
  vignette: 0.35,
  chroma: 0,
  flash: 0,
  fade: 0,
  grain: 0.04,
};

export interface ChapterCtx {
  renderer: THREE.WebGLRenderer;
  q: Spec;
  chapter: Chapter;
  timing: ChapterTime;
  /** Anim time a beat's caption appears (the chapter's start if the beat isn't in the film). */
  beat(id: string): number;
  figures: FigureFactory;
  /** The film's serif (for words drawn into a scene: journal pages, plaques). */
  font: string;
  signal: AbortSignal;
}

export interface ChapterRig {
  scene: THREE.Scene;
  /** The film's camera at anim time t (lens as designed for 16:9). */
  camera(t: number): Pose;
  /** Animates the scene to anim time t (ambient: a free-running clock for idle motion; viewH: drawing-buffer height in px, for point sizes). */
  update(t: number, ambient: number, camera: THREE.PerspectiveCamera, viewH: number): void;
  look(t: number): Look;
  /** Free look: what to orbit around at t, and how far it may turn. */
  orbit(t: number): { target: Vec3; limits: OrbitLimits };
  /** Chapter units per hall metre when the chapter is seen through its doorway (bigger: a vaster diorama). */
  portalScale?: number;
  dispose(): void;
}

export type ChapterBuilder = (ctx: ChapterCtx) => Promise<ChapterRig>;
