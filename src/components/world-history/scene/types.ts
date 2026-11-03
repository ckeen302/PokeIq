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
}

export const QUALITY: Record<Quality, Spec> = {
  draft: { pr: 0.6, msaa: 0, bloom: false, rays: false, particles: 0.12, segments: 40, texSize: 256, aniso: 1, grid: 48 },
  low: { pr: 1, msaa: 0, bloom: false, rays: false, particles: 0.35, segments: 64, texSize: 256, aniso: 2, grid: 96 },
  medium: { pr: 1.25, msaa: 4, bloom: true, rays: true, particles: 0.7, segments: 96, texSize: 512, aniso: 4, grid: 160 },
  high: { pr: 1.75, msaa: 4, bloom: true, rays: true, particles: 1, segments: 120, texSize: 512, aniso: 8, grid: 220 },
  export: { pr: 1, msaa: 4, bloom: true, rays: true, particles: 1, segments: 140, texSize: 512, aniso: 8, grid: 240 },
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
