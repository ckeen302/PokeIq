import * as THREE from "three";
import type { Vec3 } from "@/lib/world-history/camera";
import type { Spec } from "./types";

/**
 * Real shadows from a chapter's key light. One shadow-casting light per
 * beat: a directional key whose shadow box follows what the camera looks
 * at (snapped to whole shadow-map texels, so edges never crawl as it
 * moves), soft-filtered (PCF soft). The map size comes from the quality
 * (none on low and phones, 1024 on medium, 2048 on high), so a chapter
 * asks once and every quality does the right thing.
 *
 *   const sh = keyShadow(ctx.q, L.key, { radius: 18 });
 *   castShadows(figure.mesh, rocks); receiveShadows(ground.mesh);
 *   // in update(): sh.follow(focus)
 */

export interface KeyShadow {
  readonly on: boolean;
  /** Centres the shadow box on a point (and optionally resizes it: half its width in world units). */
  follow(center: Vec3, radius?: number): void;
  /** Turns the light's shadow on or off for a beat (e.g. a night interior where another light leads). */
  enable(on: boolean): void;
}

export function keyShadow(q: Pick<Spec, "shadow">, light: THREE.DirectionalLight, o: { radius: number; center?: Vec3; dist?: number; bias?: number; normalBias?: number }): KeyShadow {
  const size = q.shadow;
  if (!size) return { on: false, follow: () => undefined, enable: () => undefined };
  const dir = new THREE.Vector3().subVectors(light.position, light.target.position);
  if (dir.lengthSq() < 1e-8) dir.set(0.3, 1, 0.4);
  dir.normalize();
  const dist = o.dist ?? Math.max(60, o.radius * 4);
  let radius = o.radius;
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  light.shadow.bias = o.bias ?? -0.0004;
  light.shadow.normalBias = o.normalBias ?? Math.max(0.01, o.radius * 0.0025);
  const cam = light.shadow.camera;
  const fit = () => {
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = Math.max(0.5, dist - radius * 3);
    cam.far = dist + radius * 3;
    cam.updateProjectionMatrix();
  };
  fit();
  // A basis across the light, for snapping the box to texels.
  const right = new THREE.Vector3().crossVectors(Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const c = new THREE.Vector3();
  const follow = (center: Vec3, r?: number) => {
    if (r !== undefined && Math.abs(r - radius) > 1e-3) { radius = r; fit(); }
    c.set(center[0], center[1], center[2]);
    const texel = (radius * 2) / size;
    const a = Math.round(c.dot(right) / texel) * texel, b = Math.round(c.dot(up) / texel) * texel, d = c.dot(dir);
    light.target.position.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(dir, d);
    light.position.copy(light.target.position).addScaledVector(dir, dist);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  };
  follow(o.center ?? [light.target.position.x, light.target.position.y, light.target.position.z]);
  return { on: true, follow, enable: (on) => { light.castShadow = on; } };
}

/** Marks objects (and everything under them) as shadow casters. */
export function castShadows(...objs: (THREE.Object3D | null | undefined)[]) {
  for (const o of objs) o?.traverse((x) => { if ((x as THREE.Mesh).isMesh) x.castShadow = true; });
}

/** Marks objects (and everything under them) as shadow receivers. */
export function receiveShadows(...objs: (THREE.Object3D | null | undefined)[]) {
  for (const o of objs) o?.traverse((x) => { if ((x as THREE.Mesh).isMesh) x.receiveShadow = true; });
}
