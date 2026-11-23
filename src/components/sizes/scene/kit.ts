import type * as THREE from "three";
import type { Landmark, WorldPlan } from "@/lib/sizes/world";
import type { CityId } from "@/lib/sizes/cities";
import type { Shared } from "./shaders";

/**
 * A city the Sizes scene can stand its line in, besides Lumiose City (the
 * scene's own, built in when no kit is given). A kit brings its world (built
 * once per line on the same plan as Lumiose: the promenade, the plaza and
 * the ring round its landmark), its sky and its light; the scene keeps
 * everything else (the figures, the camera, the streaming, the post
 * effects). Each kit lives in its own module and is loaded only when its
 * city is chosen.
 */

/** A city's light and mood. */
export interface CityLook {
  /** The key light's height (radians) and colour; its direction round the figures is the scene's own (in front of them, to the camera's left). */
  sunElevation: number;
  sunColor: string;
  sunIntensity: number;
  /** Sky and ground fill. */
  hemi: { sky: string; ground: string; intensity: number };
  /** Haze (sRGB) and its density. */
  fog: { color: string; density: number };
  exposure: number;
  /** Image-based light from the kit's own environment. */
  envIntensity: number;
  /** The frame's finish: bloom (strength, radius, threshold) and grade. */
  post: { bloom: [number, number, number]; saturation: number; warmth: number; vignette: number };
}

export interface CityWorld {
  group: THREE.Group;
  /** Each frame before drawing: the camera's position and the shadow cascades' reach. */
  update(camera: THREE.Vector3, shadowRange: number): void;
  /** Idle motion (t: seconds of scene time). */
  tick(t: number): void;
  /** Alpha to coverage where the frame is multisampled. */
  setCoverage(on: boolean): void;
  dispose(): void;
}

export interface CityQuality {
  facadeScale: 1 | 2;
  anisotropy: number;
  /** Share of the full city radius to build (phones build less). */
  blocks: number;
  trees: boolean;
  coverage: boolean;
}

export interface CityTex {
  pbr(name: string, tileM: number, opts?: { color?: string; normalScale?: number }): THREE.MeshStandardMaterialParameters;
}

export interface SkyHandle {
  mesh: THREE.Mesh;
  update(camera: THREE.Camera, t: number): void;
  dispose(): void;
}

export interface CityKit {
  id: CityId;
  look: CityLook;
  /** The landmark at the plaza's centre, for the finale's framing. */
  landmark: Landmark;
  createSky(sunDir: THREE.Vector3): SkyHandle;
  /** The environment map (reflections and image-based light), made on the spot (no download). */
  environment(renderer: THREE.WebGLRenderer, pmrem: THREE.PMREMGenerator, sunDir: THREE.Vector3): THREE.Texture;
  build(plan: WorldPlan, shared: Shared, tex: CityTex, quality: CityQuality): CityWorld;
}
