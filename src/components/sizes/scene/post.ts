import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SAFE_HDR, scrubBloom, scrubRead } from "@/lib/gl/safe-hdr";

/**
 * The frame's finishing: the scene renders in HDR with 4× MSAA, then
 * ground-truth ambient occlusion (from the resolved depth, so cut-out
 * railings and lattice occlude correctly), a gentle depth of field focused
 * on the framed Pokémon (stronger at small scales, like a macro lens), a
 * light grade and vignette, bloom on what glows (Prism Tower's crown, sun
 * glints), then filmic tone mapping to sRGB. The depth of field is gathered
 * at half resolution and blended in by each pixel's own blur (so what's in
 * focus stays pixel-sharp), and bloom works at a quarter of the pixels:
 * both are soft by nature, and they were the frame's costliest passes.
 */

export interface PostSettings {
  msaa: number;
  ao: boolean;
  aoSamples: number;
  dof: boolean;
  dofSamples: 16 | 32;
  bloom: boolean;
}

const POISSON_32 = [
  [-0.613392, 0.617481], [0.170019, -0.040254], [-0.299417, 0.791925], [0.645680, 0.493210], [-0.651784, 0.717887], [0.421003, 0.027070], [-0.817194, -0.271096], [-0.705374, -0.668203],
  [0.977050, -0.108615], [0.063326, 0.142369], [0.203528, 0.214331], [-0.667531, 0.326090], [-0.098422, -0.295755], [-0.885922, 0.215369], [0.566637, 0.605213], [0.039766, -0.396100],
  [0.751946, 0.453352], [0.078707, -0.715323], [-0.075838, -0.529344], [0.724479, -0.580798], [0.222999, -0.215125], [-0.467574, -0.405438], [-0.248268, -0.814753], [0.354411, -0.887570],
  [0.175817, 0.382366], [0.487472, -0.063082], [-0.084078, 0.898312], [0.488876, -0.783441], [0.470016, 0.217933], [-0.696890, -0.549791], [-0.149693, 0.605762], [0.034211, 0.979980],
];

const DEPTH_GLSL = /* glsl */ `
  #include <packing>
  uniform sampler2D tDepth;
  uniform float cameraNear, cameraFar, focusDist, aperture, maxBlur;
  float distAt(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
  }
  float cocAt(float z) { return min(maxBlur, aperture * abs(1.0 - focusDist / max(z, 1e-4))); }
`;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const lensUniforms = () => ({
  tDepth: { value: null as THREE.Texture | null },
  cameraNear: { value: 0.1 },
  cameraFar: { value: 1000 },
  focusDist: { value: 10 },
  aperture: { value: 6 },
  maxBlur: { value: 14 },
});

/** The depth of field's gather, drawn at half resolution: the blurred colour, and the blur radius (full-resolution px) in alpha. */
function gatherShader(samples: number) {
  return new THREE.ShaderMaterial({
    name: "SizesDofGather",
    defines: { DOF_SAMPLES: samples },
    uniforms: {
      ...lensUniforms(),
      tColor: { value: null as THREE.Texture | null },
      resolution: { value: new THREE.Vector2(1, 1) },
      poisson: { value: POISSON_32.map(([x, y]) => new THREE.Vector2(x, y)) },
    },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${DEPTH_GLSL}
      uniform sampler2D tColor;
      uniform vec2 resolution;
      uniform vec2 poisson[32];
      varying vec2 vUv;
      ${SAFE_HDR}
      void main() {
        vec3 col = glSafe(texture2D(tColor, vUv).rgb);
        float z0 = distAt(vUv);
        float c0 = cocAt(z0);
        if (c0 > 0.6) {
          float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
          mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
          vec3 sum = col; float wsum = 1.0;
          for (int i = 0; i < DOF_SAMPLES; i++) {
            vec2 o = rot * poisson[i] * c0;
            vec2 uv = vUv + o / resolution;
            float z = distAt(uv);
            float c = cocAt(z);
            float dist = length(o);
            // Nearer, sharper things must not bleed into the blurred background.
            float w = z < z0 - 0.02 * z0 ? clamp(c - dist + 1.0, 0.0, 1.0) : 1.0;
            sum += glSafe(texture2D(tColor, uv).rgb) * w;
            wsum += w;
          }
          col = sum / wsum;
        }
        gl_FragColor = vec4(col, c0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** Full resolution: the sharp frame, the blurred one where this pixel is out of focus, then the grade and vignette. */
function finishShader() {
  return new THREE.ShaderMaterial({
    name: "SizesFinish",
    uniforms: {
      ...lensUniforms(),
      tDiffuse: { value: null as THREE.Texture | null },
      tDof: { value: null as THREE.Texture | null },
      dofOn: { value: 1 },
      vignette: { value: 0.2 },
      saturation: { value: 1.14 },
      warmth: { value: 0.03 },
    },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${DEPTH_GLSL}
      uniform sampler2D tDiffuse;
      uniform sampler2D tDof;
      uniform float dofOn, vignette, saturation, warmth;
      varying vec2 vUv;
      ${SAFE_HDR}
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        vec3 col = glSafe(base.rgb);
        if (dofOn > 0.5) {
          float c = cocAt(distAt(vUv));
          if (c > 0.6) col = mix(col, glSafe(texture2D(tDof, vUv).rgb), smoothstep(0.6, 1.8, c));
        }
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = max(mix(vec3(l), col, saturation), 0.0);
        // Split tone: a touch of blue in the shade, warm sun on what's lit (a late-morning Lumiose).
        float lit = smoothstep(0.04, 0.9, l);
        col *= mix(vec3(0.965, 0.995, 1.05), vec3(1.0 + warmth, 1.0 + warmth * 0.3, 1.0 - warmth), lit);
        vec2 q = vUv - 0.5;
        col *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
        gl_FragColor = vec4(col, base.a);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** Depth of field (gathered at half resolution) and the grade, as one pass. */
class FinishPass extends Pass {
  readonly gather: THREE.ShaderMaterial | null;
  readonly finish: THREE.ShaderMaterial;
  private half: THREE.WebGLRenderTarget | null;
  private quad: FullScreenQuad;
  constructor(depth: THREE.Texture, dof: boolean, samples: number) {
    super();
    this.finish = finishShader();
    this.finish.uniforms.tDepth.value = depth;
    this.finish.uniforms.dofOn.value = dof ? 1 : 0;
    this.gather = dof ? gatherShader(samples) : null;
    if (this.gather) this.gather.uniforms.tDepth.value = depth;
    this.half = dof ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null;
    this.quad = new FullScreenQuad(this.finish);
  }
  /** Full-resolution pixel size. */
  setSize(w: number, h: number) {
    this.half?.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.gather?.uniforms.resolution.value.set(w, h);
  }
  lens(near: number, far: number, focus: number, aperture: number, maxBlur: number) {
    for (const m of this.gather ? [this.gather, this.finish] : [this.finish]) {
      m.uniforms.cameraNear.value = near;
      m.uniforms.cameraFar.value = far;
      m.uniforms.focusDist.value = focus;
      m.uniforms.aperture.value = aperture;
      m.uniforms.maxBlur.value = maxBlur;
    }
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    if (this.gather && this.half) {
      this.gather.uniforms.tColor.value = readBuffer.texture;
      this.quad.material = this.gather;
      renderer.setRenderTarget(this.half);
      this.quad.render(renderer);
      this.finish.uniforms.tDof.value = this.half.texture;
    }
    this.finish.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.finish;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.gather?.dispose();
    this.finish.dispose();
    this.half?.dispose();
    this.quad.dispose();
  }
}

export interface Post {
  composer: EffectComposer;
  /** Where the scene itself is drawn: shaders must be compiled for this target (HDR, no tone mapping) to be the ones used. */
  target: THREE.WebGLRenderTarget;
  setSize(w: number, h: number): void;
  /** Focus and blur for this frame. */
  frame(camera: THREE.PerspectiveCamera, focus: number, aperturePx: number, aoRadius: number): void;
  render(): void;
  dispose(): void;
}

/**
 * Draws the scene into its own multisampled HDR target (with a depth texture
 * nothing else writes to), then hands the colour to the composer. Keeping the
 * scene's depth apart avoids sharing a depth texture between the composer's
 * ping-pong buffers, and feedback loops when later passes sample it.
 */
class ScenePass extends Pass {
  private quad: FullScreenQuad;
  private copy: THREE.ShaderMaterial;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, public target: THREE.WebGLRenderTarget) {
    super();
    this.copy = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: scrubRead(CopyShader.fragmentShader), depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.copy);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.copy.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.copy.dispose(); this.quad.dispose(); }
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number, s: PostSettings): Post {
  const depth = new THREE.DepthTexture(w, h);
  depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: s.msaa, depthTexture: depth });
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false }));
  const scenePass = new ScenePass(scene, camera, sceneRT);
  composer.addPass(scenePass);
  let gtao: GTAOPass | null = null;
  if (s.ao) {
    gtao = new GTAOPass(scene, camera, w, h);
    (gtao as unknown as { normalRenderTarget?: THREE.WebGLRenderTarget }).normalRenderTarget?.dispose();
    gtao.setGBuffer(depth, undefined);
    gtao.gtaoMaterial.needsUpdate = true;
    (gtao as unknown as { pdMaterial: THREE.ShaderMaterial }).pdMaterial.needsUpdate = true;
    gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: s.aoSamples, distanceFallOff: 1.0 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }
  const finish = new FinishPass(depth, s.dof, s.dofSamples);
  composer.addPass(finish);
  let bloom: UnrealBloomPass | null = null;
  if (s.bloom) {
    // The pass already works from half size down; giving it half the frame puts its first level at a quarter of the pixels.
    bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, w / 2), Math.max(1, h / 2)), 0.32, 0.55, 1.15);
    scrubBloom(bloom);
    const sizeBloom = bloom.setSize.bind(bloom);
    bloom.setSize = (bw: number, bh: number) => sizeBloom(Math.max(2, Math.round(bw / 2)), Math.max(2, Math.round(bh / 2)));
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());

  return {
    composer,
    target: sceneRT,
    setSize(nw, nh) {
      composer.setSize(nw, nh);
      const pr = renderer.getPixelRatio();
      sceneRT.setSize(nw * pr, nh * pr);
      finish.setSize(Math.round(nw * pr), Math.round(nh * pr));
    },
    frame(cam, focus, aperturePx, aoRadius) {
      finish.lens(cam.near, cam.far, focus, aperturePx, Math.max(2, aperturePx * 1.15));
      if (gtao) gtao.updateGtaoMaterial({ radius: aoRadius });
    },
    render() {
      composer.render();
    },
    dispose() {
      composer.dispose();
      scenePass.dispose();
      finish.dispose();
      sceneRT.dispose();
      depth.dispose();
      gtao?.dispose();
      bloom?.dispose();
    },
  };
}
