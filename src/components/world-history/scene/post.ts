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
 *
 * Opt-in lens effects (see Look): a lens pass that reads the scene's depth
 * for height fog (medium and up), depth of field and camera motion blur
 * (high only) and a whip-pan smear; an anamorphic streak on hot lights;
 * edge fringing; and two more tone curves (filmic ACES, AgX).
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
  /** Bloom, shafts, the lens pass and grade from the main target to the screen (`view`: the camera drawn, for the depth effects). */
  finish(look: Look, raysUv: [number, number] | null, time: number, view?: PostView | null): void;
  setSize(w: number, h: number, pr: number): void;
  /** Every material the chain draws with (to compile ahead): those drawing into targets, and the one drawing to the screen. */
  materials: { target: THREE.Material[]; screen: THREE.Material[] };
  dispose(): void;
}

export interface PostView {
  camera: THREE.PerspectiveCamera;
  /** The camera's view-projection a moment earlier (motion blur), or null after a cut or in free look. */
  prevViewProj: THREE.Matrix4 | null;
}

const LENS_FRAG = /* glsl */ `
  uniform sampler2D tScene, tDepth; uniform vec2 uRes; uniform float uNear, uFar;
  uniform mat4 uInvProj, uCamWorld, uPrevViewProj; uniform vec3 uCamPos;
  uniform float uFog, uFogFalloff, uFogHeight, uFogSky; uniform vec3 uFogColor, uFogSunDir, uFogSunColor;
  uniform float uDof, uFocus, uMBlur, uMaxCoc; uniform vec2 uWhip;
  varying vec2 vUv;
  float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
  float depthAt(vec2 uv){ return texture2D(tDepth, uv).r; }
  float cocAt(float d){
    float z = d >= 0.99999 ? uFar : -viewZ(d);
    return clamp(uDof * abs(z - uFocus) / max(z, 1e-3), 0.0, 1.0) * uMaxCoc;
  }
  vec3 worldAt(vec2 uv, float d){
    vec4 ndc = vec4(uv * 2.0 - 1.0, min(d, 0.99999) * 2.0 - 1.0, 1.0);
    vec4 v = uInvProj * ndc; v /= max(abs(v.w), 1e-6) * sign(v.w + 1e-9);
    return (uCamWorld * vec4(v.xyz, 1.0)).xyz;
  }
  void main(){
    vec2 px = 1.0 / uRes;
    float d0 = depthAt(vUv);
    vec3 col = whSafe(texture2D(tScene, vUv).rgb);
    #if DOF
    if (uDof > 0.0) {
      float c0 = cocAt(d0);
      vec3 acc = col; float tot = 1.0; float rad = 1.0;
      for (int i = 0; i < 40; i++) {
        if (rad >= uMaxCoc) break;
        float ang = float(i) * 2.39996323;
        vec2 tc = vUv + vec2(cos(ang), sin(ang)) * px * rad;
        float ds = depthAt(tc);
        float cs = cocAt(ds);
        if (ds > d0) cs = min(cs, c0 * 2.0);
        float m = smoothstep(rad - 0.5, rad + 0.5, cs);
        acc += mix(acc / tot, whSafe(texture2D(tScene, tc).rgb), m);
        tot += 1.0;
        rad += 1.6 / rad;
      }
      col = acc / tot;
    }
    #endif
    vec2 vel = uWhip;
    #if MBLUR
    if (uMBlur > 0.0) {
      vec4 pc = uPrevViewProj * vec4(worldAt(vUv, d0), 1.0);
      vec2 prev = pc.w > 1e-4 ? pc.xy / pc.w * 0.5 + 0.5 : vUv;
      vec2 v = (vUv - prev) * uMBlur;
      float l = length(v);
      vel += l > 0.06 ? v * (0.06 / l) : v;
    }
    #endif
    float vl = length(vel * uRes);
    if (vl > 1.5) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 10; i++) {
        float k = (float(i) + 0.5) / 10.0 - 0.5;
        acc += whSafe(texture2D(tScene, vUv + vel * k).rgb);
      }
      col = mix(col, acc / 10.0, smoothstep(1.5, 4.0, vl));
    }
    #if FOG
    if (uFog > 0.0) {
      bool sky = d0 >= 0.99999;
      vec3 wp = worldAt(vUv, d0);
      vec3 ray = wp - uCamPos;
      float dist = sky ? 900.0 : length(ray);
      vec3 rd = ray / max(length(ray), 1e-4);
      float h0 = clamp(uCamPos.y - uFogHeight, -40.0, 400.0);
      float base = uFog * exp(-clamp(uFogFalloff * h0, -12.0, 30.0));
      float fy = uFogFalloff * rd.y;
      float amount = abs(fy) > 1e-4 ? base * (1.0 - exp(-clamp(fy * dist, -30.0, 30.0))) / fy : base * dist;
      amount = max(amount, 0.0) * (sky ? uFogSky : 1.0);
      float T = exp(-min(amount, 30.0));
      float sunK = max(dot(rd, uFogSunDir), 0.0);
      sunK *= sunK; sunK *= sunK; sunK *= sunK;
      vec3 fc = uFogColor + uFogSunColor * sunK;
      col = col * T + fc * (1.0 - T);
    }
    #endif
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createPost(renderer: THREE.WebGLRenderer, w: number, h: number, pr: number, q: Spec): Post {
  const mk = (samples: number) => new THREE.WebGLRenderTarget(Math.max(1, Math.round(w * pr)), Math.max(1, Math.round(h * pr)), { type: THREE.HalfFloatType, samples, depthBuffer: true });
  const target = mk(q.msaa);
  if (q.depth) {
    target.depthTexture = new THREE.DepthTexture(target.width, target.height);
    target.depthTexture.type = THREE.UnsignedIntType;
  }
  const full = () => new THREE.WebGLRenderTarget(Math.max(1, Math.round(w * pr)), Math.max(1, Math.round(h * pr)), { type: THREE.HalfFloatType, depthBuffer: false });
  let lensRT = q.depth ? full() : null;
  const quarter = () => new THREE.WebGLRenderTarget(Math.max(1, Math.round((w * pr) / 4)), Math.max(1, Math.round((h * pr) / 4)), { type: THREE.HalfFloatType, depthBuffer: false });
  let streakRT = q.bloom ? quarter() : null;
  const auxes: (THREE.WebGLRenderTarget | null)[] = [null, null];
  const half = () => new THREE.WebGLRenderTarget(Math.max(1, Math.round((w * pr) / 2)), Math.max(1, Math.round((h * pr) / 2)), { type: THREE.HalfFloatType, depthBuffer: false });
  let raysRT = q.rays ? half() : null;
  const bloom = q.bloom ? new UnrealBloomPass(new THREE.Vector2(w * pr, h * pr), 0.7, 0.55, 0.82) : null;
  if (bloom) {
    // The bloom's first read of the scene: scrubbed (see SAFE_HDR).
    const hp = bloom.materialHighPassFilter;
    // Opt-in (Look.bloomKnee/bloomCap): only the part over the threshold blooms, each pixel's bloom capped.
    hp.uniforms.uKnee = { value: 0 };
    hp.uniforms.uCap = { value: 0 };
    hp.fragmentShader = hp.fragmentShader
      .replace("void main() {", `${SAFE_HDR}\nuniform float uKnee, uCap;\nvoid main() {`)
      .replace("vec4 texel = texture2D( tDiffuse, vUv );", "vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = whSafe( texel.rgb );")
      .replace(
        "gl_FragColor = mix( outputColor, texel, alpha );",
        `float lv = max( v, 1e-4 );
        texel.rgb *= mix( 1.0, max( v - luminosityThreshold, 0.0 ) / lv, uKnee );
        if ( uCap > 0.0 ) texel.rgb *= min( 1.0, uCap / lv );
        gl_FragColor = mix( outputColor, texel, alpha );`
      );
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
        // A ring of light at the seam and a gentle lift through the middle: bright, never a white frame.
        float ring = exp(-fx * fx);
        float mid = 1.0 - abs(uK - 0.5) * 2.0;
        vec3 burst = vec3(1.0, 0.86, 0.62) * ring * 1.15 + vec3(0.9, 0.8, 0.7) * mid * 0.12;
        gl_FragColor = vec4(m * (1.0 + mid * 0.25) + burst * uBurst, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

  // An anamorphic streak: hot pixels smeared far along the horizontal (a quarter-size pass).
  const streakMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, uThreshold: { value: 1.2 }, uTexel: { value: new THREE.Vector2(1 / w, 1 / h) } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene; uniform float uThreshold; uniform vec2 uTexel; varying vec2 vUv;
      ${SAFE_HDR}
      void main(){
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = -16; i <= 16; i++) {
          float x = float(i);
          float wgt = exp(-abs(x) * 0.16);
          vec3 c = whSafe(texture2D(tScene, vUv + vec2(x * x * sign(x) * 0.9 + x * 2.0, 0.0) * uTexel).rgb);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          acc += c * smoothstep(uThreshold, uThreshold * 3.0, l) * wgt;
          wsum += wgt;
        }
        gl_FragColor = vec4(acc / wsum, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

  const lensMat = new THREE.ShaderMaterial({
    defines: { DOF: q.lens ? 1 : 0, MBLUR: q.lens ? 1 : 0, FOG: q.depth ? 1 : 0 },
    uniforms: {
      tScene: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(w, h) }, uNear: { value: 0.1 }, uFar: { value: 4000 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uFog: { value: 0 }, uFogFalloff: { value: 0.1 }, uFogHeight: { value: 0 }, uFogSky: { value: 0 }, uFogColor: { value: new THREE.Vector3() },
      uFogSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFogSunColor: { value: new THREE.Vector3() },
      uDof: { value: 0 }, uFocus: { value: 10 }, uMBlur: { value: 0 }, uMaxCoc: { value: 10 }, uWhip: { value: new THREE.Vector2() },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: `${SAFE_HDR}\n${LENS_FRAG}`,
    depthTest: false,
    depthWrite: false,
  });

  const gradeMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tRays: { value: null }, uRays: { value: 0 }, uRaysColor: { value: new THREE.Vector3(1, 1, 1) },
      uExposure: { value: 1 }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3() },
      uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0.3 }, uChroma: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 0 },
      uGrain: { value: 0.04 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) },
      uTone: { value: 0 }, uToneMix: { value: 0 }, uFringe: { value: 0 }, uHueKeep: { value: 0 }, uBlack: { value: 0 }, uFlashHdr: { value: 0 },
      uSplitLo: { value: new THREE.Vector3() }, uSplitHi: { value: new THREE.Vector3() }, tStreak: { value: null }, uStreak: { value: 0 }, uStreakColor: { value: new THREE.Vector3(0.55, 0.7, 1.0) },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene, tRays, tStreak; uniform float uRays, uExposure, uSat, uContrast, uVignette, uChroma, uFlash, uFade, uGrain, uTime, uFringe, uStreak, uToneMix, uHueKeep, uBlack, uFlashHdr;
      uniform vec3 uSplitLo, uSplitHi;
      uniform int uTone;
      uniform vec3 uRaysColor, uGain, uLift, uStreakColor; uniform vec2 uRes; varying vec2 vUv;
      ${SAFE_HDR}
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      vec3 acesFull(vec3 c){
        const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        vec3 v = I * (c / 0.6);
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return clamp(O * (a / b), 0.0, 1.0);
      }
      vec3 agx(vec3 c){
        const mat3 I = mat3(vec3(0.842479062253094, 0.0423282422610123, 0.0423756549057051), vec3(0.0784335999999992, 0.878468636469772, 0.0784336), vec3(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
        const mat3 O = mat3(vec3(1.19687900512017, -0.0528968517574562, -0.0529716355144438), vec3(-0.0980208811401368, 1.15190312990417, -0.0980434501171241), vec3(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
        vec3 x = I * c;
        x = clamp((log2(max(x, vec3(1e-10))) + 12.47393) / 16.5, 0.0, 1.0);
        vec3 x2 = x * x, x4 = x2 * x2;
        x = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
        x = O * x;
        return pow(clamp(x, 0.0, 1.0), vec3(2.2));
      }
      vec3 toSrgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 c = vUv - 0.5;
        vec3 col;
        float chroma = uChroma + uFringe * dot(c, c) * 4.0;
        if (chroma > 0.001) {
          vec2 off = c * chroma * 0.018;
          col = whSafe(vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b));
        } else col = whSafe(texture2D(tScene, vUv).rgb);
        if (uRays > 0.0) col += whSafe(texture2D(tRays, vUv).rgb) * uRaysColor * uRays;
        if (uStreak > 0.0) col += whSafe(texture2D(tStreak, vUv).rgb) * uStreakColor * uStreak;
        col *= uExposure * uGain;
        float flashMix = uFlash;
        if (uFlashHdr > 0.5) { col = col * (1.0 + uFlash * 2.5) + vec3(1.0, 0.97, 0.92) * uFlash * 0.06; flashMix = 0.0; }
        vec3 hdr = col;
        col = aces(hdr);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = (col - 0.5) * uContrast + 0.5;
        col += uLift * (1.0 - col);
        col = clamp(col, 0.0, 1.0);
        if (uToneMix > 0.0) {
          // Display values (about sRGB): contrast pivots on mid grey, not on a linear 0.5, so shadows deepen without crushing.
          vec3 tm = uTone == 2 ? agx(hdr) : acesFull(hdr);
          if (uHueKeep > 0.0) {
            // The curve on luminance, the hue held; whitening only well above white.
            float L = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
            float tl = (uTone == 2 ? agx(vec3(L)) : acesFull(vec3(L))).g;
            vec3 hk = hdr * (tl / max(L, 1e-5));
            float mx = max(max(hk.r, hk.g), hk.b);
            if (mx > 1.0) hk = mix(hk / mx, vec3(1.0), clamp((mx - 1.0) * 0.18, 0.0, 0.6));
            tm = mix(tm, clamp(hk, 0.0, 1.0), uHueKeep);
          }
          vec3 d = sqrt(clamp(tm, 0.0, 1.0));
          float ld = dot(d, vec3(0.2126, 0.7152, 0.0722));
          d = mix(vec3(ld), d, uSat);
          d = (d - 0.5) * uContrast + 0.5;
          d += uLift * (1.0 - d);
          float ls = clamp(dot(d, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
          d += uSplitLo * (1.0 - ls) * (1.0 - ls) + uSplitHi * ls * ls;
          if (uBlack > 0.0) d = (d - uBlack) / (1.0 - uBlack);
          d = clamp(d, 0.0, 1.0);
          col = mix(col, d * d, uToneMix);
        }
        float v = smoothstep(0.85, 0.2, length(c * vec2(uRes.x / uRes.y, 1.0)) * 0.9);
        col *= mix(1.0, v, uVignette);
        col = mix(col, vec3(1.0, 0.98, 0.94), clamp(flashMix, 0.0, 1.0));
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
  const bloomMats: THREE.Material[] = bloom ? [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial] : [];
  return {
    target,
    materials: { target: [...bloomMats, ...(raysRT ? [raysMat] : []), ...(streakRT ? [streakMat] : []), ...(lensRT ? [lensMat] : []), mixMat], screen: [gradeMat] },
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
    finish(look, raysUv, time, view) {
      if (bloom && look.bloom > 0) {
        bloom.strength = look.bloom;
        bloom.radius = look.bloomRadius;
        bloom.threshold = look.bloomThreshold;
        bloom.materialHighPassFilter.uniforms.uKnee.value = look.bloomKnee ?? 0;
        bloom.materialHighPassFilter.uniforms.uCap.value = look.bloomCap ?? 0;
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
      let streak = 0;
      if (streakRT && (look.streak ?? 0) > 0) {
        streakMat.uniforms.tScene.value = target.texture;
        streakMat.uniforms.uThreshold.value = Math.max(1.6, look.bloomThreshold * 2.4);
        streakMat.uniforms.uTexel.value.set(1 / Math.max(1, W * PR), 1 / Math.max(1, H * PR));
        draw(streakMat, streakRT);
        streak = look.streak ?? 0;
        if (look.streakColor) g.uStreakColor.value.set(...look.streakColor);
        else g.uStreakColor.value.set(0.55, 0.7, 1.0);
      }
      // The lens pass: depth effects and smears, into a plain target the grade then reads.
      let src = target.texture;
      const lu = lensMat.uniforms;
      const cam = view?.camera;
      const fogK = lensRT && cam && look.fog ? look.fog.density : 0;
      const dofK = q.lens && cam && look.dof ? look.dof.k : 0;
      const mbK = q.lens && cam && view?.prevViewProj && look.mblur ? look.mblur : 0;
      const whipK = lensRT && look.whip ? look.whip.k : 0;
      if (lensRT && (fogK > 0 || dofK > 0 || mbK > 0 || whipK > 0)) {
        lu.tScene.value = target.texture;
        lu.tDepth.value = target.depthTexture ?? null;
        lu.uRes.value.set(Math.max(1, W * PR), Math.max(1, H * PR));
        lu.uFog.value = fogK;
        lu.uDof.value = dofK;
        lu.uMBlur.value = mbK;
        if (look.whip && whipK > 0) lu.uWhip.value.set(look.whip.dir[0] * whipK * 0.08, look.whip.dir[1] * whipK * 0.08);
        else lu.uWhip.value.set(0, 0);
        if (cam) {
          lu.uNear.value = cam.near;
          lu.uFar.value = cam.far;
          lu.uInvProj.value.copy(cam.projectionMatrixInverse);
          lu.uCamWorld.value.copy(cam.matrixWorld);
          lu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
          if (view?.prevViewProj) lu.uPrevViewProj.value.copy(view.prevViewProj);
          // Blur size in pixels scales with the picture (designed at 900 px tall).
          lu.uMaxCoc.value = Math.min(14, Math.max(4, (H * PR) / 900 * 11));
        }
        if (look.fog) {
          const f = look.fog;
          lu.uFogColor.value.set(...f.color);
          lu.uFogHeight.value = f.height;
          lu.uFogFalloff.value = Math.max(1e-4, f.falloff);
          lu.uFogSky.value = f.sky ?? 0.5;
          if (f.sun) { lu.uFogSunDir.value.set(...f.sun.dir).normalize(); lu.uFogSunColor.value.set(...f.sun.color); }
          else lu.uFogSunColor.value.set(0, 0, 0);
        }
        if (look.dof && cam) {
          const fo = look.dof.focus;
          lu.uFocus.value = typeof fo === "number" ? fo : Math.max(0.1, cam.position.distanceTo(new THREE.Vector3(fo[0], fo[1], fo[2])));
        }
        draw(lensMat, lensRT);
        src = lensRT!.texture;
      }
      g.tScene.value = src;
      g.tRays.value = raysRT?.texture ?? null;
      g.uRays.value = rays;
      g.tStreak.value = streakRT?.texture ?? null;
      g.uStreak.value = streak;
      g.uTone.value = look.tone === "agx" ? 2 : look.tone === "filmic" ? 1 : 0;
      g.uToneMix.value = look.tone && look.tone !== "aces" ? look.toneMix ?? 1 : 0;
      g.uFringe.value = look.fringe ?? 0;
      g.uHueKeep.value = look.hueKeep ?? 0;
      g.uFlashHdr.value = look.flashHdr ? 1 : 0;
      g.uBlack.value = Math.min(0.3, Math.max(0, look.black ?? 0));
      if (look.split) { g.uSplitLo.value.set(...look.split.shadows); g.uSplitHi.value.set(...look.split.highlights); }
      else { g.uSplitLo.value.set(0, 0, 0); g.uSplitHi.value.set(0, 0, 0); }
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
      streakRT?.setSize(Math.max(1, Math.round(pw / 4)), Math.max(1, Math.round(ph / 4)));
      lensRT?.setSize(pw, ph);
      bloom?.setSize(pw, ph);
    },
    dispose() {
      target.dispose();
      auxes.forEach((a) => a?.dispose());
      raysRT?.dispose();
      raysRT = null;
      target.depthTexture?.dispose();
      lensRT?.dispose();
      lensRT = null;
      streakRT?.dispose();
      streakRT = null;
      streakMat.dispose();
      lensMat.dispose();
      bloom?.dispose();
      quadGeo.dispose();
      raysMat.dispose();
      mixMat.dispose();
      gradeMat.dispose();
    },
  };
}
