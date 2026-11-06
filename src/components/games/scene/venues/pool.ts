import * as THREE from "three";
import type { Props } from "../../show/types";

/** The aquatics centre (built in full below in a later step). */
export interface PoolWorld {
  group: THREE.Group;
  env: THREE.Texture;
  fog: THREE.FogExp2;
  update(t: number, cam: THREE.Camera, excitement: number): void;
  setProps(p: Props, t: number, cam: THREE.Camera): void;
  dispose(): void;
}

export function buildAquatics(o: { renderer: THREE.WebGLRenderer; font: string; occupancy: number; flashes: number; aniso: number; quality: "low" | "high" }): PoolWorld {
  const group = new THREE.Group();
  const env = new THREE.PMREMGenerator(o.renderer).fromScene(new THREE.Scene(), 0.04).texture;
  return { group, env, fog: new THREE.FogExp2(0x05070c, 0.004), update() {}, setProps() {}, dispose() { env.dispose(); } };
}
