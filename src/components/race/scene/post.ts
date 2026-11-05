import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SAFE_HDR, scrubBloom } from "@/lib/gl/safe-hdr";

/**
 * The broadcast look, kept cheap for a live view: the scene in HDR with
 * 4× MSAA, bloom on what glows (floodlight banks, LED boards, camera
 * flashes), a light grade with a vignette (cooler and softer during the
 * slow-motion replay), then filmic tone mapping. No ambient occlusion and
 * no depth of field: the race has to stay smooth.
 */

const GradeShader = {
  name: "RaceGrade",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.3 },
    uReplay: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uReplay; varying vec2 vUv;
    ${SAFE_HDR}
    void main(){
      vec4 b = texture2D(tDiffuse, vUv);
      vec3 c = glSafe(b.rgb);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // A little extra saturation and contrast, like broadcast colour.
      c = mix(vec3(l), c, 1.1);
      c = mix(c, mix(vec3(l), c, 0.7) * vec3(0.93, 1.0, 1.1), uReplay);
      vec2 q = vUv - 0.5;
      c *= 1.0 - (uVignette + uReplay * 0.2) * smoothstep(0.18, 0.75, dot(q, q) * 2.0);
      gl_FragColor = vec4(max(c, 0.0), b.a);
    }`,
};

export interface Post {
  setSize(w: number, h: number): void;
  setReplay(k: number): void;
  render(): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, o: { msaa: number; bloom: boolean }): Post {
  const pr = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: o.msaa });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  let bloom: UnrealBloomPass | null = null;
  if (o.bloom) {
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.45, 1.25);
    scrubBloom(bloom);
    composer.addPass(bloom);
  }
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    setSize(nw, nh) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(nw, nh);
    },
    setReplay(k) { grade.uniforms.uReplay.value = k; },
    render() { composer.render(); },
    dispose() {
      composer.dispose();
      target.dispose();
      bloom?.dispose();
      grade.material.dispose();
    },
  };
}

/** A stadium at night as an environment for reflections: a dark dome, the roof's ring of lamps, four bright banks, the red track and green infield below. */
export function stadiumEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.016, 0.03), side: THREE.BackSide }));
  env.add(dome);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.08, 0.06) }));
  floor.position.y = -12;
  env.add(floor);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(22, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.14, 0.05) }));
  grass.position.y = -11.9;
  env.add(grass);
  const stands = new THREE.Mesh(new THREE.CylinderGeometry(46, 44, 14, 48, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.09), side: THREE.BackSide }));
  stands.position.y = -2;
  env.add(stands);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.8, 8) });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.4), lampMat);
    l.position.set(Math.cos(a) * 30, 22, Math.sin(a) * 30);
    l.lookAt(0, 0, 0);
    env.add(l);
  }
  const bankMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(28, 27, 25) });
  for (const a of [0.62, Math.PI - 0.62, Math.PI + 0.62, -0.62]) {
    const bnk = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), bankMat);
    bnk.position.set(Math.cos(a) * 40, 30, Math.sin(a) * 40);
    bnk.lookAt(0, 0, 0);
    env.add(bnk);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  });
  return rt.texture;
}
