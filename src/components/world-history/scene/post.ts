import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Look, Spec } from "./types";

/**
 * The film look. Scenes render in linear HDR into half-float targets; then
 * bloom on what glows, light shafts radiating from the brightest source,
 * and a grade: ACES tone curve, lift and gain, saturation and contrast,
 * chromatic aberration, a vignette, film grain, a white flash and a fade.
 * A cut between two scenes (the video's light-burst cuts) mixes two
 * targets first. Low quality keeps the grade and drops bloom and shafts.
 */

const FULLSCREEN_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Reads of the HDR scene go through this: a pixel that came out NaN or
 * infinite (a pow of a tiny negative, a normalize of zero: GPUs that follow
 * IEEE strictly, like Apple's, give NaN where others give 0) becomes black
 * instead of poisoning the bloom, whose blurs would spread it into large
 * black blocks across the frame. Checked on the bits, so no compiler's
 * fast-math can fold it away.
 */
export const SAFE_HDR = /* glsl */ `
float whSafe1(float v){ return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u ? 0.0 : clamp(v, 0.0, 60000.0); }
vec3 whSafe(vec3 c){ return vec3(whSafe1(c.r), whSafe1(c.g), whSafe1(c.b)); }
`;

export interface Post {
  /** Where scenes render (HDR). */
  target: THREE.WebGLRenderTarget;
  /** Extra targets for portals and cuts, created on demand. */
  aux(i: 0 | 1): THREE.WebGLRenderTarget;
  /** Mixes aux 0 → aux 1 into the main target (k 0..1) with a burst of light at the seam. */
  mix(k: number, burst: number): void;
  /** Bloom, shafts and grade from the main target to the screen. */
  finish(look: Look, raysUv: [number, number] | null, time: number): void;
  setSize(w: number, h: number, pr: number): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, w: number, h: number, pr: number, q: Spec): Post {
  const mk = (samples: number) => new THREE.WebGLRenderTarget(Math.max(1, Math.round(w * pr)), Math.max(1, Math.round(h * pr)), { type: THREE.HalfFloatType, samples, depthBuffer: true });
  const target = mk(q.msaa);
  const auxes: (THREE.WebGLRenderTarget | null)[] = [null, null];
  const half = () => new THREE.WebGLRenderTarget(Math.max(1, Math.round((w * pr) / 2)), Math.max(1, Math.round((h * pr) / 2)), { type: THREE.HalfFloatType, depthBuffer: false });
  let raysRT = q.rays ? half() : null;
  const bloom = q.bloom ? new UnrealBloomPass(new THREE.Vector2(w * pr, h * pr), 0.7, 0.55, 0.82) : null;
  if (bloom) {
    // The bloom's first read of the scene: scrubbed (see SAFE_HDR).
    const hp = bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader
      .replace("void main() {", `${SAFE_HDR}\nvoid main() {`)
      .replace("vec4 texel = texture2D( tDiffuse, vUv );", "vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = whSafe( texel.rgb );");
    hp.needsUpdate = true;
  }

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo);
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;

  const raysMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, uLight: { value: new THREE.Vector2(0.5, 0.5) }, uThreshold: { value: 0.9 }, uDecay: { value: 0.955 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene; uniform vec2 uLight; uniform float uThreshold, uDecay; varying vec2 vUv;
      ${SAFE_HDR}
      void main(){
        vec2 d = (vUv - uLight) / 40.0;
        vec2 p = vUv; float w = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < 40; i++){
          vec3 c = whSafe(texture2D(tScene, p).rgb);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          acc += c * smoothstep(uThreshold, uThreshold * 2.5, l) * w;
          w *= uDecay; p -= d;
        }
        gl_FragColor = vec4(acc / 40.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

  const mixMat = new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, uK: { value: 0 }, uBurst: { value: 0 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tA, tB; uniform float uK, uBurst; varying vec2 vUv;
      ${SAFE_HDR}
      void main(){
        vec2 c = vUv - 0.5;
        float r = length(c);
        float zoomA = 1.0 - uK * 0.08, zoomB = 1.0 + (1.0 - uK) * 0.06;
        vec3 a = whSafe(texture2D(tA, 0.5 + c * zoomA).rgb);
        vec3 b = whSafe(texture2D(tB, 0.5 + c * zoomB).rgb);
        float edge = smoothstep(uK * 1.2 - 0.25, uK * 1.2, r);
        vec3 m = mix(b, a, edge);
        float fx = (r - uK * 0.9) * 4.0;
        float flash = uBurst * exp(-fx * fx) + uBurst * 0.6 * (1.0 - abs(uK - 0.5) * 2.0);
        gl_FragColor = vec4(m + vec3(1.0, 0.95, 0.85) * flash * 3.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

  const gradeMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tRays: { value: null }, uRays: { value: 0 }, uRaysColor: { value: new THREE.Vector3(1, 1, 1) },
      uExposure: { value: 1 }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3() },
      uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0.3 }, uChroma: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 0 },
      uGrain: { value: 0.04 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene, tRays; uniform float uRays, uExposure, uSat, uContrast, uVignette, uChroma, uFlash, uFade, uGrain, uTime;
      uniform vec3 uRaysColor, uGain, uLift; uniform vec2 uRes; varying vec2 vUv;
      ${SAFE_HDR}
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      vec3 toSrgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 c = vUv - 0.5;
        vec3 col;
        if (uChroma > 0.001) {
          vec2 off = c * uChroma * 0.018;
          col = whSafe(vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b));
        } else col = whSafe(texture2D(tScene, vUv).rgb);
        if (uRays > 0.0) col += whSafe(texture2D(tRays, vUv).rgb) * uRaysColor * uRays;
        col *= uExposure * uGain;
        col = aces(col);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = (col - 0.5) * uContrast + 0.5;
        col += uLift * (1.0 - col);
        col = clamp(col, 0.0, 1.0);
        float v = smoothstep(0.85, 0.2, length(c * vec2(uRes.x / uRes.y, 1.0)) * 0.9);
        col *= mix(1.0, v, uVignette);
        col = mix(col, vec3(1.0, 0.98, 0.94), clamp(uFlash, 0.0, 1.0));
        col *= 1.0 - uFade;
        vec3 s = toSrgb(col);
        s += (hash(vUv * uRes + fract(uTime) * 61.0) - 0.5) * uGrain;
        gl_FragColor = vec4(s, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

  const draw = (mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) => {
    quad.material = mat;
    renderer.setRenderTarget(to);
    renderer.render(scene, cam);
  };

  let W = w, H = h, PR = pr;
  return {
    target,
    aux(i) {
      if (!auxes[i]) auxes[i] = mk(q.msaa);
      return auxes[i]!;
    },
    mix(k, burst) {
      mixMat.uniforms.tA.value = auxes[0]?.texture ?? null;
      mixMat.uniforms.tB.value = auxes[1]?.texture ?? null;
      mixMat.uniforms.uK.value = k;
      mixMat.uniforms.uBurst.value = burst;
      draw(mixMat, target);
    },
    finish(look, raysUv, time) {
      if (bloom && look.bloom > 0) {
        bloom.strength = look.bloom;
        bloom.radius = look.bloomRadius;
        bloom.threshold = look.bloomThreshold;
        renderer.setRenderTarget(target);
        // Renders the bloom on top of the target (additive, in place).
        bloom.render(renderer, target, target, 0, false);
      }
      const g = gradeMat.uniforms;
      let rays = 0;
      if (raysRT && look.rays && raysUv) {
        raysMat.uniforms.tScene.value = target.texture;
        raysMat.uniforms.uLight.value.set(raysUv[0], raysUv[1]);
        draw(raysMat, raysRT);
        rays = look.rays.strength;
        g.uRaysColor.value.set(...look.rays.color);
      }
      g.tScene.value = target.texture;
      g.tRays.value = raysRT?.texture ?? null;
      g.uRays.value = rays;
      g.uExposure.value = look.exposure;
      g.uGain.value.set(...look.gain);
      g.uLift.value.set(...look.lift);
      g.uSat.value = look.saturation;
      g.uContrast.value = look.contrast;
      g.uVignette.value = look.vignette;
      g.uChroma.value = look.chroma;
      g.uFlash.value = look.flash;
      g.uFade.value = look.fade;
      g.uGrain.value = look.grain;
      g.uTime.value = time;
      g.uRes.value.set(W * PR, H * PR);
      draw(gradeMat, null);
    },
    setSize(nw, nh, npr) {
      W = nw; H = nh; PR = npr;
      const pw = Math.max(1, Math.round(nw * npr)), ph = Math.max(1, Math.round(nh * npr));
      target.setSize(pw, ph);
      auxes.forEach((a) => a?.setSize(pw, ph));
      raysRT?.setSize(Math.max(1, Math.round(pw / 2)), Math.max(1, Math.round(ph / 2)));
      bloom?.setSize(pw, ph);
    },
    dispose() {
      target.dispose();
      auxes.forEach((a) => a?.dispose());
      raysRT?.dispose();
      raysRT = null;
      bloom?.dispose();
      quadGeo.dispose();
      raysMat.dispose();
      mixMat.dispose();
      gradeMat.dispose();
    },
  };
}
