import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

/**
 * The battle's finishing, cheap enough for thousands of figures: the scene
 * renders into a multisampled HDR target, a dual-filter bloom (a threshold
 * at half size, then down and back up a short mip chain at a quarter of
 * the pixels and less) makes fire, beams and auras glow, and one last pass
 * adds the bloom, grades the frame (saturation, contrast, warmth and a
 * vignette per arena and time of day), and on a huge hit punches the
 * camera: a radial blur and a split of the colour channels from the
 * impact, and a flash. Filmic (ACES) tone mapping and the sRGB conversion
 * come last, from three.js' own shader chunks.
 */

export interface PostSettings {
  /** MSAA samples on the scene target (0 for none). */
  msaa: number;
  /** Bloom mips (0 turns bloom off). */
  bloomMips: number;
}

export interface Grade {
  saturation: number;
  contrast: number;
  /** + warmer, − cooler. */
  warmth: number;
  vignette: number;
  bloom: number;
  /** Bloom threshold (linear HDR). */
  threshold: number;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Threshold with a soft knee, at half size (a 4-tap box that also downsamples). */
const BRIGHT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
vec3 pick(vec3 c) {
  float l = max(c.r, max(c.g, c.b));
  float knee = threshold * 0.5;
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - threshold) / max(l, 1e-4);
  return c * w;
}
void main() {
  vec3 a = texture2D(tColor, vUv + texel * vec2(-0.5, -0.5)).rgb;
  vec3 b = texture2D(tColor, vUv + texel * vec2(0.5, -0.5)).rgb;
  vec3 c = texture2D(tColor, vUv + texel * vec2(-0.5, 0.5)).rgb;
  vec3 d = texture2D(tColor, vUv + texel * vec2(0.5, 0.5)).rgb;
  // Fireflies (a single blazing pixel) are tamed before they bloom.
  vec3 s = pick(min(a, vec3(40.0))) + pick(min(b, vec3(40.0))) + pick(min(c, vec3(40.0))) + pick(min(d, vec3(40.0)));
  gl_FragColor = vec4(s * 0.25, 1.0);
}`;

/** Dual-filter downsample (5 taps). */
const DOWN = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tColor, vUv).rgb * 4.0;
  s += texture2D(tColor, vUv + texel * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tColor, vUv + texel * vec2(1.0, -1.0)).rgb;
  s += texture2D(tColor, vUv + texel * vec2(-1.0, 1.0)).rgb;
  s += texture2D(tColor, vUv + texel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

/** Dual-filter upsample (8 taps), added to the level below. */
const UP = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBase;
uniform vec2 texel;
uniform float spread;
varying vec2 vUv;
void main() {
  vec2 o = texel * spread;
  vec3 s = texture2D(tColor, vUv + vec2(-o.x * 2.0, 0.0)).rgb;
  s += texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb * 2.0;
  s += texture2D(tColor, vUv + vec2(0.0, o.y * 2.0)).rgb;
  s += texture2D(tColor, vUv + vec2(o.x, o.y)).rgb * 2.0;
  s += texture2D(tColor, vUv + vec2(o.x * 2.0, 0.0)).rgb;
  s += texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb * 2.0;
  s += texture2D(tColor, vUv + vec2(0.0, -o.y * 2.0)).rgb;
  s += texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s / 12.0, 1.0);
}`;

const FINISH = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float bloomOn;
uniform float bloom;
uniform float saturation;
uniform float contrast;
uniform float warmth;
uniform float vignette;
uniform vec2 punchAt;
uniform float punch;
uniform vec3 flashColor;
uniform float flash;
uniform float grain;
uniform float time;
uniform float aspect;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 col;
  if (punch > 0.002) {
    // The camera punch: a radial blur out from the impact and the colour channels pulled apart.
    vec2 dir = vUv - punchAt;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 8; i++) {
      float k = float(i) / 7.0;
      vec2 uv = punchAt + dir * (1.0 - punch * 0.035 * k);
      float w = 1.0 - k * 0.5;
      vec2 ca = dir * punch * 0.004;
      acc += vec3(texture2D(tColor, uv + ca).r, texture2D(tColor, uv).g, texture2D(tColor, uv - ca).b) * w;
      wsum += w;
    }
    col = acc / wsum;
  } else {
    col = texture2D(tColor, vUv).rgb;
  }
  if (bloomOn > 0.5) col += texture2D(tBloom, vUv).rgb * bloom;
  col += flashColor * flash;
  // Grade (in linear light, before the filmic curve).
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, saturation), 0.0);
  col *= vec3(1.0 + warmth, 1.0 + warmth * 0.2, 1.0 - warmth);
  // Contrast as a power curve round middle grey (HDR-safe).
  col = 0.18 * pow(col / 0.18 + 1e-5, vec3(contrast));
  vec2 q = vUv - 0.5;
  col *= 1.0 - vignette * smoothstep(0.18, 0.62, dot(q, q) * (1.0 + 0.25 * abs(aspect - 1.0)));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Grain after the curve, so it sits evenly in the shadows and highlights (and breaks up banding in the sky).
  gl_FragColor.rgb += (hash(vUv * 1024.0 + time) - 0.5) * grain;
}`;

export interface Post {
  /** The scene's own target (HDR, multisampled): shaders are compiled for it. */
  target: THREE.WebGLRenderTarget;
  grade: Grade;
  /** The camera punch: strength 0..1 and where on screen (0..1, y up). */
  punch(strength: number, x: number, y: number): void;
  flash(color: THREE.Color, amount: number): void;
  setSize(w: number, h: number): void;
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number): void;
  dispose(): void;
}

const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false) =>
  new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped });

export function createPost(renderer: THREE.WebGLRenderer, w: number, h: number, s: PostSettings): Post {
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: s.msaa, depthBuffer: true });
  const mips = Math.max(0, Math.min(6, s.bloomMips));
  const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
  const down: THREE.WebGLRenderTarget[] = [];
  const up: THREE.WebGLRenderTarget[] = [];
  for (let i = 0; i < mips; i++) {
    down.push(new THREE.WebGLRenderTarget(1, 1, opts));
    if (i < mips - 1) up.push(new THREE.WebGLRenderTarget(1, 1, opts));
  }
  const bright = material(BRIGHT, { tColor: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 } });
  const downM = material(DOWN, { tColor: { value: null }, texel: { value: new THREE.Vector2() } });
  const upM = material(UP, { tColor: { value: null }, tBase: { value: null }, texel: { value: new THREE.Vector2() }, spread: { value: 1 } });
  const finish = material(
    FINISH,
    {
      tColor: { value: null },
      tBloom: { value: null },
      bloomOn: { value: mips > 0 ? 1 : 0 },
      bloom: { value: 0.6 },
      saturation: { value: 1.1 },
      contrast: { value: 1.05 },
      warmth: { value: 0 },
      vignette: { value: 0.3 },
      punchAt: { value: new THREE.Vector2(0.5, 0.5) },
      punch: { value: 0 },
      flashColor: { value: new THREE.Color(1, 1, 1) },
      flash: { value: 0 },
      grain: { value: 0.012 },
      time: { value: 0 },
      aspect: { value: w / Math.max(1, h) },
    },
    true
  );
  const quad = new FullScreenQuad(finish);
  const grade: Grade = { saturation: 1.1, contrast: 1.05, warmth: 0, vignette: 0.3, bloom: 0.6, threshold: 1 };
  let punchV = 0, flashV = 0;
  let W = w, H = h;
  let clock = 0;

  const sizeChain = (pw: number, ph: number) => {
    let cw = Math.max(1, Math.round(pw / 2)), ch = Math.max(1, Math.round(ph / 2));
    for (let i = 0; i < mips; i++) {
      down[i].setSize(cw, ch);
      if (i < mips - 1) up[i].setSize(cw, ch);
      cw = Math.max(1, Math.round(cw / 2));
      ch = Math.max(1, Math.round(ch / 2));
    }
  };
  const pass = (m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) => {
    quad.material = m;
    renderer.setRenderTarget(to);
    quad.render(renderer);
  };

  return {
    target,
    grade,
    punch(strength, x, y) {
      if (strength > punchV) {
        punchV = Math.min(1, strength);
        finish.uniforms.punchAt.value.set(Math.min(0.95, Math.max(0.05, x)), Math.min(0.95, Math.max(0.05, y)));
      }
    },
    flash(color, amount) {
      if (amount > flashV) {
        flashV = Math.min(1.5, amount);
        finish.uniforms.flashColor.value.copy(color);
      }
    },
    setSize(nw, nh) {
      W = Math.max(1, nw);
      H = Math.max(1, nh);
      target.setSize(W, H);
      sizeChain(W, H);
      finish.uniforms.aspect.value = W / H;
    },
    render(r, scene, camera, dt) {
      clock += dt;
      r.setRenderTarget(target);
      r.render(scene, camera);
      if (mips > 0) {
        bright.uniforms.tColor.value = target.texture;
        bright.uniforms.texel.value.set(1 / W, 1 / H);
        bright.uniforms.threshold.value = grade.threshold;
        pass(bright, down[0]);
        for (let i = 1; i < mips; i++) {
          downM.uniforms.tColor.value = down[i - 1].texture;
          downM.uniforms.texel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
          pass(downM, down[i]);
        }
        let src = down[mips - 1];
        for (let i = mips - 2; i >= 0; i--) {
          upM.uniforms.tColor.value = src.texture;
          upM.uniforms.tBase.value = down[i].texture;
          upM.uniforms.texel.value.set(1 / src.width, 1 / src.height);
          pass(upM, up[i]);
          src = up[i];
        }
        finish.uniforms.tBloom.value = src.texture;
      }
      const u = finish.uniforms;
      u.tColor.value = target.texture;
      u.bloom.value = grade.bloom;
      u.saturation.value = grade.saturation;
      u.contrast.value = grade.contrast;
      u.warmth.value = grade.warmth;
      u.vignette.value = grade.vignette;
      u.punch.value = punchV;
      u.flash.value = flashV;
      u.time.value = (clock * 60) % 997;
      pass(finish, null);
      // The punch and the flash fade in a few tenths of a second (real time).
      punchV = Math.max(0, punchV - dt * 4);
      flashV = Math.max(0, flashV * Math.exp(-dt * 9) - dt * 0.05);
    },
    dispose() {
      target.dispose();
      for (const t of [...down, ...up]) t.dispose();
      bright.dispose();
      downM.dispose();
      upM.dispose();
      finish.dispose();
      quad.dispose();
    },
  };
}
