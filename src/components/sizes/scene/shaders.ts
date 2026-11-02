import * as THREE from "three";

/**
 * Small shader patches shared by the scene's materials.
 *
 * - Cutaway: anything between the camera and the Pokémon it frames
 *   (a tree, a lamp, a building corner when the camera has pulled back
 *   through a wall) is dissolved inside a capsule from the camera to the
 *   figure, so the view is never blocked. Shadows are unaffected.
 * - Ground variation: a slow world-space tint so tiled paving doesn't
 *   repeat visibly into the distance.
 * - Figure: a light unsharp mask on the HOME render (the source is 512 px)
 *   and a touch of saturation, so figures stay crisp under the tone curve.
 */

export interface Shared {
  uniforms: {
    uCutA: { value: THREE.Vector3 };
    uCutB: { value: THREE.Vector3 };
    uCutR: { value: number };
    uTime: { value: number };
  };
}

export function sharedUniforms(): Shared {
  return { uniforms: { uCutA: { value: new THREE.Vector3() }, uCutB: { value: new THREE.Vector3(0, 0, 1) }, uCutR: { value: 0 }, uTime: { value: 0 } } };
}

const WORLD_VARYING_VS = /* glsl */ `
  vec4 sizesWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    sizesWorld = instanceMatrix * sizesWorld;
  #endif
  sizesWorld = modelMatrix * sizesWorld;
  vSizesWorld = sizesWorld.xyz;
`;

function chain(m: THREE.Material, key: string, fn: (s: THREE.WebGLProgramParametersWithUniforms) => void) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    fn(s);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|${key}`;
}

function withWorld(s: THREE.WebGLProgramParametersWithUniforms) {
  if (s.vertexShader.includes("vSizesWorld")) return;
  s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSizesWorld;").replace("#include <project_vertex>", `#include <project_vertex>\n${WORLD_VARYING_VS}`);
  s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vSizesWorld;");
}

/** Dissolve fragments inside the camera → figure capsule. */
export function cutaway(m: THREE.Material, shared: Shared) {
  chain(m, "cut", (s) => {
    withWorld(s);
    s.uniforms.uCutA = shared.uniforms.uCutA;
    s.uniforms.uCutB = shared.uniforms.uCutB;
    s.uniforms.uCutR = shared.uniforms.uCutR;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uCutA;\nuniform vec3 uCutB;\nuniform float uCutR;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (uCutR > 0.0) {
          vec3 ab = uCutB - uCutA;
          float t = clamp(dot(vSizesWorld - uCutA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
          float r = uCutR * (1.0 - smoothstep(0.6, 0.93, t));
          float d = length(vSizesWorld - (uCutA + ab * t));
          float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (d < r * (0.86 + 0.14 * n)) discard;
        }`
      );
  });
}

/** Large-scale tint variation on tiled ground. */
export function groundVariation(m: THREE.Material) {
  chain(m, "gv", (s) => {
    withWorld(s);
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        float gvHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gvNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(gvHash(i), gvHash(i+vec2(1,0)), f.x), mix(gvHash(i+vec2(0,1)), gvHash(i+vec2(1,1)), f.x), f.y); }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float gv = gvNoise(vSizesWorld.xz * 0.045) * 0.6 + gvNoise(vSizesWorld.xz * 0.21) * 0.4;
        diffuseColor.rgb *= mix(0.86, 1.08, gv);`
      );
  });
}

/** Crisper, slightly richer HOME renders on the figures. */
export function figureLook(m: THREE.MeshStandardMaterial, texSize: number, sharpen: number) {
  chain(m, `fig${sharpen.toFixed(2)}`, (s) => {
    s.uniforms.uTexel = { value: 1 / texSize };
    s.uniforms.uSharpen = { value: sharpen };
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTexel;\nuniform float uSharpen;")
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 c0 = texture2D(map, vMapUv);
          vec3 blur = (texture2D(map, vMapUv + vec2(uTexel, 0.0)).rgb + texture2D(map, vMapUv - vec2(uTexel, 0.0)).rgb
            + texture2D(map, vMapUv + vec2(0.0, uTexel)).rgb + texture2D(map, vMapUv - vec2(0.0, uTexel)).rgb) * 0.25;
          vec3 sharp = clamp(c0.rgb + (c0.rgb - blur) * uSharpen, 0.0, 1.0);
          float l = dot(sharp, vec3(0.299, 0.587, 0.114));
          sharp = clamp(mix(vec3(l), sharp, 1.06), 0.0, 1.0);
          diffuseColor *= vec4(sharp, c0.a);
        #endif`
      );
  });
}

/** The plaza's paving pattern: concentric bands of paler stone, spokes along the avenues, and a rosette at the centre. */
export function plazaPattern(m: THREE.Material, centre: THREE.Vector2, radius: number) {
  chain(m, "plaza", (s) => {
    withWorld(s);
    s.uniforms.uPlazaC = { value: centre };
    s.uniforms.uPlazaR = { value: radius };
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uPlazaC;\nuniform float uPlazaR;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec2 pq = vSizesWorld.xz - uPlazaC;
        float pr = length(pq);
        float pa = atan(pq.y, pq.x);
        float band = 1.0 - smoothstep(0.0, 0.5, abs(fract(pr / 14.0) - 0.5) * 14.0 - 0.6);
        float spoke = 1.0 - smoothstep(0.4, 1.0, abs(fract(pa / 0.785398 + 0.5) - 0.5) * 0.785398 * pr);
        float rose = smoothstep(26.0, 24.0, pr) * (0.5 + 0.5 * cos(pa * 16.0));
        float inside = step(pr, uPlazaR);
        diffuseColor.rgb *= 1.0 + inside * (0.16 * max(band, spoke) + 0.12 * rose);`
      );
  });
}

/** Mowing stripes on lawns. */
export function lawnStripes(m: THREE.Material) {
  chain(m, "lawn", (s) => {
    withWorld(s);
    s.fragmentShader = s.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      diffuseColor.rgb *= 0.9 + 0.14 * step(0.5, fract(vSizesWorld.x / 9.0));`
    );
  });
}
