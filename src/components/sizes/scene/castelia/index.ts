import * as THREE from "three";
import { planCastelia, type CasteliaPlan } from "@/lib/sizes/castelia";
import type { WorldPlan } from "@/lib/sizes/world";
import type { Shared } from "../shaders";
import { buildGround, type GroundTextures } from "./ground";
import { buildLandmarks } from "./landmarks";
import { buildProps } from "./props";
import { TowerChunks, addTower, facadeMaterial, facadeUniforms } from "./towers";

export { CASTELIA_HAZE, CASTELIA_MOOD, createDuskSky, duskEnvironment } from "./sky";

/**
 * Castelia City at dusk, built round a line's plan (lib/sizes/castelia
 * plans it): the skyscrapers in merged chunks with their one window shader,
 * the ground and the bay, the landmarks and the street life. The scene
 * (../index.ts) builds it in place of Lumiose's city, props and Prism Tower
 * and tells it where the camera is each frame, so towers in the way sink
 * out of the shot.
 */

export interface Castelia {
  group: THREE.Group;
  plan: CasteliaPlan;
  /** The camera, the framed figure's feet, the tangent of half the horizontal field of view and half the width to keep clear round the figure. */
  update(camera: THREE.Vector3, aim: THREE.Vector3, tanH: number, figHalf: number): void;
  tick(t: number): void;
  stats(): { towers: number; tris: number };
  dispose(): void;
}

export function buildCastelia(plan: WorldPlan, shared: Shared, tex: GroundTextures, quality: { detail: number; trees: boolean }): Castelia {
  const group = new THREE.Group();
  group.name = "castelia";
  const cp = planCastelia(plan, quality.detail);
  const chunks = new TowerChunks(320);
  for (const t of cp.towers) addTower(chunks, t);
  const uni = facadeUniforms();
  const facade = facadeMaterial(uni);
  const towerMeshes = chunks.meshes(facade);
  group.add(...towerMeshes);
  const ground = buildGround(plan, cp, shared, tex);
  group.add(...ground.meshes);
  const landmarks = buildLandmarks(cp, { detail: quality.detail });
  group.add(landmarks.group);
  const props = buildProps(plan, cp, shared, quality);
  group.add(props.group);
  let tris = 0;
  for (const m of towerMeshes) tris += (m.geometry.index?.count ?? 0) / 3;
  return {
    group,
    plan: cp,
    update(camera, aim, tanH, figHalf) {
      uni.uFig.value = figHalf;
      uni.uCam.value.copy(camera);
      uni.uAim.value.copy(aim);
      uni.uTanH.value = tanH;
    },
    tick(t) { landmarks.tick(t); },
    stats: () => ({ towers: cp.towers.length, tris }),
    dispose() {
      for (const m of towerMeshes) m.geometry.dispose();
      facade.dispose();
      ground.dispose();
      landmarks.dispose();
      props.dispose();
    },
  };
}
