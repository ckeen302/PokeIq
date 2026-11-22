import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

/**
 * The floor's reflection: three.js's Reflector does the mirrored camera and
 * its oblique clip; it isn't drawn itself. Its picture (with mipmaps, so the
 * floor can blur it by roughness) and the matrix from world space to that
 * picture feed the floor's material.
 */
export interface Mirror {
  texture: THREE.Texture;
  matrix: THREE.Matrix4;
  /** Draw the reflection for this camera (the floor and anything in `hide` stepped aside). */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]): void;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createMirror(w: number, h: number): Mirror {
  const reflector = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: w, textureHeight: h, multisample: 0, clipBias: 0.002 });
  reflector.rotation.x = -Math.PI / 2;
  reflector.updateMatrixWorld(true);
  const rt = reflector.getRenderTarget();
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  const texMat = (reflector.material as THREE.ShaderMaterial).uniforms.textureMatrix.value as THREE.Matrix4;
  const matrix = new THREE.Matrix4();
  const inv = new THREE.Matrix4().copy(reflector.matrixWorld).invert();
  return {
    texture: rt.texture,
    matrix,
    update(renderer, scene, camera, hide) {
      const was = hide.map((o) => o.visible);
      hide.forEach((o) => { o.visible = false; });
      reflector.onBeforeRender(renderer, scene, camera, reflector.geometry, reflector.material as THREE.Material, null as unknown as THREE.Group);
      hide.forEach((o, i) => { o.visible = was[i]; });
      matrix.multiplyMatrices(texMat, inv);
    },
    setSize(nw, nh) { rt.setSize(nw, nh); },
    dispose() { reflector.dispose(); },
  };
}
